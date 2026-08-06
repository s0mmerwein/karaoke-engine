// Vibe engine for the Karaoke Flow projector cards.
//
// A "vibe" is a named, subtle animation style that matches the feel of a
// song (stadium anthem, tearjerker, crowd singalong, ...). Every song gets
// a vibe in two steps:
//   1. instantly via a deterministic offline heuristic (keywords + category),
//      so the projector always has something to animate with, and
//   2. refined by Claude whenever a song list is loaded (the list is dynamic,
//      e.g. from Google Sheets). AI results are cached in localStorage per
//      artist+title, so each song is only ever classified once.
//
// This file is loaded in both admin.html (runs the classification) and
// projector.html (fallback resolution + animation durations).

(function () {
  const API_KEY_STORAGE_KEY = "karaoke_anthropic_api_key";
  const VIBE_CACHE_KEY = "karaoke_vibe_cache_v1";
  const CLAUDE_MODEL = "claude-opus-5";
  const SDK_URL = "https://esm.sh/@anthropic-ai/sdk";

  // Vibe catalogue. `duration` is how long one animation play lasts in ms;
  // style.css reads it via the --vibe-duration custom property.
  const VIBES = {
    anthem: {
      duration: 3200,
      description:
        "Triumphant stadium-rock anthem - fist-pumping, larger than life",
    },
    fire: {
      duration: 2800,
      description: "Raw, driving rock energy - loud, fast, a little dangerous",
    },
    groove: {
      duration: 3600,
      description:
        "Funky danceable groove - pop, funk or disco that makes you move",
    },
    heartbeat: {
      duration: 3400,
      description: "Warm, intimate love song - tender and romantic",
    },
    tearjerker: {
      duration: 4400,
      description: "Heartbreak and melancholy - slow, sad, emotionally heavy",
    },
    soaring: {
      duration: 3800,
      description: "Power ballad that builds to a huge, soaring climax",
    },
    dreamy: {
      duration: 4800,
      description: "Floaty, wistful and atmospheric - soft, drifting",
    },
    singalong: {
      duration: 4200,
      description:
        "Arms-around-shoulders crowd singalong - everyone sways together",
    },
    classic: {
      duration: 4400,
      description: "Timeless golden-era classic - elegant, warm nostalgia",
    },
  };

  const CATEGORY_POOLS = {
    power: ["anthem", "fire", "groove"],
    emotional: ["heartbeat", "tearjerker", "soaring", "dreamy"],
    evergreen: ["singalong", "classic", "groove"],
  };

  // Cheap keyword hints so the offline fallback is not purely random.
  // Ordered: high-energy patterns first so "I Love Rock 'n' Roll" reads
  // as fire, not as a love ballad.
  const KEYWORD_HINTS = [
    { pattern: /highway|hell|fire|rock|tiger|riot/i, vibe: "fire" },
    { pattern: /danc|funk|party|wannabe|celebrat/i, vibe: "groove" },
    { pattern: /tears?|cry|goodbye|alone|hurt|losing|eclipse/i, vibe: "tearjerker" },
    { pattern: /love|heart|kiss|stay with me|shallow/i, vibe: "heartbeat" },
    { pattern: /caroline|hey jude|country roads|piano man|wonderwall/i, vibe: "singalong" },
    { pattern: /sinatra|my way|wein/i, vibe: "classic" },
    { pattern: /dream|luftballon|moon|space/i, vibe: "dreamy" },
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

  // Give every song a vibe right now: cached AI result if we have one,
  // heuristic otherwise. Safe to call repeatedly (e.g. after a reload).
  function assignVibes(songs) {
    if (!Array.isArray(songs)) return;
    const cache = loadCache();
    songs.forEach((song) => {
      const cached = cache[songKey(song)];
      song.vibe = cached && VIBES[cached] ? cached : heuristicVibe(song);
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

  // Ask Claude to classify every song that has no cached vibe yet.
  // Mutates the song objects (sets song.vibe) and updates the cache.
  // Returns { fromAI, fromCache }.
  async function classifyWithAI(songs) {
    if (!Array.isArray(songs) || !songs.length) {
      return { fromAI: 0, fromCache: 0 };
    }
    const apiKey = getApiKey();
    if (!apiKey) {
      throw new Error("No Anthropic API key configured");
    }

    const cache = loadCache();
    const pending = songs.filter((song) => !VIBES[cache[songKey(song)]]);
    if (!pending.length) {
      assignVibes(songs);
      return { fromAI: 0, fromCache: songs.length };
    }

    const { default: Anthropic } = await import(SDK_URL);
    const client = new Anthropic({
      apiKey,
      dangerouslyAllowBrowser: true,
    });

    const vibeList = Object.entries(VIBES)
      .map(([name, def]) => "- " + name + ": " + def.description)
      .join("\n");
    const songList = pending
      .map((song, i) => i + ". " + (song.artist || "?") + " - " + (song.title || "?"))
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
      if (song && VIBES[assignment.vibe]) {
        song.vibe = assignment.vibe;
        cache[songKey(song)] = assignment.vibe;
        classified++;
      }
    });
    saveCache(cache);

    // Fill any songs the model skipped with heuristics + cache.
    assignVibes(songs);

    return { fromAI: classified, fromCache: songs.length - pending.length };
  }

  window.KaraokeVibes = {
    VIBES,
    heuristicVibe,
    assignVibes,
    classifyWithAI,
    getApiKey,
    setApiKey,
    hasApiKey,
  };
})();
