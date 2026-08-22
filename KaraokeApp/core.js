// Pure, DOM-free logic for the Karaoke Flow app.
// Loaded in the browser (exposes window.KaraokeCore) and require()-able from
// Node for tests and tooling.

(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.KaraokeCore = api;
  }
})(typeof window !== "undefined" ? window : null, function () {
  const CATEGORIES = [
    { key: "easy", label: "Easy", hotkey: "1" },
    { key: "middle", label: "Middle", hotkey: "2" },
    { key: "hard", label: "Very Hard", hotkey: "3" },
  ];
  const CATEGORY_KEYS = CATEGORIES.map((c) => c.key);
  // The golden buzzer is a slot (a valid nextSlot value) but not a category:
  // it has no difficulty, no song pool, and no pre-generated suggestion.
  const GOLDEN_SLOT = "golden";
  const VALID_SLOTS = CATEGORY_KEYS.concat([GOLDEN_SLOT]);
  const STATE_VERSION = 3;

  function buildSongIndex(songs) {
    const index = new Map();
    (Array.isArray(songs) ? songs : []).forEach((song) => {
      if (song && typeof song.id === "number") {
        index.set(song.id, song);
      }
    });
    return index;
  }

  // rng is injectable for deterministic tests; defaults to Math.random.
  function pickSongForCategory(songs, category, playedIds, rng) {
    const all = Array.isArray(songs) ? songs : [];
    const unplayed = all.filter(
      (s) => s.category === category && !playedIds.has(s.id)
    );
    if (!unplayed.length) return null;
    const r = typeof rng === "function" ? rng() : Math.random();
    const idx = Math.min(
      unplayed.length - 1,
      Math.max(0, Math.floor(r * unplayed.length))
    );
    return unplayed[idx];
  }

  // category null searches the whole catalogue (used by the golden buzzer).
  function filterSongs(songs, category, query) {
    const q = (query || "").trim().toLowerCase();
    return (Array.isArray(songs) ? songs : []).filter((song) => {
      if (category != null && song.category !== category) return false;
      if (!q) return true;
      return (song.title + " " + song.artist).toLowerCase().includes(q);
    });
  }

  function categoryCounts(songs, category, playedIds) {
    let total = 0;
    let remaining = 0;
    (Array.isArray(songs) ? songs : []).forEach((song) => {
      if (song.category !== category) return;
      total += 1;
      if (!playedIds.has(song.id)) remaining += 1;
    });
    return { total, remaining };
  }

  // A golden hit is only possible while armed and no hit is already waiting
  // for the DJ to resolve it.
  function canGoldenHit(state) {
    if (!state || typeof state !== "object") return false;
    return !!state.goldenArmed && !state.goldenHitPending;
  }

  function serializeAdminState(state) {
    const suggestions = {};
    CATEGORY_KEYS.forEach((key) => {
      const song = state.suggestions ? state.suggestions[key] : null;
      suggestions[key] = song ? song.id : null;
    });
    return {
      version: STATE_VERSION,
      playedSongIds: Array.from(state.playedSongIds || []),
      suggestions,
      nextSongId: state.nextSong ? state.nextSong.id : null,
      nextSlot: state.nextSlot || null,
      started: !!state.started,
      isAudienceShowingOptions: !!state.isAudienceShowingOptions,
      goldenArmed: !!state.goldenArmed,
      goldenHitPending: !!state.goldenHitPending,
    };
  }

  // Parses and validates a stored state string. Returns a normalized plain
  // object (ids only, not song objects) or null when the input is unusable.
  // Accepts v1 payloads (no version/started fields); for those, a selection
  // whose song is already in playedSongIds is treated as started, so a page
  // reload cannot re-arm "Start" for a song that already played.
  function deserializeAdminState(raw) {
    if (!raw || typeof raw !== "string") return null;
    let state;
    try {
      state = JSON.parse(raw);
    } catch (err) {
      return null;
    }
    if (!state || typeof state !== "object" || Array.isArray(state)) {
      return null;
    }

    const playedSongIds = Array.isArray(state.playedSongIds)
      ? state.playedSongIds.filter((id) => typeof id === "number")
      : [];

    const rawSuggestions =
      state.suggestions && typeof state.suggestions === "object"
        ? state.suggestions
        : {};
    const suggestions = {};
    CATEGORY_KEYS.forEach((key) => {
      suggestions[key] =
        typeof rawSuggestions[key] === "number" ? rawSuggestions[key] : null;
    });

    const nextSongId =
      typeof state.nextSongId === "number" ? state.nextSongId : null;
    const nextSlot =
      nextSongId != null && VALID_SLOTS.includes(state.nextSlot)
        ? state.nextSlot
        : null;

    const started =
      typeof state.started === "boolean"
        ? state.started && nextSongId != null
        : nextSongId != null && playedSongIds.includes(nextSongId);

    return {
      playedSongIds,
      suggestions,
      nextSongId,
      nextSlot,
      started,
      isAudienceShowingOptions: !!state.isAudienceShowingOptions,
      // v1/v2 payloads have no golden fields; they default to false.
      goldenArmed: state.goldenArmed === true,
      goldenHitPending: state.goldenHitPending === true,
    };
  }

  return {
    CATEGORIES,
    CATEGORY_KEYS,
    GOLDEN_SLOT,
    VALID_SLOTS,
    STATE_VERSION,
    buildSongIndex,
    pickSongForCategory,
    filterSongs,
    categoryCounts,
    canGoldenHit,
    serializeAdminState,
    deserializeAdminState,
  };
});
