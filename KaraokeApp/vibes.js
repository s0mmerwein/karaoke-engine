// Vibe classification for the Karaoke Flow projector cards.
//
// Each song carries a `vibe` (rock, party, groove, singalong, ballad,
// anthem) that drives the subtle ticket animations in style.css /
// projector.js. Vibes are resolved in order of trust:
//   1. a hand-curated `vibe` already on the song (data.js),
//   2. a cached AI classification from a previous run (localStorage),
//   3. Claude, called whenever a song list without vibes is loaded (the
//      list is dynamic, e.g. from Google Sheets),
//   4. a deterministic offline heuristic so animations always work even
//      with no API key or no network.
//
// Loaded in admin.html; results reach the projector via the SET_VIBES
// broadcast and via the song objects in SHOW_OPTIONS / LOCK_CHOICE.

(function () {
  const API_KEY_STORAGE_KEY = "karaoke_anthropic_api_key";
  const VIBE_CACHE_KEY = "karaoke_vibe_cache_v1";
  const CLAUDE_MODEL = "claude-opus-5";
  const SDK_URL = "https://esm.sh/@anthropic-ai/sdk";

  // Must match the vibes style.css animates and projector.js accepts.
  const VIBES = {
    rock: "Hard-hitting rock energy - driving guitars, head-banging, a little dangerous",
    party: "Upbeat party banger - bouncy, euphoric, hands in the air",
    groove: "Funky danceable groove - funk, disco or pop that makes you shimmy",
    singalong: "Arms-around-shoulders crowd singalong - everyone sways and belts along",
    ballad: "Slow emotional ballad - tender, intimate or melancholic",
    anthem: "Triumphant stadium anthem - soaring, larger than life, fists in the air",
  };

  const CATEGORY_POOLS = {
    easy: ["singalong", "party", "groove"],
    middle: ["rock", "groove", "ballad"],
    hard: ["anthem", "ballad", "rock"],
  };

  // Cheap keyword hints so the offline fallback is not purely random.
  // Ordered: high-energy patterns first so "I Love Rock 'n' Roll" reads
  // as rock, not as a love ballad.
  const KEYWORD_HINTS = [
    { pattern: /highway|hell|fire|rock|riot/i, vibe: "rock" },
    { pattern: /danc|funk|party|wannabe|celebrat|uptown/i, vibe: "party" },
    { pattern: /tears?|cry|goodbye|alone|hurt|losing|love|heart|kiss/i, vibe: "ballad" },
    { pattern: /caroline|hey jude|country roads|piano man|wonderwall|luftballon/i, vibe: "singalong" },
    { pattern: /my way|eye of the tiger|champion|hero/i, vibe: "anthem" },
  ];

  function songKey(song) {
    return ((song.artist || "") + "::" + (song.title || ""))
      .toLowerCase()
      .trim();
  }

  function hashString(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = (hash * 31 + str.charCodeAt(i)) | 0;
    }
    return Math.abs(hash);
  }

  function isValidVibe(vibe) {
    return typeof vibe === "string" && !!VIBES[vibe];
  }

  // Deterministic offline fallback: keyword hints first, then a stable
  // pick from the song's category pool.
  function heuristicVibe(song) {
    if (!song) return "singalong";
    const text = (song.artist || "") + " " + (song.title || "");
    for (const hint of KEYWORD_HINTS) {
      if (hint.pattern.test(text)) return hint.vibe;
    }
    const pool = CATEGORY_POOLS[song.category] || Object.keys(VIBES);
    return pool[hashString(songKey(song)) % pool.length];
  }

  function loadCache() {
    try {
      return JSON.parse(window.localStorage.getItem(VIBE_CACHE_KEY)) || {};
    } catch (err) {
      return {};
    }
  }

  function saveCache(cache) {
    try {
      window.localStorage.setItem(VIBE_CACHE_KEY, JSON.stringify(cache));
    } catch (err) {
      console.warn("[KARAOKE] Failed to save vibe cache", err);
    }
  }

  // Give every song a vibe right now: hand-curated vibes are kept, then
  // cached AI results, then heuristics. Safe to call repeatedly.
  function assignVibes(songs) {
    if (!Array.isArray(songs)) return;
    const cache = loadCache();
    songs.forEach((song) => {
      if (isValidVibe(song.vibe) && song.vibeSource !== "heuristic") return;
      const cached = cache[songKey(song)];
      song.vibe = isValidVibe(cached) ? cached : heuristicVibe(song);
      song.vibeSource = isValidVibe(cached) ? "ai" : "heuristic";
    });
  }

  function getApiKey() {
    try {
      return window.localStorage.getItem(API_KEY_STORAGE_KEY) || null;
    } catch (err) {
      return null;
    }
  }

  function setApiKey(key) {
    try {
      if (key) {
        window.localStorage.setItem(API_KEY_STORAGE_KEY, key);
      } else {
        window.localStorage.removeItem(API_KEY_STORAGE_KEY);
      }
    } catch (err) {
      console.warn("[KARAOKE] Failed to store API key", err);
    }
  }

  function hasApiKey() {
    return !!getApiKey();
  }

  // Ask Claude to classify every song that has neither a hand-curated
  // vibe nor a cached AI result. Mutates the song objects and updates
  // the cache. Returns { fromAI, alreadyKnown }.
  async function classifyWithAI(songs) {
    if (!Array.isArray(songs) || !songs.length) {
      return { fromAI: 0, alreadyKnown: 0 };
    }
    const apiKey = getApiKey();
    if (!apiKey) {
      throw new Error("No Anthropic API key configured");
    }

    const cache = loadCache();
    const pending = songs.filter(
      (song) =>
        !(isValidVibe(song.vibe) && song.vibeSource !== "heuristic") &&
        !isValidVibe(cache[songKey(song)])
    );
    if (!pending.length) {
      assignVibes(songs);
      return { fromAI: 0, alreadyKnown: songs.length };
    }

    const { default: Anthropic } = await import(SDK_URL);
    const client = new Anthropic({
      apiKey,
      dangerouslyAllowBrowser: true,
    });

    const vibeList = Object.entries(VIBES)
      .map(([name, description]) => "- " + name + ": " + description)
      .join("\n");
    const songList = pending
      .map(
        (song, i) => i + ". " + (song.artist || "?") + " - " + (song.title || "?")
      )
      .join("\n");

    const schema = {
      type: "object",
      additionalProperties: false,
      required: ["assignments"],
      properties: {
        assignments: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["index", "vibe"],
            properties: {
              index: { type: "integer" },
              vibe: { type: "string", enum: Object.keys(VIBES) },
            },
          },
        },
      },
    };

    const response = await client.beta.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 16000,
      output_config: {
        effort: "low",
        format: { type: "json_schema", schema },
      },
      // If a safety classifier declines the request, the API transparently
      // retries it on Anthropic's recommended fallback model.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system:
        "You assign a visual animation vibe to karaoke songs shown on a projector. " +
        "Pick the single vibe that best matches how each song feels when a crowd sings it.",
      messages: [
        {
          role: "user",
          content:
            "Vibes:\n" +
            vibeList +
            "\n\nSongs (return exactly one assignment per index):\n" +
            songList,
        },
      ],
    });

    if (response.stop_reason === "refusal") {
      throw new Error("Claude declined the classification request");
    }

    const textBlock = (response.content || []).find((b) => b.type === "text");
    if (!textBlock || !textBlock.text) {
      throw new Error("Empty response from Claude");
    }

    const parsed = JSON.parse(textBlock.text);
    let classified = 0;
    (parsed.assignments || []).forEach((assignment) => {
      const song = pending[assignment.index];
      if (song && isValidVibe(assignment.vibe)) {
        song.vibe = assignment.vibe;
        song.vibeSource = "ai";
        cache[songKey(song)] = assignment.vibe;
        classified++;
      }
    });
    saveCache(cache);

    // Fill any songs the model skipped with heuristics + cache.
    assignVibes(songs);

    return { fromAI: classified, alreadyKnown: songs.length - pending.length };
  }

  window.KaraokeVibes = {
    VIBES,
    isValidVibe,
    heuristicVibe,
    assignVibes,
    classifyWithAI,
    getApiKey,
    setApiKey,
    hasApiKey,
  };
})();
