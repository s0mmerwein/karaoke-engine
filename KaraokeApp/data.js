// Song catalogue for the Karaoke Flow app.
// This file is loaded directly via <script src="data.js"></script>
// and exposes a global constant `SONGS`.
//
// Songs are categorized by singing difficulty:
//   easy   – narrow range, forgiving singalongs (green)
//   middle – needs some range or stamina (amber)
//   hard   – "very hard": big belts, extreme range, long holds (red)
// Ids are stable identifiers (played-history in localStorage references
// them), so keep them unchanged when re-categorizing or reordering.
//
// Each song also carries a `vibe` that drives a subtle idle animation on
// its projector ticket (see style.css / projector.js):
//   rock      – quick head-bang nod
//   party     – bouncy double hop
//   groove    – funky side-to-side shimmy
//   singalong – slow arm-in-arm crowd sway
//   ballad    – barely-there breathing swell
//   anthem    – dramatic slow swell with a glow

const SONGS = [
  // --- EASY (GREEN) ---
  { id: 14, artist: "Joan Jett", title: "I Love Rock 'n' Roll", youtubeId: "iLq3Nn3CgIw", category: "easy", vibe: "rock" },
  { id: 15, artist: "Spice Girls", title: "Wannabe", youtubeId: "fw-2t1r8yMc", category: "easy", vibe: "party" },
  { id: 17, artist: "Smash Mouth", title: "All Star", youtubeId: "L_jWHffIx5E", category: "easy", vibe: "party" },
  { id: 18, artist: "Die Toten Hosen", title: "Tage wie diese", youtubeId: "j09hpp3axJY", category: "easy", vibe: "anthem" },
  { id: 22, artist: "Eric Clapton", title: "Tears in Heaven", youtubeId: "fW5l1d0eJQM", category: "easy", vibe: "ballad" },
  { id: 23, artist: "R.E.M.", title: "Losing My Religion", youtubeId: "3Z554iY-t1c", category: "easy", vibe: "singalong" },
  { id: 10, artist: "Neil Diamond", title: "Sweet Caroline", youtubeId: "21UJnJkNQXc", category: "easy", vibe: "singalong" },
  { id: 12, artist: "The Beatles", title: "Hey Jude", youtubeId: "J1zVqriJqfE", category: "easy", vibe: "singalong" },
  { id: 25, artist: "John Denver", title: "Take Me Home, Country Roads", youtubeId: "QxIi-M_wGgw", category: "easy", vibe: "singalong" },
  { id: 27, artist: "Nena", title: "99 Luftballons", youtubeId: "B5q0rXq50tQ", category: "easy", vibe: "party" },
  { id: 29, artist: "Billy Joel", title: "Piano Man", youtubeId: "7fN-Xo_9QYE", category: "easy", vibe: "singalong" },
  { id: 30, artist: "Oasis", title: "Wonderwall", youtubeId: "h_Kpw9WqWBs", category: "easy", vibe: "singalong" },

  // --- MIDDLE (AMBER) ---
  { id: 1, artist: "Bon Jovi", title: "It's My Life", youtubeId: "y3rHoAicOo4", category: "middle", vibe: "rock" },
  { id: 4, artist: "Survivor", title: "Eye of the Tiger", youtubeId: "83ZFZPhxskc", category: "middle", vibe: "rock" },
  { id: 13, artist: "The Killers", title: "Mr. Brightside", youtubeId: "LBr7kECsjcQ", category: "middle", vibe: "rock" },
  { id: 16, artist: "Mark Ronson ft. Bruno Mars", title: "Uptown Funk", youtubeId: "OPf0YbXqDm0", category: "middle", vibe: "groove" },
  { id: 6, artist: "John Legend", title: "All of Me", youtubeId: "WtFbwuDiZwY", category: "middle", vibe: "ballad" },
  { id: 7, artist: "Sam Smith", title: "Stay With Me", youtubeId: "emdPQkDl6UI", category: "middle", vibe: "ballad" },
  { id: 9, artist: "Frank Sinatra", title: "My Way", youtubeId: "qr7bmNeIr_8", category: "middle", vibe: "anthem" },
  { id: 11, artist: "ABBA", title: "Dancing Queen", youtubeId: "ir14kJwqaus", category: "middle", vibe: "groove" },
  { id: 26, artist: "Backstreet Boys", title: "I Want It That Way", youtubeId: "r2M02_1508k", category: "middle", vibe: "party" },
  { id: 28, artist: "Udo Jürgens", title: "Griechischer Wein", youtubeId: "h-g0LpC-w9I", category: "middle", vibe: "singalong" },

  // --- VERY HARD (RED) ---
  { id: 2, artist: "AC/DC", title: "Highway to Hell", youtubeId: "q2UpIZ8h0Zo", category: "hard", vibe: "rock" },
  { id: 3, artist: "Queen", title: "Don't Stop Me Now", youtubeId: "MHi9mKq0slA", category: "hard", vibe: "party" },
  { id: 5, artist: "Adele", title: "Someone Like You", youtubeId: "9OCGGaKinQE", category: "hard", vibe: "ballad" },
  { id: 8, artist: "Whitney Houston", title: "I Will Always Love You", youtubeId: "SF398XsD1r4", category: "hard", vibe: "ballad" },
  { id: 19, artist: "Lady Gaga & Bradley Cooper", title: "Shallow", youtubeId: "bo_efYhYU2A", category: "hard", vibe: "anthem" },
  { id: 20, artist: "Céline Dion", title: "My Heart Will Go On", youtubeId: "3gK_2XdjOdY", category: "hard", vibe: "ballad" },
  { id: 21, artist: "Bonnie Tyler", title: "Total Eclipse of the Heart", youtubeId: "7bf26P8R6CQ", category: "hard", vibe: "anthem" },
  { id: 24, artist: "Lewis Capaldi", title: "Someone You Loved", youtubeId: "M2Q2WfV1Z5g", category: "hard", vibe: "ballad" },
  { id: 31, artist: "Queen", title: "Bohemian Rhapsody", youtubeId: "vsl3gBVO2k4", category: "hard", vibe: "anthem" },
];

// Expose as global so admin.html can access window.SONGS
if (typeof window !== "undefined") {
  window.SONGS = SONGS;
}

// Node export for tooling (scripts/check-songs.mjs) and tests.
if (typeof module !== "undefined" && module.exports) {
  module.exports = { SONGS };
}
