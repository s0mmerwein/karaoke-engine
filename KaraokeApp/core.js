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
  const STATE_VERSION = 2;

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

  function filterSongs(songs, category, query) {
    const q = (query || "").trim().toLowerCase();
    return (Array.isArray(songs) ? songs : []).filter((song) => {
      if (song.category !== category) return false;
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
      nextSongId != null && CATEGORY_KEYS.includes(state.nextSlot)
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
    };
  }

  return {
    CATEGORIES,
    CATEGORY_KEYS,
    STATE_VERSION,
    buildSongIndex,
    pickSongForCategory,
    filterSongs,
    categoryCounts,
    serializeAdminState,
    deserializeAdminState,
  };
});
