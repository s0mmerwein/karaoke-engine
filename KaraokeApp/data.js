// Simple song catalogue for the Karaoke Flow MVP.
// This file is loaded directly via <script src="data.js"></script>
// and exposes a global constant `SONGS`.

const SONGS = [
  // --- POWER TRACKS (RED) ---
  { id: 1, artist: "Bon Jovi", title: "It's My Life", youtubeId: "y3rHoAicOo4", category: "power" },
  { id: 2, artist: "AC/DC", title: "Highway to Hell", youtubeId: "q2UpIZ8h0Zo", category: "power" },
  { id: 3, artist: "Queen", title: "Don't Stop Me Now", youtubeId: "MHi9mKq0slA", category: "power" },
  { id: 4, artist: "Survivor", title: "Eye of the Tiger", youtubeId: "83ZFZPhxskc", category: "power" },
  { id: 13, artist: "The Killers", title: "Mr. Brightside", youtubeId: "LBr7kECsjcQ", category: "power" },
  { id: 14, artist: "Joan Jett", title: "I Love Rock 'n' Roll", youtubeId: "iLq3Nn3CgIw", category: "power" },
  { id: 15, artist: "Spice Girls", title: "Wannabe", youtubeId: "fw-2t1r8yMc", category: "power" },
  { id: 16, artist: "Mark Ronson ft. Bruno Mars", title: "Uptown Funk", youtubeId: "OPf0YbXqDm0", category: "power" },
  { id: 17, artist: "Smash Mouth", title: "All Star", youtubeId: "L_jWHffIx5E", category: "power" },
  { id: 18, artist: "Die Toten Hosen", title: "Tage wie diese", youtubeId: "j09hpp3axJY", category: "power" },

  // --- EMOTIONAL TRACKS (BLUE) ---
  { id: 5, artist: "Adele", title: "Someone Like You", youtubeId: "9OCGGaKinQE", category: "emotional" },
  { id: 6, artist: "John Legend", title: "All of Me", youtubeId: "WtFbwuDiZwY", category: "emotional" },
  { id: 7, artist: "Sam Smith", title: "Stay With Me", youtubeId: "emdPQkDl6UI", category: "emotional" },
  { id: 8, artist: "Whitney Houston", title: "I Will Always Love You", youtubeId: "SF398XsD1r4", category: "emotional" },
  { id: 19, artist: "Lady Gaga & Bradley Cooper", title: "Shallow", youtubeId: "bo_efYhYU2A", category: "emotional" },
  { id: 20, artist: "Céline Dion", title: "My Heart Will Go On", youtubeId: "3gK_2XdjOdY", category: "emotional" },
  { id: 21, artist: "Bonnie Tyler", title: "Total Eclipse of the Heart", youtubeId: "7bf26P8R6CQ", category: "emotional" },
  { id: 22, artist: "Eric Clapton", title: "Tears in Heaven", youtubeId: "fW5l1d0eJQM", category: "emotional" },
  { id: 23, artist: "R.E.M.", title: "Losing My Religion", youtubeId: "3Z554iY-t1c", category: "emotional" },
  { id: 24, artist: "Lewis Capaldi", title: "Someone You Loved", youtubeId: "M2Q2WfV1Z5g", category: "emotional" },

  // --- EVERGREENS (GREEN) ---
  { id: 9, artist: "Frank Sinatra", title: "My Way", youtubeId: "qr7bmNeIr_8", category: "evergreen" },
  { id: 10, artist: "Neil Diamond", title: "Sweet Caroline", youtubeId: "21UJnJkNQXc", category: "evergreen" },
  { id: 11, artist: "ABBA", title: "Dancing Queen", youtubeId: "ir14kJwqaus", category: "evergreen" },
  { id: 12, artist: "The Beatles", title: "Hey Jude", youtubeId: "J1zVqriJqfE", category: "evergreen" },
  { id: 25, artist: "John Denver", title: "Take Me Home, Country Roads", youtubeId: "QxIi-M_wGgw", category: "evergreen" },
  { id: 26, artist: "Backstreet Boys", title: "I Want It That Way", youtubeId: "r2M02_1508k", category: "evergreen" },
  { id: 27, artist: "Nena", title: "99 Luftballons", youtubeId: "B5q0rXq50tQ", category: "evergreen" },
  { id: 28, artist: "Udo Jürgens", title: "Griechischer Wein", youtubeId: "h-g0LpC-w9I", category: "evergreen" },
  { id: 29, artist: "Billy Joel", title: "Piano Man", youtubeId: "7fN-Xo_9QYE", category: "evergreen" },
  { id: 30, artist: "Oasis", title: "Wonderwall", youtubeId: "h_Kpw9WqWBs", category: "evergreen" },
  { id: 31, artist: "Queen", title: "Bohemian Rhapsody", youtubeId: "vsl3gBVO2k4", category: "evergreen" },
];

// Expose as global so admin.html can access window.SONGS
if (typeof window !== "undefined") {
  window.SONGS = SONGS;
}


