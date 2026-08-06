// Admin page controller for the Karaoke Flow app.
// Pure logic lives in core.js; the BroadcastChannel wrapper in logic.js.

(function () {
  "use strict";

  const {
    CATEGORIES,
    buildSongIndex,
    pickSongForCategory,
    filterSongs,
    categoryCounts,
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
  const currentSuggestions = { power: null, emotional: null, evergreen: null };
  let nextSong = null;
  let nextSlot = null;
  let hasStarted = false;
  let isAudienceShowingOptions = false;
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
    setAudienceShowingOptions(false);
    hideErrorBanner();

    renderEverything();

    // Ensure the projector does not keep showing stale options.
    window.sendKaraokeMessage(ACTIONS.HIDE_OPTIONS, {});
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
      statusText.appendChild(span("text-power", "1"));
      statusText.appendChild(document.createTextNode(", "));
      statusText.appendChild(span("text-emotional", "2"));
      statusText.appendChild(document.createTextNode(" or "));
      statusText.appendChild(span("text-evergreen", "3"));
      statusText.appendChild(document.createTextNode("."));
    } else {
      const category = categoryBySlot[nextSlot];
      statusText.appendChild(
        document.createTextNode(hasStarted ? "Started: " : "Next: ")
      );
      statusText.appendChild(span("admin-status-strong", nextSong.title));
      statusText.appendChild(
        document.createTextNode(
          " – " +
            nextSong.artist +
            (category ? " (" + category.label + ")" : "")
        )
      );
    }

    if (isAudienceShowingOptions) {
      statusText.appendChild(document.createTextNode(" – "));
      statusText.appendChild(span("text-emotional", "shown to audience"));
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

    window.sendKaraokeMessage(ACTIONS.SHOW_OPTIONS, {
      power: currentSuggestions.power,
      emotional: currentSuggestions.emotional,
      evergreen: currentSuggestions.evergreen,
    });
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

    nextSong = null;
    nextSlot = null;
    renderAllSlots();
    updateControlButtons();
    updateStatus();

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
    updateControlButtons();
    updatePlaybackControls();
    updateStatus();
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
    nextSong = null;
    nextSlot = null;
    hasStarted = false;

    renderAllSlots();
    updateControlButtons();
    updatePlaybackControls();
    updateStatus();

    // If the audience view is currently showing options, update them.
    if (isAudienceShowingOptions) {
      window.sendKaraokeMessage(ACTIONS.SHOW_OPTIONS, {
        power: currentSuggestions.power,
        emotional: currentSuggestions.emotional,
        evergreen: currentSuggestions.evergreen,
      });
    }

    saveAdminState();
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
        if (payload.key) handleChoiceKey(payload.key);
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

      const restoredIsAudienceShowing =
        stored.isAudienceShowingOptions && hasAnySuggestions();
      setAudienceShowingOptions(restoredIsAudienceShowing);

      // Sync the projector with the restored state. A started selection is
      // deliberately NOT re-broadcast: the song may still be playing and a
      // LOCK_CHOICE would draw the ticket overlay over the video.
      if (restoredIsAudienceShowing) {
        window.sendKaraokeMessage(ACTIONS.SHOW_OPTIONS, {
          power: currentSuggestions.power,
          emotional: currentSuggestions.emotional,
          evergreen: currentSuggestions.evergreen,
        });
      } else if (nextSong && nextSlot && !hasStarted) {
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

    renderEverything();
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

    window.onKaraokeMessage(handleBroadcast);
    restoreAdminState();
  }

  window.addEventListener("DOMContentLoaded", init);
})();
