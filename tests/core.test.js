const test = require("node:test");
const assert = require("node:assert/strict");

const {
  CATEGORY_KEYS,
  buildSongIndex,
  pickSongForCategory,
  filterSongs,
  categoryCounts,
  serializeAdminState,
  deserializeAdminState,
} = require("../KaraokeApp/core.js");

const SONGS = [
  { id: 1, artist: "A", title: "Alpha", youtubeId: "x1", category: "power" },
  { id: 2, artist: "B", title: "Beta", youtubeId: "x2", category: "power" },
  { id: 3, artist: "C", title: "Gamma", youtubeId: "x3", category: "emotional" },
  { id: 4, artist: "D", title: "Delta", youtubeId: "x4", category: "evergreen" },
];

test("buildSongIndex maps ids to songs and skips malformed entries", () => {
  const index = buildSongIndex([...SONGS, null, { title: "no id" }]);
  assert.equal(index.size, 4);
  assert.equal(index.get(3).title, "Gamma");
});

test("pickSongForCategory excludes played songs", () => {
  const song = pickSongForCategory(SONGS, "power", new Set([1]));
  assert.equal(song.id, 2);
});

test("pickSongForCategory returns null when the category is exhausted", () => {
  assert.equal(pickSongForCategory(SONGS, "power", new Set([1, 2])), null);
  assert.equal(pickSongForCategory(SONGS, "nope", new Set()), null);
});

test("pickSongForCategory uses the injected rng deterministically", () => {
  assert.equal(pickSongForCategory(SONGS, "power", new Set(), () => 0).id, 1);
  assert.equal(
    pickSongForCategory(SONGS, "power", new Set(), () => 0.99).id,
    2
  );
});

test("filterSongs matches title and artist case-insensitively", () => {
  assert.equal(filterSongs(SONGS, "power", "ALPHA").length, 1);
  assert.equal(filterSongs(SONGS, "power", "b").length, 1);
  assert.equal(filterSongs(SONGS, "emotional", "c").length, 1);
});

test("filterSongs with empty query returns the whole category", () => {
  assert.equal(filterSongs(SONGS, "power", "").length, 2);
  assert.equal(filterSongs(SONGS, "emotional", "  ").length, 1);
});

test("categoryCounts reports total and remaining", () => {
  assert.deepEqual(categoryCounts(SONGS, "power", new Set([1])), {
    total: 2,
    remaining: 1,
  });
});

test("serialize/deserialize round-trips state including the started flag", () => {
  const serialized = serializeAdminState({
    playedSongIds: new Set([1, 3]),
    suggestions: { power: SONGS[1], emotional: null, evergreen: SONGS[3] },
    nextSong: SONGS[1],
    nextSlot: "power",
    started: true,
    isAudienceShowingOptions: false,
  });
  const restored = deserializeAdminState(JSON.stringify(serialized));
  assert.deepEqual(restored.playedSongIds, [1, 3]);
  assert.deepEqual(restored.suggestions, {
    power: 2,
    emotional: null,
    evergreen: 4,
  });
  assert.equal(restored.nextSongId, 2);
  assert.equal(restored.nextSlot, "power");
  assert.equal(restored.started, true);
  assert.equal(restored.isAudienceShowingOptions, false);
});

test("deserialize rejects garbage", () => {
  assert.equal(deserializeAdminState(null), null);
  assert.equal(deserializeAdminState("not json {"), null);
  assert.equal(deserializeAdminState(JSON.stringify("a string")), null);
  assert.equal(deserializeAdminState(JSON.stringify([1, 2])), null);
});

test("deserialize normalizes malformed fields", () => {
  const restored = deserializeAdminState(
    JSON.stringify({
      playedSongIds: [1, "2", null, 3],
      suggestions: { power: "x", emotional: 3, bogus: 9 },
      nextSongId: "not a number",
      nextSlot: "power",
      isAudienceShowingOptions: 1,
    })
  );
  assert.deepEqual(restored.playedSongIds, [1, 3]);
  assert.deepEqual(restored.suggestions, {
    power: null,
    emotional: 3,
    evergreen: null,
  });
  // nextSlot is meaningless without a valid nextSongId
  assert.equal(restored.nextSongId, null);
  assert.equal(restored.nextSlot, null);
  assert.equal(restored.started, false);
  assert.equal(restored.isAudienceShowingOptions, true);
});

test("v1 state migration: a played nextSong counts as started", () => {
  // v1 payloads have no version/started fields. If the locked song is already
  // in playedSongIds, it was started before the reload — restoring it as a
  // fresh locked choice would re-arm "Start" (audit BUG-2).
  const v1Started = deserializeAdminState(
    JSON.stringify({
      playedSongIds: [2],
      suggestions: { power: 2, emotional: null, evergreen: null },
      nextSongId: 2,
      nextSlot: "power",
      isAudienceShowingOptions: false,
    })
  );
  assert.equal(v1Started.started, true);

  const v1Locked = deserializeAdminState(
    JSON.stringify({
      playedSongIds: [],
      suggestions: { power: 2, emotional: null, evergreen: null },
      nextSongId: 2,
      nextSlot: "power",
      isAudienceShowingOptions: false,
    })
  );
  assert.equal(v1Locked.started, false);
});

test("started flag cannot be true without a nextSongId", () => {
  const restored = deserializeAdminState(
    JSON.stringify({ version: 2, started: true, playedSongIds: [] })
  );
  assert.equal(restored.started, false);
});

test("category keys stay in sync with slots", () => {
  assert.deepEqual(CATEGORY_KEYS, ["power", "emotional", "evergreen"]);
});
