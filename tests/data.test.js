const test = require("node:test");
const assert = require("node:assert/strict");

const { SONGS, VIBES } = require("../KaraokeApp/data.js");

const CATEGORY_KEYS = ["easy", "middle", "hard"];

test("song ids are unique", () => {
  const ids = SONGS.map((song) => song.id);
  assert.equal(new Set(ids).size, ids.length);
});

test("every song has a known category", () => {
  for (const song of SONGS) {
    assert.ok(
      CATEGORY_KEYS.includes(song.category),
      `#${song.id} "${song.title}" has unknown category: ${song.category}`
    );
  }
});

test("every song has a valid vibe for the projector card animation", () => {
  for (const song of SONGS) {
    assert.ok(
      VIBES.includes(song.vibe),
      `#${song.id} "${song.title}" has invalid vibe: ${song.vibe}`
    );
  }
});
