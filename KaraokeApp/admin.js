// Admin page controller for the Karaoke Flow app.
// Pure logic lives in core.js; the BroadcastChannel wrapper in logic.js.

(function () {
  "use strict";

  const {
    CATEGORIES,
    GOLDEN_SLOT,
    buildSongIndex,
    pickSongForCategory,
    filterSongs,
    categoryCounts,
    canGoldenHit,
    serializeAdminState,
    deserializeAdminState,
  } = window.KaraokeCore;
  const ACTIONS = window.KARAOKE_ACTIONS;

  const SONGS = Array.isArray(window.SONGS) ? window.SONGS : [];
  const songIndex = buildSongIndex(SONGS);
  const SLOTS = CATEGORIES.map((c) => c.key);
  const categoryBySlot = {};
  CATEGORIES.forEach((c) => {
    categoryBySlot[c.key] = c;
  });

  const ADMIN_STORAGE_KEY = "karaoke_admin_state_v1";

  // Local state
  const playedSongIds = new Set();
  const currentSuggestions = { easy: null, middle: null, hard: null };
  let nextSong = null;
  let nextSlot = null;
  let hasStarted = false;
  let isAudienceShowingOptions = false;
  // Golden buzzer: armed = the projector shows the glowing "press 4" invite;
  // hit pending = someone pressed it and the DJ owes a pick or a dismissal.
  // A hit is one-shot: it consumes the arm, re-arming is an explicit DJ act.
  let goldenArmed = false;
  let goldenHitPending = false;
  // Last state reported by the projector's player: "playing" | "paused" |
  // "ended" | "stopped" | "error" | null (unknown, e.g. after a reload).
  let playerState = null;

  // DOM references
  const btnGenerate = document.getElementById("btn-generate");
  const btnShow = document.getElementById("btn-show");
  const btnStart = document.getElementById("btn-start");
  const btnClearSelection = document.getElementById("btn-clear-selection");
  const btnClearState = document.getElementById("btn-clear-state");
  const btnOpenProjector = document.getElementById("btn-open-projector");
  const statusText = document.getElementById("status-text");
  const btnPauseResume = document.getElementById("btn-pause-resume");
  const btnReplay = document.getElementById("btn-replay");
  const btnStop = document.getElementById("btn-stop");
  const volumeSlider = document.getElementById("volume-slider");
  const playbackStateText = document.getElementById("playback-state");
  const errorBanner = document.getElementById("error-banner");
  const errorBannerText = document.getElementById("error-banner-text");
  const btnDismissError = document.getElementById("btn-dismiss-error");
  const historyList = document.getElementById("history-list");
  const historyEmpty = document.getElementById("history-empty");
  const btnGoldenArm = document.getElementById("btn-golden-arm");
  const btnGoldenDismiss = document.getElementById("btn-golden-dismiss");
  const btnGoldenLock = document.getElementById("btn-golden-lock");
  const goldenStateText = document.getElementById("golden-state-text");
  const goldenRequestPanel = document.getElementById("golden-request");
  const goldenSearchInput = document.getElementById("golden-search");
  const goldenSongTableBody = document.getElementById("golden-song-tbody");
  let goldenSelectedSongId = null;

  const slotEls = {};
  const countEls = {};
  const manualSongTableBodies = {};
  const manualSearchInputs = {};
  const btnManualSetBySlot = {};
  const manualSelectedSongId = {};
  SLOTS.forEach((slot) => {
    slotEls[slot] = document.getElementById("slot-" + slot);
    countEls[slot] = document.getElementById("count-" + slot);
    manualSongTableBodies[slot] = document.getElementById(
      "manual-song-tbody-" + slot
    );
    manualSearchInputs[slot] = document.getElementById("manual-search-" + slot);
    btnManualSetBySlot[slot] = document.getElementById(
      "btn-manual-set-" + slot
    );
    manualSelectedSongId[slot] = null;
  });

  function debounce(fn, ms) {
    let timer = null;
    return function (...args) {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => fn.apply(this, args), ms);
    };
  }

  function span(className, text) {
    const el = document.createElement("span");
    if (className) el.className = className;
    el.textContent = text;
    return el;
  }

  function hasAnySuggestions() {
    return SLOTS.some((slot) => !!currentSuggestions[slot]);
  }

  // Payload for SHOW_OPTIONS broadcasts: one song (or null) per slot key.
  function optionsPayload() {
    const payload = {};
    SLOTS.forEach((slot) => {
      payload[slot] = currentSuggestions[slot];
    });
    return payload;
  }

  // Persistence

  function saveAdminState() {
    try {
      const state = serializeAdminState({
        playedSongIds,
        suggestions: currentSuggestions,
        nextSong,
        nextSlot,
        started: hasStarted,
        isAudienceShowingOptions,
        goldenArmed,
        goldenHitPending,
      });
      window.localStorage.setItem(ADMIN_STORAGE_KEY, JSON.stringify(state));
    } catch (err) {
      console.warn("[KARAOKE] Failed to save admin state", err);
    }
  }

  function clearStoredAdminState() {
    const confirmed = window.confirm(
      "Clear all saved karaoke state (played songs, suggestions, selection)? This cannot be undone."
    );
    if (!confirmed) return;

    try {
      window.localStorage.removeItem(ADMIN_STORAGE_KEY);
    } catch (err) {
      console.warn("[KARAOKE] Failed to clear stored admin state", err);
    }

    playedSongIds.clear();
    SLOTS.forEach((slot) => {
      currentSuggestions[slot] = null;
    });
    nextSong = null;
    nextSlot = null;
    hasStarted = false;
    playerState = null;
    goldenArmed = false;
    goldenHitPending = false;
    setAudienceShowingOptions(false);
    hideErrorBanner();

    renderEverything();

    // Ensure the projector does not keep showing stale options.
    window.sendKaraokeMessage(ACTIONS.HIDE_OPTIONS, {});
    broadcastGoldenState();
  }

  // Projector window: a named target lets the browser focus/reuse the
  // existing projector tab. (window.open with "noopener" returns null, so a
  // stored handle can never work.)
  function openOrFocusProjector() {
    window.open("projector.html", "karaoke_projector");
  }

  function setAudienceShowingOptions(isShowing) {
    isAudienceShowingOptions = !!isShowing;
    document.body.classList.toggle(
      "audience-showing-options",
      isAudienceShowingOptions
    );
    updateStatus();
  }

  // Rendering

  // Decorative rekordbox-style waveform strip; deterministic per song so the
  // same track always draws the same shape.
  function buildWaveform(song) {
    const wave = document.createElement("div");
    wave.className = "ticket-wave";
    for (let i = 0; i < 48; i++) {
      const bar = document.createElement("span");
      const height =
        18 +
        Math.abs(Math.sin(i * 0.83 + song.id * 1.7)) * 52 +
        Math.abs(Math.sin(i * 2.71 + song.id)) * 30;
      bar.style.height = height.toFixed(0) + "%";
      wave.appendChild(bar);
    }
    return wave;
  }

  function renderSlot(slot) {
    const song = currentSuggestions[slot];
    const slotEl = slotEls[slot];
    if (!slotEl) return;
    const shell = slotEl.querySelector(".admin-ticket-shell");
    if (!shell) return;

    shell.textContent = "";

    const category = categoryBySlot[slot];

    if (!song) {
      const empty = document.createElement("div");
      empty.className = "admin-ticket-empty";
      const { remaining } = categoryCounts(SONGS, slot, playedSongIds);
      empty.textContent =
        remaining === 0
          ? "All " + category.label + " songs have been played."
          : "No suggestion yet. Use Generate Suggestions.";
      shell.appendChild(empty);
      return;
    }

    const ticket = document.createElement("div");
    ticket.className =
      "ticket ticket-" +
      slot +
      " visible" +
      (nextSong && nextSong.id === song.id ? " locked" : "");

    const inner = document.createElement("div");
    inner.className = "ticket-inner";
    const key = document.createElement("div");
    key.className = "ticket-key";
    key.textContent = category.hotkey;
    const label = document.createElement("div");
    label.className = "ticket-label";
    label.textContent = category.label;
    const title = document.createElement("div");
    title.className = "ticket-title";
    title.textContent = song.title;
    const artist = document.createElement("div");
    artist.className = "ticket-artist";
    artist.textContent = song.artist;

    inner.appendChild(key);
    inner.appendChild(label);
    inner.appendChild(title);
    inner.appendChild(artist);
    inner.appendChild(buildWaveform(song));
    ticket.appendChild(inner);
    shell.appendChild(ticket);
  }

  function renderAllSlots() {
    SLOTS.forEach(renderSlot);
  }

  function renderCounts() {
    SLOTS.forEach((slot) => {
      const el = countEls[slot];
      if (!el) return;
      const { total, remaining } = categoryCounts(SONGS, slot, playedSongIds);
      el.textContent = remaining + " / " + total + " left";
      el.classList.toggle("depleted", remaining === 0);
    });
  }

  function renderHistory() {
    if (!historyList) return;
    historyList.textContent = "";
    const played = Array.from(playedSongIds);
    if (historyEmpty) historyEmpty.hidden = played.length > 0;

    played.forEach((id) => {
      const song = songIndex.get(id);
      const li = document.createElement("li");
      const text = span(
        "admin-history-song",
        song ? song.title + " — " + song.artist : "Unknown song #" + id
      );
      if (song) {
        text.classList.add("text-" + song.category);
      }
      const unmark = document.createElement("button");
      unmark.type = "button";
      unmark.className = "btn btn-small btn-ghost";
      unmark.textContent = "Unmark";
      unmark.dataset.unmarkId = String(id);
      unmark.title = "Remove from played list so it can be suggested again";
      li.appendChild(text);
      li.appendChild(unmark);
      historyList.appendChild(li);
    });
  }

  function updateStatus() {
    if (!statusText) return;
    statusText.textContent = "";

    if (!nextSong) {
      statusText.appendChild(
        document.createTextNode("No selection made yet. Use ")
      );
      CATEGORIES.forEach((category, i) => {
        if (i > 0) {
          statusText.appendChild(
            document.createTextNode(i === CATEGORIES.length - 1 ? " or " : ", ")
          );
        }
        statusText.appendChild(
          span("text-" + category.key, category.hotkey)
        );
      });
      statusText.appendChild(document.createTextNode("."));
    } else {
      const category = categoryBySlot[nextSlot];
      statusText.appendChild(
        document.createTextNode(hasStarted ? "Started: " : "Next: ")
      );
      statusText.appendChild(span("admin-status-strong", nextSong.title));
      statusText.appendChild(document.createTextNode(" – " + nextSong.artist));
      if (nextSlot === GOLDEN_SLOT) {
        statusText.appendChild(document.createTextNode(" ("));
        statusText.appendChild(span("text-golden", "Golden Buzzer"));
        statusText.appendChild(document.createTextNode(")"));
      } else if (category) {
        statusText.appendChild(
          document.createTextNode(" (" + category.label + ")")
        );
      }
    }

    if (isAudienceShowingOptions) {
      statusText.appendChild(document.createTextNode(" – "));
      statusText.appendChild(span("admin-status-onair", "shown to audience"));
    }
  }

  function updatePlaybackControls() {
    const active = hasStarted;
    if (btnPauseResume) {
      btnPauseResume.disabled = !active;
      btnPauseResume.textContent =
        playerState === "paused" ? "Resume" : "Pause";
    }
    if (btnReplay) btnReplay.disabled = !active;
    if (btnStop) btnStop.disabled = !active;

    if (playbackStateText) {
      let text;
      switch (playerState) {
        case "playing":
          text = "Playing on projector…";
          break;
        case "paused":
          text = "Paused.";
          break;
        case "ended":
          text = "Song finished – generate the next round!";
          break;
        case "stopped":
          text = "Stopped.";
          break;
        case "error":
          text = "Playback failed – see the warning above.";
          break;
        default:
          text = hasStarted
            ? "Waiting for the projector to report…"
            : "No song started yet.";
      }
      playbackStateText.textContent = text;
    }
  }

  function updateControlButtons() {
    const hasLockedChoice = !!nextSong && !!nextSlot && !hasStarted;
    if (btnShow) {
      btnShow.disabled = !!nextSong || !hasAnySuggestions();
    }
    if (btnStart) btnStart.disabled = !hasLockedChoice;
    if (btnClearSelection) btnClearSelection.disabled = !hasLockedChoice;
  }

  function renderEverything() {
    renderAllSlots();
    renderCounts();
    renderHistory();
    renderManualSongOptions();
    renderGoldenSongOptions();
    renderGoldenPanel();
    updateControlButtons();
    updatePlaybackControls();
    updateStatus();
  }

  // Error banner

  function showErrorBanner(payload) {
    if (!errorBanner || !errorBannerText) return;
    const code = payload && payload.code;
    const song = payload && payload.song;
    let reason;
    switch (code) {
      case 2:
        reason = "the video ID is invalid";
        break;
      case 5:
        reason = "the player hit an HTML5 playback error";
        break;
      case 100:
        reason = "the video was not found (deleted or private)";
        break;
      case 101:
      case 150:
        reason = "the video owner has disabled embedding";
        break;
      default:
        reason = "an unknown player error occurred (code " + code + ")";
    }
    const name = song
      ? '"' + song.title + '" by ' + song.artist
      : "The selected video";
    errorBannerText.textContent =
      name +
      " could not be played: " +
      reason +
      ". Pick another song, or fix its YouTube ID in data.js (run `npm run check-songs` to validate the whole catalogue).";
    errorBanner.hidden = false;
    playerState = "error";
    updatePlaybackControls();
  }

  function hideErrorBanner() {
    if (errorBanner) errorBanner.hidden = true;
  }

  // Suggestion flow

  function handleGenerate() {
    SLOTS.forEach((slot) => {
      currentSuggestions[slot] = pickSongForCategory(
        SONGS,
        slot,
        playedSongIds
      );
    });

    nextSong = null;
    nextSlot = null;
    hasStarted = false;
    setAudienceShowingOptions(false);
    renderAllSlots();
    renderCounts();
    updateControlButtons();
    updatePlaybackControls();
    // A new round may have discarded a not-yet-started golden lock.
    broadcastGoldenState();
    saveAdminState();
  }

  function handleShowToAudience() {
    // Toggle behavior: if already showing, hide again; otherwise show.
    if (isAudienceShowingOptions) {
      window.sendKaraokeMessage(ACTIONS.HIDE_OPTIONS, {});
      setAudienceShowingOptions(false);
      saveAdminState();
      return;
    }

    window.sendKaraokeMessage(ACTIONS.SHOW_OPTIONS, optionsPayload());
    setAudienceShowingOptions(hasAnySuggestions());
    saveAdminState();
  }

  function handleChoiceKey(key) {
    const category = CATEGORIES.find((c) => c.hotkey === key);
    if (!category) return;
    const slot = category.key;
    if (nextSong) {
      // Already locked for this round, ignore further keys.
      return;
    }

    const song = currentSuggestions[slot];
    if (!song) return;

    nextSong = song;
    nextSlot = slot;
    hasStarted = false;
    // Once a choice is locked, we are no longer "showing options".
    setAudienceShowingOptions(false);
    renderAllSlots();
    updateControlButtons();

    window.sendKaraokeMessage(ACTIONS.LOCK_CHOICE, { slot, song });
    saveAdminState();
  }

  function handleClearSelection() {
    if (!nextSong || hasStarted) return;

    const wasGoldenLock = nextSlot === GOLDEN_SLOT;
    nextSong = null;
    nextSlot = null;
    // Clearing a golden mispick re-opens the request so the DJ can search
    // again — the singer's wish is still owed.
    if (wasGoldenLock) goldenHitPending = true;
    renderAllSlots();
    renderGoldenPanel();
    updateControlButtons();
    updateStatus();
    if (wasGoldenLock) broadcastGoldenState();

    // Do not change what the audience currently sees; clearing is an
    // admin-only action. Use "Show to Audience" to re-show options.
    saveAdminState();
  }

  function handleStartNextSong() {
    if (!nextSong || hasStarted) return;
    hideErrorBanner();
    window.sendKaraokeMessage(ACTIONS.PLAY_SONG, {
      youtubeId: nextSong.youtubeId,
      song: nextSong,
    });

    playedSongIds.add(nextSong.id);
    hasStarted = true;
    playerState = "playing";
    setAudienceShowingOptions(false);

    renderAllSlots();
    renderCounts();
    renderHistory();
    renderManualSongOptions();
    renderGoldenSongOptions();
    updateControlButtons();
    updatePlaybackControls();
    updateStatus();
    // Starting a golden pick clears its locked ticket on the projector.
    broadcastGoldenState();
    saveAdminState();
  }

  // Playback transport

  function sendPlayerControl(command, extra) {
    window.sendKaraokeMessage(
      ACTIONS.PLAYER_CONTROL,
      Object.assign({ command }, extra || {})
    );
  }

  function handlePauseResume() {
    if (playerState === "paused") {
      sendPlayerControl("resume");
      playerState = "playing";
    } else {
      sendPlayerControl("pause");
      playerState = "paused";
    }
    updatePlaybackControls();
  }

  function handleStop() {
    sendPlayerControl("stop");
    playerState = "stopped";
    updatePlaybackControls();
  }

  function handleReplay() {
    sendPlayerControl("replay");
    playerState = "playing";
    updatePlaybackControls();
  }

  const handleVolumeInput = debounce(() => {
    if (!volumeSlider) return;
    sendPlayerControl("volume", { value: Number(volumeSlider.value) });
  }, 100);

  // Manual song picker

  function setManualSelectedRow(slot, id) {
    manualSelectedSongId[slot] = id;
    const body = manualSongTableBodies[slot];
    if (!body) return;

    body.querySelectorAll("tr").forEach((row) => {
      const isSelected = Number(row.dataset.songId) === id;
      row.classList.toggle("selected", isSelected);
      row.setAttribute("aria-selected", isSelected ? "true" : "false");
    });

    const btn = btnManualSetBySlot[slot];
    if (btn) btn.disabled = !id;
  }

  function renderManualSongOptions(slotFilter) {
    const slotsToRender = slotFilter ? [slotFilter] : SLOTS;

    slotsToRender.forEach((slot) => {
      const body = manualSongTableBodies[slot];
      if (!body) return;

      body.textContent = "";

      const input = manualSearchInputs[slot];
      const filtered = filterSongs(SONGS, slot, input ? input.value : "");
      // Keep the current selection if its row is still visible.
      const keepSelection = filtered.some(
        (song) => song.id === manualSelectedSongId[slot]
      );
      if (!keepSelection) manualSelectedSongId[slot] = null;

      filtered.forEach((song) => {
        const row = document.createElement("tr");
        row.dataset.songId = String(song.id);
        row.tabIndex = 0;
        const isSelected = song.id === manualSelectedSongId[slot];
        row.setAttribute("aria-selected", isSelected ? "true" : "false");
        if (isSelected) row.classList.add("selected");
        if (playedSongIds.has(song.id)) {
          row.classList.add("played");
          row.title = "Already played in this session";
        }

        const titleCell = document.createElement("td");
        titleCell.className = "col-title";
        titleCell.textContent = song.title;

        const artistCell = document.createElement("td");
        artistCell.className = "col-artist";
        artistCell.textContent = song.artist;

        row.appendChild(titleCell);
        row.appendChild(artistCell);
        body.appendChild(row);
      });

      const btn = btnManualSetBySlot[slot];
      if (btn) {
        btn.disabled = filtered.length === 0 || !manualSelectedSongId[slot];
      }
    });
  }

  function handleManualSet(slot) {
    const id = manualSelectedSongId[slot];
    if (!id) return;
    const song = songIndex.get(id);
    if (!song) return;

    if (playedSongIds.has(id)) {
      const confirmed = window.confirm(
        '"' +
          song.title +
          '" has already been played in this session. Suggest it again anyway?'
      );
      if (!confirmed) return;
    }

    currentSuggestions[slot] = song;

    // Reset any previously locked choice since suggestions changed.
    const hadGoldenLock = nextSlot === GOLDEN_SLOT && !!nextSong;
    nextSong = null;
    nextSlot = null;
    hasStarted = false;

    renderAllSlots();
    updateControlButtons();
    updatePlaybackControls();
    updateStatus();
    if (hadGoldenLock) broadcastGoldenState();

    // If the audience view is currently showing options, update them.
    if (isAudienceShowingOptions) {
      window.sendKaraokeMessage(ACTIONS.SHOW_OPTIONS, optionsPayload());
    }

    saveAdminState();
  }

  // Golden buzzer
  //
  // The admin owns the golden state; the projector renders idempotent
  // GOLDEN_STATE snapshots. Broadcast one after every mutation of the
  // golden flags or of the next-song selection they can affect.

  function broadcastGoldenState() {
    window.sendKaraokeMessage(ACTIONS.GOLDEN_STATE, {
      armed: goldenArmed,
      hit: goldenHitPending,
      lockedSong:
        nextSlot === GOLDEN_SLOT && nextSong && !hasStarted ? nextSong : null,
    });
  }

  function handleGoldenArmToggle() {
    // A pending hit already consumed the arm; resolve or dismiss it first.
    if (goldenHitPending) return;
    goldenArmed = !goldenArmed;
    renderGoldenPanel();
    broadcastGoldenState();
    saveAdminState();
  }

  function handleGoldenHit() {
    if (!canGoldenHit({ goldenArmed, goldenHitPending })) return;
    // One-shot: the hit consumes the arm. It deliberately does not touch
    // the shown options, a locked choice, or playback — the DJ resolves
    // the wish via the request panel (or dismisses it).
    goldenArmed = false;
    goldenHitPending = true;
    renderGoldenPanel();
    broadcastGoldenState();
    saveAdminState();
  }

  function handleGoldenDismiss() {
    if (!goldenHitPending) return;
    goldenHitPending = false;
    renderGoldenPanel();
    broadcastGoldenState();
    saveAdminState();
  }

  function handleGoldenLock() {
    if (!goldenHitPending) return;
    const id = goldenSelectedSongId;
    if (!id) return;
    const song = songIndex.get(id);
    if (!song) return;

    if (playedSongIds.has(id)) {
      const confirmed = window.confirm(
        '"' +
          song.title +
          '" has already been played in this session. Lock it as the golden pick anyway?'
      );
      if (!confirmed) return;
    }

    nextSong = song;
    nextSlot = GOLDEN_SLOT;
    hasStarted = false;
    goldenHitPending = false;
    // A golden lock replaces whatever the audience was choosing between.
    setAudienceShowingOptions(false);
    window.sendKaraokeMessage(ACTIONS.HIDE_OPTIONS, {});
    broadcastGoldenState();

    renderAllSlots();
    renderGoldenPanel();
    updateControlButtons();
    updateStatus();
    saveAdminState();
  }

  function updateGoldenLockButton() {
    if (btnGoldenLock) {
      btnGoldenLock.disabled = !goldenHitPending || !goldenSelectedSongId;
    }
  }

  function setGoldenSelectedRow(id) {
    goldenSelectedSongId = id;
    if (goldenSongTableBody) {
      goldenSongTableBody.querySelectorAll("tr").forEach((row) => {
        const isSelected = Number(row.dataset.songId) === id;
        row.classList.toggle("selected", isSelected);
        row.setAttribute("aria-selected", isSelected ? "true" : "false");
      });
    }
    updateGoldenLockButton();
  }

  // Catalogue-wide variant of renderManualSongOptions: no category filter,
  // plus a category column so the DJ can see what they are locking in.
  function renderGoldenSongOptions() {
    if (!goldenSongTableBody) return;

    goldenSongTableBody.textContent = "";

    const filtered = filterSongs(
      SONGS,
      null,
      goldenSearchInput ? goldenSearchInput.value : ""
    );
    // Keep the current selection if its row is still visible.
    const keepSelection = filtered.some(
      (song) => song.id === goldenSelectedSongId
    );
    if (!keepSelection) goldenSelectedSongId = null;

    filtered.forEach((song) => {
      const row = document.createElement("tr");
      row.dataset.songId = String(song.id);
      row.tabIndex = 0;
      const isSelected = song.id === goldenSelectedSongId;
      row.setAttribute("aria-selected", isSelected ? "true" : "false");
      if (isSelected) row.classList.add("selected");
      if (playedSongIds.has(song.id)) {
        row.classList.add("played");
        row.title = "Already played in this session";
      }

      const titleCell = document.createElement("td");
      titleCell.className = "col-title";
      titleCell.textContent = song.title;

      const artistCell = document.createElement("td");
      artistCell.className = "col-artist";
      artistCell.textContent = song.artist;

      const catCell = document.createElement("td");
      catCell.className = "col-cat text-" + song.category;
      catCell.textContent = categoryBySlot[song.category]
        ? categoryBySlot[song.category].label
        : song.category;

      row.appendChild(titleCell);
      row.appendChild(artistCell);
      row.appendChild(catCell);
      goldenSongTableBody.appendChild(row);
    });

    updateGoldenLockButton();
  }

  function renderGoldenPanel() {
    if (goldenStateText) {
      goldenStateText.textContent = goldenHitPending
        ? "HIT! Take the singer's wish and lock a song"
        : goldenArmed
        ? "ARMED — waiting for a brave soul"
        : "Disarmed";
    }
    if (btnGoldenArm) {
      btnGoldenArm.textContent = goldenArmed
        ? "Disarm"
        : "Arm Golden Buzzer";
      btnGoldenArm.disabled = goldenHitPending;
    }
    if (btnGoldenDismiss) btnGoldenDismiss.disabled = !goldenHitPending;
    if (goldenRequestPanel) goldenRequestPanel.hidden = !goldenHitPending;
    updateGoldenLockButton();
    document.body.classList.toggle("golden-armed", goldenArmed);
    document.body.classList.toggle("golden-hit", goldenHitPending);
  }

  function handleUnmarkPlayed(id) {
    if (!playedSongIds.has(id)) return;
    playedSongIds.delete(id);
    renderAllSlots();
    renderCounts();
    renderHistory();
    renderManualSongOptions();
    saveAdminState();
  }

  // Keyboard shortcuts

  function handleAdminKeydown(ev) {
    const key = ev.key;

    // Ignore shortcuts while typing in inputs / textareas / contentEditable
    const target = ev.target;
    const tagName = target && target.tagName ? target.tagName.toLowerCase() : "";
    const isTypingTarget =
      tagName === "input" ||
      tagName === "textarea" ||
      (target && target.isContentEditable);
    if (isTypingTarget) return;

    if (key === "1" || key === "2" || key === "3") {
      handleChoiceKey(key);
      return;
    }
    if (key === "4") {
      // DJ fallback when the projector keyboard is out of reach.
      handleGoldenHit();
      return;
    }
    if (key === "g") {
      if (btnGoldenArm && !btnGoldenArm.disabled) {
        ev.preventDefault();
        handleGoldenArmToggle();
      }
      return;
    }
    if (key === "Enter") {
      if (btnStart && !btnStart.disabled) {
        ev.preventDefault();
        handleStartNextSong();
      }
      return;
    }
    if (key === "+") {
      if (btnShow && !btnShow.disabled) {
        ev.preventDefault();
        handleShowToAudience();
      }
      return;
    }
    if (key === "-") {
      if (btnClearSelection && !btnClearSelection.disabled) {
        ev.preventDefault();
        handleClearSelection();
      }
      return;
    }
    if (key === ",") {
      if (btnGenerate && !btnGenerate.disabled) {
        ev.preventDefault();
        handleGenerate();
      }
    }
  }

  // Messages from the projector

  function handleBroadcast(msg) {
    if (!msg || !msg.action) return;
    const payload = msg.payload || {};

    switch (msg.action) {
      case ACTIONS.AUDIENCE_KEY:
        if (payload.key === "4") {
          handleGoldenHit();
        } else if (payload.key) {
          handleChoiceKey(payload.key);
        }
        break;
      case ACTIONS.PLAYER_STATE:
        playerState = payload.state || null;
        updatePlaybackControls();
        break;
      case ACTIONS.PLAYER_ERROR:
        showErrorBanner(payload);
        break;
      default:
        break;
    }
  }

  // State restore (data.js and core.js load synchronously before this file,
  // so SONGS is always available here — no polling needed).

  function restoreAdminState() {
    let stored = null;
    try {
      stored = deserializeAdminState(
        window.localStorage.getItem(ADMIN_STORAGE_KEY)
      );
    } catch (err) {
      console.warn("[KARAOKE] Failed to restore admin state", err);
    }

    if (stored) {
      stored.playedSongIds.forEach((id) => {
        if (songIndex.has(id)) playedSongIds.add(id);
      });
      SLOTS.forEach((slot) => {
        currentSuggestions[slot] =
          songIndex.get(stored.suggestions[slot]) || null;
      });
      nextSong = songIndex.get(stored.nextSongId) || null;
      nextSlot = nextSong ? stored.nextSlot : null;
      hasStarted = stored.started && !!nextSong;
      goldenArmed = stored.goldenArmed;
      goldenHitPending = stored.goldenHitPending;

      const restoredIsAudienceShowing =
        stored.isAudienceShowingOptions && hasAnySuggestions();
      setAudienceShowingOptions(restoredIsAudienceShowing);

      // Sync the projector with the restored state. A started selection is
      // deliberately NOT re-broadcast: the song may still be playing and a
      // LOCK_CHOICE would draw the ticket overlay over the video. A golden
      // lock rides in the GOLDEN_STATE snapshot below instead.
      if (restoredIsAudienceShowing) {
        window.sendKaraokeMessage(ACTIONS.SHOW_OPTIONS, optionsPayload());
      } else if (
        nextSong &&
        nextSlot &&
        nextSlot !== GOLDEN_SLOT &&
        !hasStarted
      ) {
        window.sendKaraokeMessage(ACTIONS.LOCK_CHOICE, {
          slot: nextSlot,
          song: nextSong,
        });
      } else if (stored.isAudienceShowingOptions && !restoredIsAudienceShowing) {
        // Previously showing options, but they can't be restored – hide any
        // stale options on the projector.
        window.sendKaraokeMessage(ACTIONS.HIDE_OPTIONS, {});
      }
    } else {
      setAudienceShowingOptions(false);
    }

    // Always safe mid-playback: with hasStarted the snapshot carries no
    // lockedSong, so at most the armed glow reappears — as it should.
    broadcastGoldenState();
    renderEverything();
  }

  // Song vibes (card animations on the projector)
  //
  // Hand-curated vibes in data.js are kept as-is; Claude classifies any
  // songs without one whenever a song list is loaded (the list can be
  // replaced dynamically, e.g. by a sheet loader), with results cached
  // per song in localStorage. See vibes.js for the engine.

  const btnAiVibes = document.getElementById("btn-ai-vibes");
  const vibesStatusEl = document.getElementById("vibes-status");
  let lastVibeSongsRef = null;
  let vibeClassificationRunning = false;

  function updateVibesStatus(text) {
    if (vibesStatusEl) vibesStatusEl.textContent = text || "";
  }

  function broadcastVibes(songs) {
    const vibes = {};
    songs.forEach((song) => {
      if (song.id != null && song.vibe) vibes[song.id] = song.vibe;
    });
    window.sendKaraokeMessage(ACTIONS.SET_VIBES, { vibes });
  }

  async function runVibeClassification(interactive) {
    if (!window.KaraokeVibes) return;
    const songs = Array.isArray(window.SONGS) ? window.SONGS : SONGS;
    if (!songs.length) return;

    // Instant baseline: curated vibes + cached AI results + heuristics.
    window.KaraokeVibes.assignVibes(songs);
    broadcastVibes(songs);

    if (!window.KaraokeVibes.hasApiKey()) {
      if (!interactive) {
        updateVibesStatus("Built-in vibes active – ✨ AI Vibes adds Claude");
        return;
      }
      const key = window.prompt(
        "Anthropic API key for vibe classification\n(stored only in this browser's localStorage):"
      );
      if (!key || !key.trim()) return;
      window.KaraokeVibes.setApiKey(key.trim());
    }

    if (vibeClassificationRunning) return;
    vibeClassificationRunning = true;
    updateVibesStatus("Classifying vibes with Claude…");
    try {
      const result = await window.KaraokeVibes.classifyWithAI(songs);
      updateVibesStatus(
        "Vibes ready (" +
          result.fromAI +
          " from Claude, " +
          result.alreadyKnown +
          " known)"
      );
      broadcastVibes(songs);
    } catch (err) {
      console.warn("[KARAOKE] AI vibe classification failed", err);
      updateVibesStatus("AI vibes failed – using built-in vibes");
    } finally {
      vibeClassificationRunning = false;
    }
  }

  function handleAiVibesClick(ev) {
    // Shift-click lets the host replace or remove a stored API key.
    if (ev.shiftKey && window.KaraokeVibes) {
      const key = window.prompt(
        "New Anthropic API key (empty to remove the stored key):"
      );
      if (key === null) return;
      window.KaraokeVibes.setApiKey(key.trim() || null);
    }
    runVibeClassification(true);
  }

  // The song list is not static (a loader can replace window.SONGS at any
  // time), so watch for the array reference changing and classify any
  // songs that are not cached yet.
  function watchSongsForVibes() {
    const tick = () => {
      const current = Array.isArray(window.SONGS) ? window.SONGS : SONGS;
      if (current.length && current !== lastVibeSongsRef) {
        lastVibeSongsRef = current;
        runVibeClassification(false);
      }
    };
    tick();
    window.setInterval(tick, 1500);
  }

  // Init

  function init() {
    if (btnGenerate) btnGenerate.addEventListener("click", handleGenerate);
    if (btnShow) btnShow.addEventListener("click", handleShowToAudience);
    if (btnStart) btnStart.addEventListener("click", handleStartNextSong);
    if (btnClearSelection) {
      btnClearSelection.addEventListener("click", handleClearSelection);
    }
    if (btnClearState) {
      btnClearState.addEventListener("click", clearStoredAdminState);
    }
    if (btnOpenProjector) {
      btnOpenProjector.addEventListener("click", openOrFocusProjector);
    }
    if (btnAiVibes) {
      btnAiVibes.addEventListener("click", handleAiVibesClick);
    }
    if (btnPauseResume) {
      btnPauseResume.addEventListener("click", handlePauseResume);
    }
    if (btnStop) btnStop.addEventListener("click", handleStop);
    if (btnReplay) btnReplay.addEventListener("click", handleReplay);
    if (volumeSlider) volumeSlider.addEventListener("input", handleVolumeInput);
    if (btnDismissError) {
      btnDismissError.addEventListener("click", hideErrorBanner);
    }
    window.addEventListener("keydown", handleAdminKeydown);

    SLOTS.forEach((slot) => {
      const input = manualSearchInputs[slot];
      if (input) {
        input.addEventListener(
          "input",
          debounce(() => renderManualSongOptions(slot), 150)
        );
      }

      // One delegated listener per table instead of one per row.
      const body = manualSongTableBodies[slot];
      if (body) {
        body.addEventListener("click", (ev) => {
          const row = ev.target.closest("tr[data-song-id]");
          if (row) setManualSelectedRow(slot, Number(row.dataset.songId));
        });
        body.addEventListener("dblclick", (ev) => {
          const row = ev.target.closest("tr[data-song-id]");
          if (!row) return;
          setManualSelectedRow(slot, Number(row.dataset.songId));
          handleManualSet(slot);
        });
        body.addEventListener("keydown", (ev) => {
          if (ev.key !== "Enter" && ev.key !== " ") return;
          const row = ev.target.closest("tr[data-song-id]");
          if (!row) return;
          ev.preventDefault();
          setManualSelectedRow(slot, Number(row.dataset.songId));
        });
      }

      const btn = btnManualSetBySlot[slot];
      if (btn) btn.addEventListener("click", () => handleManualSet(slot));
    });

    if (historyList) {
      historyList.addEventListener("click", (ev) => {
        const btn = ev.target.closest("button[data-unmark-id]");
        if (btn) handleUnmarkPlayed(Number(btn.dataset.unmarkId));
      });
    }

    // Golden buzzer controls
    if (btnGoldenArm) {
      btnGoldenArm.addEventListener("click", handleGoldenArmToggle);
    }
    if (btnGoldenDismiss) {
      btnGoldenDismiss.addEventListener("click", handleGoldenDismiss);
    }
    if (btnGoldenLock) {
      btnGoldenLock.addEventListener("click", handleGoldenLock);
    }
    if (goldenSearchInput) {
      goldenSearchInput.addEventListener(
        "input",
        debounce(() => renderGoldenSongOptions(), 150)
      );
    }
    if (goldenSongTableBody) {
      goldenSongTableBody.addEventListener("click", (ev) => {
        const row = ev.target.closest("tr[data-song-id]");
        if (row) setGoldenSelectedRow(Number(row.dataset.songId));
      });
      goldenSongTableBody.addEventListener("dblclick", (ev) => {
        const row = ev.target.closest("tr[data-song-id]");
        if (!row) return;
        setGoldenSelectedRow(Number(row.dataset.songId));
        handleGoldenLock();
      });
      goldenSongTableBody.addEventListener("keydown", (ev) => {
        if (ev.key !== "Enter" && ev.key !== " ") return;
        const row = ev.target.closest("tr[data-song-id]");
        if (!row) return;
        ev.preventDefault();
        setGoldenSelectedRow(Number(row.dataset.songId));
      });
    }

    window.onKaraokeMessage(handleBroadcast);
    restoreAdminState();
    watchSongsForVibes();
  }

  window.addEventListener("DOMContentLoaded", init);
})();
