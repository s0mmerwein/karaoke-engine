// Shared BroadcastChannel logic for the Karaoke Flow MVP.
// This file is loaded in both admin.html and projector.html.

(function () {
  const CHANNEL_NAME = "karaoke_flow";

  // Shared message protocol. Both pages must use these constants instead of
  // string literals so admin and projector cannot drift apart.
  const KARAOKE_ACTIONS = {
    SHOW_OPTIONS: "SHOW_OPTIONS",
    HIDE_OPTIONS: "HIDE_OPTIONS",
    LOCK_CHOICE: "LOCK_CHOICE",
    PLAY_SONG: "PLAY_SONG",
    AUDIENCE_KEY: "AUDIENCE_KEY",
    PLAYER_CONTROL: "PLAYER_CONTROL",
    PLAYER_STATE: "PLAYER_STATE",
    PLAYER_ERROR: "PLAYER_ERROR",
  };

  const DEBUG_KARAOKE = false;

  let channel = null;
  let listeners = [];

  function ensureChannel() {
    if (channel) return channel;
    if (!("BroadcastChannel" in window)) {
      console.warn(
        "[KARAOKE] BroadcastChannel is not supported in this browser. " +
          "Admin and projector views will not be able to communicate."
      );
      return null;
    }
    channel = new BroadcastChannel(CHANNEL_NAME);
    channel.onmessage = (event) => {
      const data = event.data || {};
      if (DEBUG_KARAOKE) {
        console.debug("[KARAOKE] Received message:", data);
      }
      const msg = {
        action: data.action,
        payload: data.payload || {},
        timestamp: data.timestamp || Date.now(),
      };
      listeners.forEach((fn) => {
        try {
          fn(msg);
        } catch (err) {
          console.error("[KARAOKE] Listener error", err);
        }
      });
    };
    return channel;
  }

  function sendMessage(action, payload) {
    const ch = ensureChannel();
    if (!ch) return;
    const message = {
      action,
      payload: payload || {},
      timestamp: Date.now(),
    };
    if (DEBUG_KARAOKE) {
      console.debug("[KARAOKE] Sending message:", message);
    }
    ch.postMessage(message);
  }

  function onKaraokeMessage(handler) {
    if (typeof handler !== "function") return;
    listeners.push(handler);
    ensureChannel();
  }

  // Expose globals
  window.karaokeChannel = {
    sendMessage,
    onMessage: onKaraokeMessage,
  };
  window.KARAOKE_ACTIONS = KARAOKE_ACTIONS;
  window.sendKaraokeMessage = sendMessage;
  window.onKaraokeMessage = onKaraokeMessage;
})();


