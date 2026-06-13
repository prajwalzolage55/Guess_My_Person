/* utils.ts — Shared utility functions.
   Owns: room code generation, SHA-256 hashing, input sanitization, confetti effect,
         time formatting, ID generation, debounce/throttle.
   Does NOT own: Firebase operations, game logic, UI. */

import confetti from "canvas-confetti";

const ROOM_CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export const Utils = {
  /**
   * Generate a 6-character alphanumeric uppercase room code.
   * Uses crypto.getRandomValues for cryptographic randomness.
   */
  generateRoomCode(): string {
    let code = "";
    if (typeof window !== "undefined" && window.crypto && window.crypto.getRandomValues) {
      const values = new Uint32Array(6);
      window.crypto.getRandomValues(values);
      for (let i = 0; i < 6; i++) {
        code += ROOM_CODE_CHARS[values[i] % ROOM_CODE_CHARS.length];
      }
    } else {
      // Fallback
      for (let i = 0; i < 6; i++) {
        code += ROOM_CODE_CHARS[Math.floor(Math.random() * ROOM_CODE_CHARS.length)];
      }
    }
    return code;
  },

  /**
   * Compute the SHA-256 hash of the given string.
   * Input is lowercased before hashing for case-insensitive comparison.
   */
  async hashString(str: string): Promise<string> {
    str = str.toLowerCase();
    if (
      typeof window !== "undefined" &&
      window.crypto &&
      window.crypto.subtle &&
      window.crypto.subtle.digest
    ) {
      try {
        const data = new TextEncoder().encode(str);
        const hashBuffer = await window.crypto.subtle.digest("SHA-256", data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const hashHex = hashArray
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("");
        return hashHex;
      } catch (e) {
        // Fallback to pure JS below
      }
    }

    // Fallback: Pure JS SHA-256 implementation
    function rightRotate(value: number, amount: number): number {
      return (value >>> amount) | (value << (32 - amount));
    }

    const mathPow = Math.pow;
    const maxWord = mathPow(2, 32);
    let i: number, j: number;
    let result = "";

    let ascii = str;
    const words: number[] = [];
    const asciiLength = ascii.length * 8;

    let hash: number[] = [];
    const k: number[] = [];
    let primeCounter = 0;

    const isPrime = (n: number): boolean => {
      for (let factor = 2; factor * factor <= n; factor++) {
        if (n % factor === 0) return false;
      }
      return true;
    };

    for (let candidate = 2; primeCounter < 64; candidate++) {
      if (isPrime(candidate)) {
        if (primeCounter < 8) {
          hash[primeCounter] = (mathPow(candidate, 0.5) * maxWord) | 0;
        }
        k[primeCounter] = (mathPow(candidate, 1 / 3) * maxWord) | 0;
        primeCounter++;
      }
    }

    ascii += "\x80";
    while (ascii.length % 64 - 56) {
      ascii += "\x00";
    }
    for (i = 0; i < ascii.length; i++) {
      const charCode = ascii.charCodeAt(i);
      if (charCode >> 8) return "";
      words[i >> 2] |= charCode << (24 - (i % 4) * 8);
    }
    words[words.length] = (asciiLength / maxWord) | 0;
    words[words.length] = asciiLength | 0;

    for (j = 0; j < words.length; j += 16) {
      const w = words.slice(j, j + 16);
      const oldHash = hash.slice(0);

      while (w.length < 64) {
        const s0 =
          rightRotate(w[w.length - 15], 7) ^
          rightRotate(w[w.length - 15], 18) ^
          (w[w.length - 15] >>> 3);
        const s1 =
          rightRotate(w[w.length - 2], 17) ^
          rightRotate(w[w.length - 2], 19) ^
          (w[w.length - 2] >>> 10);
        w[w.length] = (w[w.length - 16] + s0 + w[w.length - 7] + s1) | 0;
      }

      for (i = 0; i < 64; i++) {
        const s1_r =
          rightRotate(hash[4], 6) ^
          rightRotate(hash[4], 11) ^
          rightRotate(hash[4], 25);
        const ch = (hash[4] & hash[5]) ^ (~hash[4] & hash[6]);
        const temp1 = (hash[7] + s1_r + ch + k[i] + w[i]) | 0;
        const s0_r =
          rightRotate(hash[0], 2) ^
          rightRotate(hash[0], 13) ^
          rightRotate(hash[0], 22);
        const maj =
          (hash[0] & hash[1]) ^ (hash[0] & hash[2]) ^ (hash[1] & hash[2]);
        const temp2 = (s0_r + maj) | 0;

        hash = [(temp1 + temp2) | 0].concat(hash);
        hash[4] = (hash[4] + temp1) | 0;
        hash.splice(8, 1);
      }

      for (i = 0; i < 8; i++) {
        hash[i] = (hash[i] + oldHash[i]) | 0;
      }
    }

    for (i = 0; i < 8; i++) {
      let word = hash[i];
      if (word < 0) word += maxWord;
      result += word.toString(16).padStart(8, "0");
    }

    return result;
  },

  /**
   * Sanitize a string by stripping HTML tags, trimming, and limiting length.
   */
  sanitize(str: string, maxLen = 100): string {
    if (!str) return "";
    if (typeof window === "undefined") {
      // Basic server-side regex strip
      let clean = str.replace(/<[^>]*>/g, "").trim();
      if (clean.length > maxLen) {
        clean = clean.substring(0, maxLen);
      }
      return clean;
    }
    const doc = new DOMParser().parseFromString(str, "text/html");
    let clean = doc.body.textContent || "";
    clean = clean.trim();
    if (clean.length > maxLen) {
      clean = clean.substring(0, maxLen);
    }
    return clean;
  },

  /**
   * Play premium full-screen confetti effect using canvas-confetti.
   */
  confetti(duration = 3000) {
    const end = Date.now() + duration;

    (function frame() {
      confetti({
        particleCount: 5,
        angle: 60,
        spread: 55,
        origin: { x: 0 },
        colors: ["#2563eb", "#db2777", "#16a34a", "#eab308", "#ffffff"],
      });
      confetti({
        particleCount: 5,
        angle: 120,
        spread: 55,
        origin: { x: 1 },
        colors: ["#2563eb", "#db2777", "#16a34a", "#eab308", "#ffffff"],
      });

      if (Date.now() < end) {
        requestAnimationFrame(frame);
      }
    })();
  },

  /**
   * Convert milliseconds to a MM:SS formatted string.
   */
  formatTime(ms: number): string {
    if (ms < 0) ms = 0;
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds < 10 ? "0" : ""}${seconds}`;
  },

  /**
   * Generate a unique player ID.
   */
  generateId(): string {
    if (typeof window !== "undefined" && window.crypto && window.crypto.randomUUID) {
      return window.crypto.randomUUID();
    }
    return (
      Date.now().toString(36) +
      "-" +
      Math.random().toString(36).substring(2, 10)
    );
  },

  /**
   * Standard debounce function.
   */
  debounce<T extends (...args: any[]) => any>(fn: T, ms: number) {
    let timer: ReturnType<typeof setTimeout> | null = null;
    return function (this: any, ...args: Parameters<T>) {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        fn.apply(this, args);
      }, ms);
    };
  },

  /**
   * Standard throttle function using timestamps.
   */
  throttle<T extends (...args: any[]) => any>(fn: T, ms: number) {
    let lastCall = 0;
    return function (this: any, ...args: Parameters<T>) {
      const now = Date.now();
      if (now - lastCall >= ms) {
        lastCall = now;
        fn.apply(this, args);
      }
    };
  },

  /**
   * Copy text to the clipboard.
   */
  copyToClipboard(text: string): Promise<void> {
    if (
      typeof window !== "undefined" &&
      navigator.clipboard &&
      navigator.clipboard.writeText
    ) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise((resolve, reject) => {
      try {
        const textarea = document.createElement("textarea");
        textarea.value = text;
        textarea.style.position = "fixed";
        textarea.style.left = "-9999px";
        textarea.style.top = "-9999px";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        const success = document.execCommand("copy");
        document.body.removeChild(textarea);
        if (success) {
          resolve();
        } else {
          reject(new Error("execCommand copy failed"));
        }
      } catch (err) {
        reject(err);
      }
    });
  },

  /**
   * Standard Fisher-Yates array shuffle.
   */
  shuffleArray<T>(arr: T[]): T[] {
    const newArr = arr.slice();
    for (let i = newArr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const temp = newArr[i];
      newArr[i] = newArr[j];
      newArr[j] = temp;
    }
    return newArr;
  },

  /**
   * Build the hot-seat order across all rounds.
   */
  buildHotSeatOrder(playerIds: string[], rounds: number): string[] {
    const totalPlayers = playerIds.length;
    let order: string[] = [];

    if (totalPlayers <= 3) {
      /* Everyone each round */
      for (let r = 0; r < rounds; r++) {
        const shuffled = this.shuffleArray(playerIds);
        order = order.concat(shuffled);
      }
      return order;
    }

    /* >3 players: 3 per round, ensure coverage */
    const totalSlots = rounds * 3;

    /* First, ensure every player gets at least one slot */
    let required = this.shuffleArray(playerIds);

    /* Fill remaining slots randomly */
    while (required.length < totalSlots) {
      required.push(playerIds[Math.floor(Math.random() * totalPlayers)]);
    }

    /* If required > totalSlots, truncate */
    required = required.slice(0, totalSlots);

    /* Shuffle final list */
    order = this.shuffleArray(required);

    return order;
  },
};
