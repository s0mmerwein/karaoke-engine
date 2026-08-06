// Validates every YouTube ID in KaraokeApp/data.js against YouTube's oEmbed
// endpoint. Run before an event: `npm run check-songs`.
//
// oEmbed responds 200 for playable public videos, 404/400 for missing or
// invalid IDs, and 401/403 for videos whose owner disabled embedding — the
// exact case that breaks the projector's embedded player.

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { SONGS } = require("../KaraokeApp/data.js");

const CONCURRENCY = 5;

async function checkSong(song) {
  const watchUrl = "https://www.youtube.com/watch?v=" + song.youtubeId;
  const url =
    "https://www.youtube.com/oembed?url=" +
    encodeURIComponent(watchUrl) +
    "&format=json";
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (res.ok) return { song, ok: true };
    const reason =
      res.status === 401 || res.status === 403
        ? `HTTP ${res.status} (embedding disabled)`
        : res.status === 404 || res.status === 400
        ? `HTTP ${res.status} (video not found / invalid ID)`
        : `HTTP ${res.status}`;
    return { song, ok: false, reason };
  } catch (err) {
    return { song, ok: false, reason: `request failed: ${err.message}` };
  }
}

async function run() {
  console.log(`Checking ${SONGS.length} songs against YouTube oEmbed…\n`);

  const queue = [...SONGS];
  const results = [];
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (queue.length) {
        const song = queue.shift();
        results.push(await checkSong(song));
      }
    })
  );

  results.sort((a, b) => a.song.id - b.song.id);
  const failures = results.filter((r) => !r.ok);

  for (const r of results) {
    const label = `#${r.song.id} [${r.song.category}] ${r.song.artist} – ${r.song.title} (${r.song.youtubeId})`;
    console.log(r.ok ? `  OK    ${label}` : `  FAIL  ${label}\n        ${r.reason}`);
  }

  console.log(
    `\n${results.length - failures.length}/${results.length} playable.`
  );
  if (failures.length) {
    console.log(
      `${failures.length} song(s) need a new YouTube ID in KaraokeApp/data.js.`
    );
    process.exitCode = 1;
  }
}

run();
