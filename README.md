# Karaoke Engine

A two-window live karaoke controller for hosted karaoke nights:

- **Admin view** (`KaraokeApp/admin.html`) — runs on the host's laptop.
  Generates three song suggestions by difficulty (Easy / Middle / Very Hard),
  shows them to the audience, locks the crowd's choice, and starts playback.
  Includes a manual song picker, playback transport
  (pause/stop/replay/volume), and a session history.
- **Projector view** (`KaraokeApp/projector.html`) — runs full-screen on the
  projector/TV. Plays the YouTube video and renders the ticket overlay, idle
  screen, and now-playing banner.

The two windows communicate via `BroadcastChannel`, so they must be opened in
the **same browser profile on the same machine** (tabs or separate windows both
work). Admin state (played songs, suggestions, current selection) persists in
`localStorage` across reloads.

## Running

```bash
npm install
npm start          # serves the repo at http://localhost:3000
```

Open `http://localhost:3000` — it redirects to the admin view. Use the
**Open projector window** button to launch the projector, then move that window
to the projector display and make it full-screen.

## Keyboard shortcuts (admin)

| Key | Action |
|---|---|
| `1` / `2` / `3` | Lock the Easy / Middle / Very Hard suggestion (the "buzzer") |
| `,` | Generate suggestions |
| `+` | Show/hide options on the projector |
| `Enter` | Start the locked song |
| `-` | Reset the locked selection |

Keys `1`–`3` also work while the projector window has focus (only while
options are visible to the audience).

## Song catalogue

Songs live in `KaraokeApp/data.js` — plain objects with `id`, `artist`,
`title`, `youtubeId`, and `category` by singing difficulty
(`easy` | `middle` | `hard`, where `hard` displays as "Very Hard").

Before an event, validate that every video still exists and is embeddable:

```bash
npm run check-songs
```

Videos with embedding disabled (common for official music videos) will fail
with a 401/403 — swap those for karaoke/lyric versions, which also give the
singers on-screen lyrics. If a video fails during a show anyway, the admin
view displays a warning banner with the reason.

## Development

```bash
npm test           # unit tests (node:test, no dependencies)
```

Code layout: `KaraokeApp/core.js` holds pure, DOM-free logic (song picking,
search filtering, state (de)serialization) and is shared between the browser
and Node tests; `logic.js` wraps `BroadcastChannel` and defines the message
protocol; `admin.js` / `projector.js` are the page controllers.
