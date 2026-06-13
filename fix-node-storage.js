/**
 * Node.js v22+ Preload Fix
 * 
 * Node.js 22+ introduced built-in localStorage/sessionStorage globals.
 * These are broken without --localstorage-file and cause:
 *   TypeError: localStorage.getItem is not a function
 * 
 * This preload script deletes the broken globals before any
 * application code (including Firebase SDK) can access them.
 */
if (typeof window === "undefined") {
  if (typeof globalThis.localStorage !== "undefined") {
    delete globalThis.localStorage;
  }
  if (typeof globalThis.sessionStorage !== "undefined") {
    delete globalThis.sessionStorage;
  }
}
