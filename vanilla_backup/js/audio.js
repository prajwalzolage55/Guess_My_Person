/* audio.js — Web Audio API sound effects.
   Owns: all game sounds using oscillator synthesis.
   Does NOT own: game logic, UI. No audio files needed. */

(function () {
  'use strict';

  /** @type {AudioContext|null} */
  var audioCtx = null;

  /** Whether the AudioContext has been resumed after a user gesture. */
  var contextResumed = false;

  /**
   * Read the sound-enabled preference from localStorage.
   * Defaults to true if no value has been stored.
   * @returns {boolean}
   */
  function getSoundEnabled() {
    var stored = localStorage.getItem('soundEnabled');
    if (stored === null) return true;
    return stored === 'true';
  }

  /**
   * Lazily create and return the AudioContext.
   * @returns {AudioContext|null}
   */
  function getContext() {
    if (audioCtx) return audioCtx;
    try {
      var AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (AudioContextClass) {
        audioCtx = new AudioContextClass();
      }
    } catch (e) {
      console.warn('Web Audio API is not supported in this browser.', e);
    }
    return audioCtx;
  }

  /**
   * Resume the AudioContext if it is in a suspended state.
   * Browsers require a user gesture before audio can play.
   */
  function resumeContext() {
    if (contextResumed) return;
    var ctx = getContext();
    if (ctx && ctx.state === 'suspended') {
      ctx.resume().then(function () {
        contextResumed = true;
      });
    } else if (ctx) {
      contextResumed = true;
    }
  }

  /**
   * Internal helper: play a single oscillator tone.
   * @param {number} frequency - Frequency in Hz.
   * @param {number} duration - Duration in milliseconds.
   * @param {string} [type='sine'] - Oscillator waveform type.
   * @param {number} [volume=0.3] - Gain value (0 to 1).
   * @param {number} [startOffset=0] - Delay before starting (seconds).
   */
  function playTone(frequency, duration, type, volume, startOffset) {
    if (type === undefined) type = 'sine';
    if (volume === undefined) volume = 0.3;
    if (startOffset === undefined) startOffset = 0;

    var ctx = getContext();
    if (!ctx) return;

    var oscillator = ctx.createOscillator();
    var gainNode = ctx.createGain();

    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, ctx.currentTime);
    gainNode.gain.setValueAtTime(volume, ctx.currentTime + startOffset);

    // Quick fade-out at the end to avoid clicks
    var endTime = ctx.currentTime + startOffset + duration / 1000;
    gainNode.gain.setValueAtTime(volume, endTime - 0.01);
    gainNode.gain.linearRampToValueAtTime(0, endTime);

    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);

    oscillator.start(ctx.currentTime + startOffset);
    oscillator.stop(endTime);
  }

  window.SFX = {
    /**
     * Initialize the sound system.
     * Sets up event listeners to resume the AudioContext on the first
     * user interaction (click or touch), complying with autoplay policies.
     * Call this once on page load.
     */
    init: function () {
      var resumeHandler = function () {
        resumeContext();
        // Remove listeners after first interaction
        document.removeEventListener('click', resumeHandler);
        document.removeEventListener('touchstart', resumeHandler);
      };
      document.addEventListener('click', resumeHandler);
      document.addEventListener('touchstart', resumeHandler);
    },

    /**
     * Play an ascending 3-tone chime for correct answers.
     * C5 (523 Hz, 100ms) → E5 (659 Hz, 100ms) → G5 (784 Hz, 200ms)
     * Waveform: sine
     */
    playCorrect: function () {
      if (!getSoundEnabled()) return;
      resumeContext();
      playTone(523, 100, 'sine', 0.3, 0);         // C5
      playTone(659, 100, 'sine', 0.3, 0.1);        // E5
      playTone(784, 200, 'sine', 0.3, 0.2);        // G5
    },

    /**
     * Play a descending 2-tone buzz for wrong answers.
     * E4 (330 Hz, 150ms) → C4 (262 Hz, 200ms)
     * Waveform: sawtooth (buzzy)
     */
    playWrong: function () {
      if (!getSoundEnabled()) return;
      resumeContext();
      playTone(330, 150, 'sawtooth', 0.3, 0);      // E4
      playTone(262, 200, 'sawtooth', 0.3, 0.15);    // C4
    },

    /**
     * Play a single short tick sound.
     * Very short sine wave blip at 800 Hz for 50ms.
     * Low volume (0.15).
     */
    playTick: function () {
      if (!getSoundEnabled()) return;
      resumeContext();
      playTone(800, 50, 'sine', 0.15, 0);
    },

    /**
     * Play a subtle pop sound.
     * Short sine wave at 600 Hz for 80ms with quick volume decay.
     */
    playPop: function () {
      if (!getSoundEnabled()) return;
      resumeContext();
      playTone(600, 80, 'sine', 0.25, 0);
    },

    /**
     * Toggle the sound enabled/disabled state.
     * Persists the new state to localStorage.
     * @returns {boolean} The new sound state (true = on, false = off).
     */
    toggleSound: function () {
      var current = getSoundEnabled();
      var newState = !current;
      localStorage.setItem('soundEnabled', String(newState));
      return newState;
    },

    /**
     * Check whether sound is currently enabled.
     * @returns {boolean} true if sound is on, false if off.
     */
    isSoundOn: function () {
      return getSoundEnabled();
    }
  };
})();
