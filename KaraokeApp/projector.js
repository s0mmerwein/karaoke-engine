// Projector page controller: YouTube player, ticket overlay, idle screen,
// now-playing banner. Talks to the admin page via BroadcastChannel (logic.js).

(function () {
  "use strict";

  const ACTIONS = window.KARAOKE_ACTIONS;

  let player = null;
  let playerReady = false;
  let pendingVideoId = null;
  let currentSong = null;
  // Audience keys are only forwarded while options are actually on screen,
  // so stray keypresses on the projector machine can't lock a choice.
  let optionsVisible = false;
  let nowPlayingTimer = null;

  const ticketEls = {};
  let idleScreen = null;
  let nowPlaying = null;
  let nowPlayingText = null;

  // YouTube player

  function createPlayer() {
    player = new YT.Player("player", {
      width: "100%",
      height: "100%",
      videoId: "",
      playerVars: {
        autoplay: 0,
        controls: 0,
        rel: 0,
        fs: 0,
        playsinline: 1,
      },
      events: {
        onReady: onPlayerReady,
        onError: onPlayerError,
        onStateChange: onPlayerStateChange,
      },
    });
  }

  function onPlayerReady() {
    playerReady = true;
    if (pendingVideoId) {
      player.loadVideoById(pendingVideoId);
      player.playVideo();
      pendingVideoId = null;
    }
  }

  function onPlayerError(ev) {
    window.sendKaraokeMessage(ACTIONS.PLAYER_ERROR, {
      code: ev && ev.data,
      song: currentSong,
    });
    hideNowPlaying();
    showIdle();
  }

  function onPlayerStateChange(ev) {
    const state =
      ev.data === YT.PlayerState.PLAYING
        ? "playing"
        : ev.data === YT.PlayerState.PAUSED
        ? "paused"
        : ev.data === YT.PlayerState.ENDED
        ? "ended"
        : null;
    if (!state) return;

    if (state === "playing") hideIdle();
    if (state === "ended") {
      hideNowPlaying();
      showIdle();
    }

    window.sendKaraokeMessage(ACTIONS.PLAYER_STATE, {
      state,
      song: currentSong,
    });
  }

  // The YouTube IFrame API calls this global once loaded (the API script is
  // loaded async; this file runs first and defines the callback).
  window.onYouTubeIframeAPIReady = function () {
    createPlayer();
  };

  // Idle screen & now-playing banner

  function showIdle() {
    if (idleScreen) idleScreen.classList.add("visible");
  }

  function hideIdle() {
    if (idleScreen) idleScreen.classList.remove("visible");
  }

  function showNowPlaying(song) {
    if (!nowPlaying || !nowPlayingText || !song) return;
    nowPlayingText.textContent = song.title + " — " + song.artist;
    nowPlaying.classList.add("visible");
    window.clearTimeout(nowPlayingTimer);
    nowPlayingTimer = window.setTimeout(hideNowPlaying, 8000);
  }

  function hideNowPlaying() {
    window.clearTimeout(nowPlayingTimer);
    if (nowPlaying) nowPlaying.classList.remove("visible");
  }

  // Ticket overlay

  const SLOTS = ["easy", "middle", "hard"];

  // Vibe pulses: each visible ticket replays its song's vibe animation
  // (style.css) on its own randomized ~30s cadence so the cards never move
  // in sync. A locked ticket plays the "chosen" animation instead.
  const VIBES = ["rock", "party", "groove", "singalong", "ballad", "anthem"];
  const VIBE_FALLBACK = { easy: "singalong", middle: "party", hard: "anthem" };
  const VIBE_PULSE_MIN_MS = 24000;
  const VIBE_PULSE_MAX_MS = 38000;
  const VIBE_FIRST_MIN_MS = 8000;
  const VIBE_FIRST_MAX_MS = 20000;
  // Class removal happens on a timer (not animationend) so a pulse can never
  // leave a stale class behind; must exceed the longest keyframe duration.
  const VIBE_ANIM_MAX_MS = 3600;

  const vibePulseTimers = {};
  const vibeCleanupTimers = {};
  // Songs currently shown per slot, so a late SET_VIBES broadcast (AI
  // classification finishing after the cards are already on screen) can
  // silently retarget their vibes.
  const slotSongs = {};
  let vibesById = {};

  function songVibe(song, slot) {
    // The admin broadcasts AI results after load; the map is fresher than
    // whatever vibe the payload carried at the time it was sent.
    const broadcast = song && song.id != null ? vibesById[song.id] : null;
    if (VIBES.indexOf(broadcast) !== -1) return broadcast;
    const vibe = song && song.vibe;
    return VIBES.indexOf(vibe) !== -1 ? vibe : VIBE_FALLBACK[slot];
  }

  function applyVibeMap(vibes) {
    vibesById = vibes || {};
    Object.entries(slotSongs).forEach(([slot, song]) => {
      const el = ticketEls[slot];
      if (el && song && el.classList.contains("visible")) {
        el.dataset.vibe = songVibe(song, slot);
      }
    });
  }

  function randomBetween(min, max) {
    return min + Math.random() * (max - min);
  }

  function stopVibePulses(slot) {
    window.clearTimeout(vibePulseTimers[slot]);
    window.clearTimeout(vibeCleanupTimers[slot]);
    const el = ticketEls[slot];
    if (el) el.classList.remove("vibe-anim", "chosen-anim");
  }

  function fireVibePulse(slot) {
    const el = ticketEls[slot];
    if (!el || !el.classList.contains("visible")) return;
    el.classList.add(el.classList.contains("locked") ? "chosen-anim" : "vibe-anim");
    window.clearTimeout(vibeCleanupTimers[slot]);
    vibeCleanupTimers[slot] = window.setTimeout(() => {
      el.classList.remove("vibe-anim", "chosen-anim");
    }, VIBE_ANIM_MAX_MS);
  }

  function scheduleVibePulses(slot, firstDelayMs) {
    window.clearTimeout(vibePulseTimers[slot]);
    const delay =
      firstDelayMs != null
        ? firstDelayMs
        : randomBetween(VIBE_PULSE_MIN_MS, VIBE_PULSE_MAX_MS);
    vibePulseTimers[slot] = window.setTimeout(() => {
      fireVibePulse(slot);
      scheduleVibePulses(slot);
    }, delay);
  }

  function initTickets() {
    SLOTS.forEach((slot) => {
      const el = document.getElementById("ticket-" + slot);
      if (el) ticketEls[slot] = el;
    });
    hideAllTickets();
  }

  function hideAllTickets() {
    optionsVisible = false;
    Object.entries(ticketEls).forEach(([slot, el]) => {
      stopVibePulses(slot);
      delete slotSongs[slot];
      el.classList.remove("visible", "locked");
      el.classList.add("hidden");
      el.removeAttribute("data-vibe");
      const titleEl = el.querySelector(".ticket-title");
      const artistEl = el.querySelector(".ticket-artist");
      if (titleEl) titleEl.textContent = "–";
      if (artistEl) artistEl.textContent = "–";
    });
  }

  function showOptions(payload) {
    const bySlot = payload || {};
    let anyVisible = false;

    SLOTS.forEach((slot) => {
      const song = bySlot[slot];
      const el = ticketEls[slot];
      if (!el) return;

      el.classList.remove("locked", "hidden");
      stopVibePulses(slot);
      if (song) {
        const titleEl = el.querySelector(".ticket-title");
        const artistEl = el.querySelector(".ticket-artist");
        if (titleEl) titleEl.textContent = song.title || "";
        if (artistEl) artistEl.textContent = song.artist || "";
        slotSongs[slot] = song;
        el.dataset.vibe = songVibe(song, slot);
        el.classList.add("visible");
        anyVisible = true;
        scheduleVibePulses(
          slot,
          randomBetween(VIBE_FIRST_MIN_MS, VIBE_FIRST_MAX_MS)
        );
      } else {
        delete slotSongs[slot];
        el.classList.remove("visible");
        el.classList.add("hidden");
        el.removeAttribute("data-vibe");
      }
    });

    optionsVisible = anyVisible;
  }

  function lockChoice(payload) {
    const { slot, song } = payload || {};
    if (!slot || !ticketEls[slot]) return;

    optionsVisible = false;
    Object.entries(ticketEls).forEach(([key, el]) => {
      stopVibePulses(key);
      if (key === slot) {
        el.classList.add("locked", "visible");
        el.classList.remove("hidden");
        if (song) {
          const titleEl = el.querySelector(".ticket-title");
          const artistEl = el.querySelector(".ticket-artist");
          if (titleEl) titleEl.textContent = song.title || "";
          if (artistEl) artistEl.textContent = song.artist || "";
          slotSongs[key] = song;
          el.dataset.vibe = songVibe(song, key);
        }
        // Celebrate the pick once the lock transition has settled, then keep
        // the chosen animation on the usual randomized cadence.
        scheduleVibePulses(key, 400);
      } else {
        delete slotSongs[key];
        el.classList.remove("locked", "visible");
        el.classList.add("hidden");
        el.removeAttribute("data-vibe");
      }
    });
  }

  function playSong(payload) {
    const youtubeId = payload && payload.youtubeId;
    if (!youtubeId) return;

    currentSong = (payload && payload.song) || null;
    hideAllTickets();
    hideIdle();
    showNowPlaying(currentSong);

    if (playerReady && player && typeof player.loadVideoById === "function") {
      player.loadVideoById(youtubeId);
      player.playVideo();
    } else {
      pendingVideoId = youtubeId;
    }
  }

  function handlePlayerControl(payload) {
    if (!playerReady || !player) return;
    const command = payload && payload.command;

    switch (command) {
      case "pause":
        player.pauseVideo();
        break;
      case "resume":
        player.playVideo();
        break;
      case "stop":
        player.stopVideo();
        hideNowPlaying();
        showIdle();
        // stopVideo does not fire ENDED; report the stop explicitly.
        window.sendKaraokeMessage(ACTIONS.PLAYER_STATE, {
          state: "stopped",
          song: currentSong,
        });
        break;
      case "replay":
        player.seekTo(0, true);
        player.playVideo();
        showNowPlaying(currentSong);
        break;
      case "volume":
        if (payload && typeof payload.value === "number") {
          player.setVolume(Math.max(0, Math.min(100, payload.value)));
        }
        break;
      default:
        break;
    }
  }

  function handleMessage(msg) {
    if (!msg || !msg.action) return;
    const payload = msg.payload || {};

    switch (msg.action) {
      case ACTIONS.SHOW_OPTIONS:
        showOptions(payload);
        break;
      case ACTIONS.HIDE_OPTIONS:
        hideAllTickets();
        break;
      case ACTIONS.LOCK_CHOICE:
        lockChoice(payload);
        break;
      case ACTIONS.PLAY_SONG:
        playSong(payload);
        break;
      case ACTIONS.PLAYER_CONTROL:
        handlePlayerControl(payload);
        break;
      case ACTIONS.SET_VIBES:
        applyVibeMap(payload.vibes);
        break;
      default:
        break;
    }
  }

  function setupKeyboard() {
    window.addEventListener("keydown", (ev) => {
      const key = ev.key;
      if ((key === "1" || key === "2" || key === "3") && optionsVisible) {
        window.sendKaraokeMessage(ACTIONS.AUDIENCE_KEY, { key });
      }
    });
  }

  window.addEventListener("DOMContentLoaded", () => {
    idleScreen = document.getElementById("idle-screen");
    nowPlaying = document.getElementById("now-playing");
    nowPlayingText = document.getElementById("now-playing-text");
    initTickets();
    setupKeyboard();
    showIdle();
    window.onKaraokeMessage(handleMessage);
  });
})();
