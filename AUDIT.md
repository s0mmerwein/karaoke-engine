# Karaoke Engine — Code Audit & Improvement Plan

Audit date: 2026-08-06 · Scope: full repository (`index.html`, `KaraokeApp/admin.html`,
`KaraokeApp/projector.html`, `KaraokeApp/logic.js`, `KaraokeApp/data.js`,
`KaraokeApp/style.css`, `package.json`, git history)

> **Status:** implemented on this branch. All P0–P3 items below are done
> (bug fixes, repo hygiene, playback controls/error handling, script
> extraction, perf and UX work, tests, `npm run check-songs`), except the
> catalogue swap to karaoke-version videos, which needs a human with YouTube
> access — run `npm run check-songs` to find the IDs that need replacing.

The app is a two-window live karaoke controller: an **admin page** (suggestion slots,
manual song picker, buzzer keys 1/2/3) and a **projector page** (YouTube player +
ticket overlay), synced via `BroadcastChannel` with state persisted in `localStorage`.
The architecture is sound for an MVP. The audit found **4 confirmed functional bugs**,
**1 major repo-hygiene problem**, a set of robustness gaps around YouTube playback,
and a list of performance/UI improvements, prioritized below.

---

## 1. Confirmed bugs (fix first)

### BUG-1 · "Open projector window" spawns a new tab on every click
`admin.html` (`openOrFocusProjector`):

```js
projectorWindow = window.open(url, "_blank", "noopener");
```

With `noopener` in the features string, `window.open()` returns `null`, so
`projectorWindow` is never a usable handle. The `focus()` reuse path is dead code and
every click opens another projector tab — with multiple projectors all reacting to the
same broadcasts.

**Fix:** open with a *named* target instead of `_blank` and drop the handle tracking
entirely — the browser reuses the named window on its own:

```js
window.open("projector.html", "karaoke_projector");
```

### BUG-2 · Reloading the admin page mid-song disrupts the projector and re-arms "Start"
`handleStartNextSong` intentionally keeps `nextSong`/`nextSlot` set after starting a
song ("keep status until next suggestion round") and then calls `saveAdminState()`.
On the next admin page load, `restoreAdminStateOrDefaults` sees
`hasLockedChoice === true` and:

1. re-enables **Start Next Song** — the same song can be started twice, and
2. re-broadcasts `LOCK_CHOICE`, which makes the projector show the locked ticket
   overlay **on top of the currently playing video**.

**Fix:** persist a `started` flag (or clear `nextSongId` in the saved state once the
song starts, keeping only in-memory status text). On restore, a started selection
should render as status info only — no `LOCK_CHOICE` broadcast, `btnStart` disabled.

### BUG-3 · Song titles/artists are injected as HTML in the admin view
`renderSlot` and `updateStatus` build markup via string-concatenated `innerHTML`:

```js
'<div class="ticket-title">' + song.title + ...
```

The projector correctly uses `textContent`; the admin does not. With the current
hard-coded catalogue this "only" breaks rendering for titles containing `<`, `&`, etc.
— but git history shows a Google Sheets song loader existed (commit `1120137`) and may
return; any external data source turns this into an XSS vector on the admin page.

**Fix:** build ticket DOM with `createElement`/`textContent` (as the projector already
does), or a tiny `escapeHtml` helper for the status line.

### BUG-4 · Dead 5-second polling loop for `window.SONGS`
`restoreAdminStateOrDefaults` polls up to 50 × 100 ms for `window.SONGS`. Since
`data.js` is a synchronous `<script>` loaded before the inline script, `SONGS` is
always defined by `DOMContentLoaded`. This is leftover scaffolding from the removed
async Sheets loader. **Fix:** delete the polling branch (or keep it only if async
loading returns).

---

## 2. Repo hygiene (high impact, zero risk)

| Issue | Detail |
|---|---|
| `node_modules/` committed | 1,142 of 1,151 tracked files are `node_modules/` (the `serve` dev-dependency tree). Bloats every clone/deploy and makes diffs noisy. |
| No `.gitignore` | Root cause of the above. |
| `.cursor/debug.log` committed | 13.8 KB editor debug log tracked in git. |
| `package.json` issues | Name typo `karakoke-engine`; `"main": "index.js"` points at a nonexistent file; `serve` is installed but there is **no `start` script**; placeholder `test` script. |
| No README | No run/deploy instructions (the index.html comment mentions Vercel). |

**Fix:** add `.gitignore` (`node_modules/`, `.cursor/`, OS junk), `git rm -r --cached`
the offenders, fix `package.json` (`"name": "karaoke-engine"`, remove `main`, add
`"start": "serve ."`), add a short README.

---

## 3. Functional robustness — YouTube playback

This is the biggest live-event risk area. Today, playback is fire-and-forget:

1. **No error handling.** The `YT.Player` registers only `onReady`. If a video ID is
   invalid, deleted, region-blocked, or has **embedding disabled** (very common for
   official music videos), the projector shows a silent black screen and the admin
   gets no feedback.
2. **Unverified video IDs.** The 31 hard-coded IDs in `data.js` cannot be verified
   from this audit environment (network egress to youtube.com is blocked), but
   spot-checking against well-known canonical uploads suggests a mix: some are real
   (e.g. `OPf0YbXqDm0` / Uptown Funk, `L_jWHffIx5E` / All Star), while several do not
   match the canonical official uploads and are likely wrong or dead.
3. **Wrong kind of video for karaoke.** The IDs point at official music videos, not
   karaoke/lyric versions — no on-screen lyrics for singers.
4. **No playback control.** `controls: 0, fs: 0` and no admin-side controls means once
   a song starts there is no way to pause, stop, skip, or adjust volume without
   reloading the projector.
5. **No end-of-song flow.** When a video ends the projector goes black and the admin
   is not notified.

**Plan:**
- Add `onError` to the player → broadcast `PLAYER_ERROR {code}` → admin shows a
  prominent warning with the failing song and re-enables selection.
- Add `onStateChange` → on `ENDED`, broadcast `SONG_ENDED` → admin marks the round
  complete (and can optionally auto-generate the next suggestions).
- Add admin transport controls (Pause/Resume, Stop, Replay, volume slider) →
  broadcast `PAUSE / RESUME / STOP / SET_VOLUME` → projector calls the corresponding
  `player.*` methods. This is the single most valuable functional improvement for a
  live event.
- Add a small Node validation script (`npm run check-songs`) that hits
  `https://www.youtube.com/oembed?url=…` for every ID in `data.js` and reports
  missing/unavailable videos — run it before each event. Prefer swapping the
  catalogue to dedicated karaoke channels (Sing King etc.), which are embeddable and
  have lyrics.

---

## 4. Performance improvements

The app is small, so nothing here is on fire — but the projector renders effects over
live video, and the catalogue is designed to grow (Sheets loader), so:

1. **Projector overlay compositing cost.** `.ticket` uses `backdrop-filter: blur(18px)`
   plus large `box-shadow` glows, and *transitions `box-shadow`* — all of this forces
   repaints over a playing video and can drop frames on the typical older
   laptop-driving-a-projector. Swap to: solid `rgba` backgrounds (or much smaller
   blur), glow via a pre-rendered `::after` layer whose **opacity** is transitioned,
   and keep transitions to `transform`/`opacity` only.
2. **Search re-render.** Every keystroke rebuilds a full `<tbody>` with one click
   listener per row, and several code paths re-render all three tables. Fine at 31
   songs; at a few hundred (Sheets) it will jank. Use a single delegated `click`
   listener per tbody, debounce the `input` handler (~150 ms), and only re-render the
   affected slot.
3. **O(n) lookups.** `getSongById`/`find` scans the array; build a `Map` keyed by id
   once at load.
4. **Script loading.** Load the YouTube IFrame API with `async` (the
   `onYouTubeIframeAPIReady` callback pattern already supports it) and add
   `<link rel="preconnect">` for `www.youtube.com` / `i.ytimg.com` so the first video
   starts faster. Extract the ~750-line inline admin script and the projector script
   into `admin.js` / `projector.js` so the browser can cache them across reloads.
5. **Repo weight** (see §2) — 1,100+ committed dependency files slow clones and
   static deploys.

---

## 5. UI / UX improvements

### Admin
- **Category inventory**: show "7 / 10 unplayed" per column so the host can see a
  category running dry. Today an exhausted category just shows "No suggestion yet.
  Use Generate Suggestions." — which is misleading; show "All Power songs have been
  played" instead.
- **Session history**: a played-songs list (in order, with an "unmark" action for
  mistakes). The data (`playedSongIds`) already exists; it's just not visible.
- **Shortcut discoverability**: `Enter` (start), `+` (show/hide), `-` (reset
  selection) and `,` (generate) exist but are undocumented; the header hint only
  mentions 1/2/3. Add them to the hint.
- **Played songs in the manual picker** are greyed out but silently re-selectable;
  add a "played" badge and/or confirm on re-adding one.
- **Danger-zone separation**: "Clear stored state" sits in the main control row next
  to "Start Next Song". Move it visually apart (footer/settings corner) even though
  it has a `confirm()`.
- **Responsiveness**: `.admin-columns` is a non-wrapping flex row; on a narrow window
  the three columns crush. Add a breakpoint to stack columns.
- **Accessibility**: table rows are click-only (no `tabindex`, no `aria-selected`,
  no keyboard navigation); the status line should be `role="status"`/`aria-live` so
  changes are announced; add `:focus-visible` styles; category is communicated by
  color alone in several places — the text labels mostly cover this, keep it that way.

### Projector
- **Idle state**: before the first song the projector is a black screen. Add a simple
  branded idle/attract screen ("Karaoke Flow" + instructions).
- **Now-playing lower third**: after `PLAY_SONG` all tickets hide; briefly show a
  "Now singing: *Title* — Artist" banner that fades out.
- **Ticket content**: the admin ticket shows "YouTube ID: …" — useful to no one at a
  glance; replace with the category label or nothing.

### Both
- Consolidate the tripled per-category markup/logic. A single `CATEGORIES` config
  (`key, label, cssClass, hotkey`) would remove the repeated
  `slot === "power" ? "Power" : …` ternaries in `renderSlot`, `updateStatus`, and the
  three copy-pasted manual-picker columns/handlers.

---

## 6. Code quality / maintainability

1. **Extract inline scripts** → `KaraokeApp/admin.js`, `KaraokeApp/projector.js`
   (caching, linting, testability). Keep pure logic (song picking, state
   (de)serialization) separate from DOM code so it can be unit-tested.
2. **Shared message protocol**: action names (`SHOW_OPTIONS`, `LOCK_CHOICE`,
   `PLAY_SONG`, `HIDE_OPTIONS`, `AUDIENCE_KEY`) are duplicated string literals across
   three files. Export a `KARAOKE_ACTIONS` constant from `logic.js`.
3. **Dead CSS** from the removed Sheets loader: `.sheet-dropdown*`, `.btn-load-*`,
   `.admin-global-search-input`, `.admin-header-right`, `.admin-header-buttons`,
   `.btn-header`, `.col-category` have no remaining markup. Delete (or restore the
   feature — see §7).
4. **State persistence versioning**: `karaoke_admin_state_v1` is parsed with
   try/catch but no shape validation; a malformed value silently half-applies. Add a
   minimal schema check + version bump path.
5. **Tests**: none exist. After extraction, add a small vitest + jsdom suite covering
   `pickSongForCategory` (played-filtering), state save/restore round-trip
   (including the BUG-2 case), and the broadcast handlers.

## 7. Product-level observations (for prioritization)

- The git history shows a **Google Sheets song loader** was built and then removed.
  If a non-technical host is meant to maintain the song list, that feature (or a
  simple JSON upload) is worth restoring *after* BUG-3 is fixed (escaping) — it also
  motivates the Map-based lookups and delegated rendering in §4.
- The projector currently forwards keys 1/2/3 as `AUDIENCE_KEY` even when no options
  are shown; the admin will lock a choice from a stray keypress on the projector
  machine. Consider gating audience keys on `isAudienceShowingOptions`.
- `index.html` redirects with absolute paths (`/KaraokeApp/admin.html`), which breaks
  when hosted under a sub-path or opened via `file://`. Use relative paths.

---

## Prioritized roadmap

| Phase | Items | Effort |
|---|---|---|
| **P0 — Correctness & hygiene** | `.gitignore` + untrack `node_modules`/`.cursor`; BUG-1 named projector window; BUG-2 started-flag persistence; BUG-3 textContent rendering; BUG-4 remove dead polling; `package.json` fixes | ~½ day |
| **P1 — Live-event reliability** | Player `onError`/`onStateChange` + admin error banner; admin transport controls (pause/stop/replay/volume); `npm run check-songs` ID validator; swap catalogue to embeddable karaoke videos | ~1 day |
| **P2 — Performance** | Extract `admin.js`/`projector.js`; async YT API + preconnect; delegated + debounced search rendering; `Map` lookups; projector overlay compositing (drop backdrop-filter/box-shadow transitions) | ~½–1 day |
| **P3 — UX & polish** | Category counters + exhausted-state copy; played-history panel; shortcut hints; responsive breakpoints; a11y (aria-live, focus-visible, keyboard rows); projector idle screen + now-playing lower third; dead CSS pruning; `CATEGORIES` config refactor; README; basic tests | ~1–2 days |
