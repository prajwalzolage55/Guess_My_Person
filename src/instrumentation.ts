/**
 * Next.js Instrumentation Hook
 * 
 * Node.js 22+ introduced a built-in global `localStorage` object, but it
 * requires `--localstorage-file` to function. Without that flag, the object
 * exists but its methods (getItem, setItem, etc.) are broken/non-functional.
 * 
 * Firebase SDK and other libraries that check for `localStorage` at import
 * time see the object, assume they're in a browser, and crash with:
 *   TypeError: localStorage.getItem is not a function
 * 
 * This instrumentation hook runs once when the server starts and removes the
 * broken Node.js localStorage/sessionStorage globals so that libraries
 * correctly fall back to their server-side code paths.
 */
export async function register() {
  if (typeof window === "undefined") {
    // We're on the server (Node.js)
    // Delete the broken Node.js built-in localStorage & sessionStorage
    // so that libraries don't mistakenly try to use them during SSR.
    const g = globalThis as any;

    if (g.localStorage && typeof g.localStorage.getItem !== "function") {
      delete g.localStorage;
    }
    if (g.sessionStorage && typeof g.sessionStorage.getItem !== "function") {
      delete g.sessionStorage;
    }
  }
}
