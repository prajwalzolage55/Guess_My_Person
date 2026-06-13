/* utils.js — Shared utility functions.
   Owns: room code generation, SHA-256 hashing, input sanitization, confetti effect,
         time formatting, ID generation, debounce/throttle.
   Does NOT own: Firebase operations, game logic, UI. */

(function () {
  'use strict';

  /**
   * Characters used for room code generation.
   * Excludes easily confused characters: 0, O, I, 1.
   */
  var ROOM_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

  window.Utils = {
    /**
     * Generate a 6-character alphanumeric uppercase room code.
     * Uses crypto.getRandomValues for cryptographic randomness.
     * @returns {string} 6-character room code.
     */
    generateRoomCode: function () {
      var code = '';
      var values = new Uint32Array(6);
      crypto.getRandomValues(values);
      for (var i = 0; i < 6; i++) {
        code += ROOM_CODE_CHARS[values[i] % ROOM_CODE_CHARS.length];
      }
      return code;
    },

    /**
     * Compute the SHA-256 hash of the given string.
     * Input is lowercased before hashing for case-insensitive comparison.
     * @param {string} str - The string to hash.
     * @returns {Promise<string>} Hex-encoded SHA-256 hash.
     */
    hashString: async function (str) {
      str = str.toLowerCase();
      if (window.crypto && window.crypto.subtle && window.crypto.subtle.digest) {
        try {
          var data = new TextEncoder().encode(str);
          var hashBuffer = await window.crypto.subtle.digest('SHA-256', data);
          var hashArray = Array.from(new Uint8Array(hashBuffer));
          var hashHex = hashArray.map(function (b) {
            return b.toString(16).padStart(2, '0');
          }).join('');
          return hashHex;
        } catch (e) {
          // Fallback to pure JS
        }
      }

      // Fallback: Pure JS SHA-256 implementation
      function rightRotate(value, amount) {
        return (value >>> amount) | (value << (32 - amount));
      }
      
      var mathPow = Math.pow;
      var maxWord = mathPow(2, 32);
      var lengthProperty = 'length';
      var i, j;
      var result = '';

      var ascii = str;
      var words = [];
      var asciiLength = ascii[lengthProperty] * 8;
      
      var hash = [], k = [];
      var primeCounter = 0;

      var isPrime = function(n) {
        for (var factor = 2; factor * factor <= n; factor++) {
          if (n % factor === 0) return false;
        }
        return true;
      };

      for (var candidate = 2; primeCounter < 64; candidate++) {
        if (isPrime(candidate)) {
          if (primeCounter < 8) {
            hash[primeCounter] = (mathPow(candidate, 0.5) * maxWord) | 0;
          }
          k[primeCounter] = (mathPow(candidate, 1/3) * maxWord) | 0;
          primeCounter++;
        }
      }
      
      ascii += '\x80';
      while (ascii[lengthProperty] % 64 - 56) {
        ascii += '\x00';
      }
      for (i = 0; i < ascii[lengthProperty]; i++) {
        var charCode = ascii.charCodeAt(i);
        if (charCode >> 8) return '';
        words[i >> 2] |= charCode << (24 - (i % 4) * 8);
      }
      words[words[lengthProperty]] = ((asciiLength / maxWord) | 0);
      words[words[lengthProperty]] = (asciiLength | 0);
      
      for (j = 0; j < words[lengthProperty]; j += 16) {
        var w = words.slice(j, j + 16);
        var oldHash = hash.slice(0);
        
        while (w[lengthProperty] < 64) {
          var s0 = rightRotate(w[w[lengthProperty] - 15], 7) ^ rightRotate(w[w[lengthProperty] - 15], 18) ^ (w[w[lengthProperty] - 15] >>> 3);
          var s1 = rightRotate(w[w[lengthProperty] - 2], 17) ^ rightRotate(w[w[lengthProperty] - 2], 19) ^ (w[w[lengthProperty] - 2] >>> 10);
          w[w[lengthProperty]] = (w[w[lengthProperty] - 16] + s0 + w[w[lengthProperty] - 7] + s1) | 0;
        }
        
        for (i = 0; i < 64; i++) {
          var s1_r = rightRotate(hash[4], 6) ^ rightRotate(hash[4], 11) ^ rightRotate(hash[4], 25);
          var ch = (hash[4] & hash[5]) ^ (~hash[4] & hash[6]);
          var temp1 = (hash[7] + s1_r + ch + k[i] + w[i]) | 0;
          var s0_r = rightRotate(hash[0], 2) ^ rightRotate(hash[0], 13) ^ rightRotate(hash[0], 22);
          var maj = (hash[0] & hash[1]) ^ (hash[0] & hash[2]) ^ (hash[1] & hash[2]);
          var temp2 = (s0_r + maj) | 0;
          
          hash = [(temp1 + temp2) | 0].concat(hash);
          hash[4] = (hash[4] + temp1) | 0;
          hash.splice(8, 1);
        }
        
        for (i = 0; i < 8; i++) {
          hash[i] = (hash[i] + oldHash[i]) | 0;
        }
      }
      
      for (i = 0; i < 8; i++) {
        var word = hash[i];
        if (word < 0) word += maxWord;
        result += word.toString(16).padStart(8, '0');
      }
      
      return result;
    },

    /**
     * Sanitize a string by stripping all HTML tags, trimming whitespace,
     * and enforcing a maximum length.
     * @param {string} str - Raw input string.
     * @param {number} [maxLen=100] - Maximum allowed length.
     * @returns {string} Sanitized string.
     */
    sanitize: function (str, maxLen) {
      if (maxLen === undefined) maxLen = 100;
      if (!str) return '';
      // Use DOMParser to strip HTML
      var doc = new DOMParser().parseFromString(str, 'text/html');
      var clean = doc.body.textContent || '';
      clean = clean.trim();
      if (clean.length > maxLen) {
        clean = clean.substring(0, maxLen);
      }
      return clean;
    },

    /**
     * Create a confetti burst effect on the page.
     * Spawns 50 confetti pieces with random colors, positions, and durations.
     * Automatically removes all pieces after the specified duration.
     * @param {number} [duration=3000] - How long the confetti lasts (ms).
     */
    confetti: function (duration) {
      if (duration === undefined) duration = 3000;
      var colors = [
        'var(--accent-blue)',
        'var(--accent-pink)',
        'var(--accent-green)',
        'var(--accent-yellow)',
        'white'
      ];
      var pieces = [];
      for (var i = 0; i < 50; i++) {
        var piece = document.createElement('div');
        piece.className = 'confetti-piece';
        var color = colors[Math.floor(Math.random() * colors.length)];
        var leftPos = Math.random() * 100;
        var animDuration = 2 + Math.random() * 2; // 2-4s
        var delay = Math.random() * 1; // 0-1s delay
        piece.style.left = leftPos + '%';
        piece.style.backgroundColor = color;
        piece.style.animationDuration = animDuration + 's';
        piece.style.animationDelay = delay + 's';
        document.body.appendChild(piece);
        pieces.push(piece);
      }
      setTimeout(function () {
        pieces.forEach(function (p) {
          if (p.parentNode) {
            p.parentNode.removeChild(p);
          }
        });
      }, duration);
    },

    /**
     * Convert milliseconds to a MM:SS formatted string.
     * Negative values are treated as 0:00.
     * @param {number} ms - Time in milliseconds.
     * @returns {string} Formatted time string (e.g. "2:30").
     */
    formatTime: function (ms) {
      if (ms < 0) ms = 0;
      var totalSeconds = Math.floor(ms / 1000);
      var minutes = Math.floor(totalSeconds / 60);
      var seconds = totalSeconds % 60;
      return minutes + ':' + (seconds < 10 ? '0' : '') + seconds;
    },

    /**
     * Generate a unique player ID.
     * Uses crypto.randomUUID() if available, otherwise falls back to
     * Date.now() combined with a random number.
     * @returns {string} Unique identifier string.
     */
    generateId: function () {
      if (crypto.randomUUID) {
        return crypto.randomUUID();
      }
      // Fallback for browsers without randomUUID
      return Date.now().toString(36) + '-' + Math.random().toString(36).substring(2, 10);
    },

    /**
     * Standard debounce function.
     * Delays invoking `fn` until `ms` milliseconds have elapsed since the
     * last time the debounced function was called.
     * @param {Function} fn - The function to debounce.
     * @param {number} ms - Delay in milliseconds.
     * @returns {Function} Debounced function.
     */
    debounce: function (fn, ms) {
      var timer = null;
      return function () {
        var context = this;
        var args = arguments;
        clearTimeout(timer);
        timer = setTimeout(function () {
          fn.apply(context, args);
        }, ms);
      };
    },

    /**
     * Standard throttle function using timestamps.
     * Ensures `fn` is called at most once every `ms` milliseconds.
     * @param {Function} fn - The function to throttle.
     * @param {number} ms - Minimum interval in milliseconds.
     * @returns {Function} Throttled function.
     */
    throttle: function (fn, ms) {
      var lastCall = 0;
      return function () {
        var now = Date.now();
        if (now - lastCall >= ms) {
          lastCall = now;
          fn.apply(this, arguments);
        }
      };
    },

    /**
     * Copy text to the clipboard.
     * Uses the modern navigator.clipboard API with a fallback to the
     * legacy textarea + execCommand method.
     * @param {string} text - The text to copy.
     * @returns {Promise<void>}
     */
    copyToClipboard: function (text) {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        return navigator.clipboard.writeText(text);
      }
      // Fallback: create a temporary textarea element
      return new Promise(function (resolve, reject) {
        try {
          var textarea = document.createElement('textarea');
          textarea.value = text;
          textarea.style.position = 'fixed';
          textarea.style.left = '-9999px';
          textarea.style.top = '-9999px';
          textarea.style.opacity = '0';
          document.body.appendChild(textarea);
          textarea.focus();
          textarea.select();
          var success = document.execCommand('copy');
          document.body.removeChild(textarea);
          if (success) {
            resolve();
          } else {
            reject(new Error('execCommand copy failed'));
          }
        } catch (err) {
          reject(err);
        }
      });
    },

    /**
     * Standard Fisher-Yates array shuffle.
     * @param {Array} arr - The array to shuffle.
     * @returns {Array} Shuffled array.
     */
    shuffleArray: function (arr) {
      for (var i = arr.length - 1; i > 0; i--) {
        var j = Math.floor(Math.random() * (i + 1));
        var temp = arr[i];
        arr[i] = arr[j];
        arr[j] = temp;
      }
      return arr;
    },

    /**
     * Build the hot-seat order across all rounds.
     * If players <= 3, everyone takes a turn each round.
     * If > 3, pick 3 random per round, ensuring every player gets at least one
     * turn across all rounds.
     * @param {Array<string>} playerIds
     * @param {number} rounds
     * @returns {Array<string>} Shuffled hot-seat order.
     */
    buildHotSeatOrder: function (playerIds, rounds) {
      var totalPlayers = playerIds.length;
      var order = [];

      if (totalPlayers <= 3) {
        /* Everyone each round */
        for (var r = 0; r < rounds; r++) {
          var shuffled = this.shuffleArray(playerIds.slice());
          order = order.concat(shuffled);
        }
        return order;
      }

      /* >3 players: 3 per round, ensure coverage */
      var totalSlots = rounds * 3;

      /* First, ensure every player gets at least one slot */
      var required = this.shuffleArray(playerIds.slice());

      /* Fill remaining slots randomly */
      while (required.length < totalSlots) {
        required.push(playerIds[Math.floor(Math.random() * totalPlayers)]);
      }

      /* If required > totalSlots, truncate (shouldn't happen unless players > totalSlots) */
      required = required.slice(0, totalSlots);

      /* Shuffle final list and chunk into rounds of 3 */
      order = this.shuffleArray(required);

      return order;
    }
  };
})();
