/* router.js — Page navigation and session state management.
   Owns: navigating between HTML pages, reading/writing sessionStorage.
   Does NOT own: Firebase, game logic, UI rendering. */

(function () {
  'use strict';

  window.Router = {
    /**
     * Navigate to another HTML page.
     * @param {string} page - The page URL to navigate to (e.g. "lobby.html").
     */
    navigateTo: function (page) {
      window.location.href = page;
    },

    /**
     * Get a value from sessionStorage.
     * @param {string} key - The storage key.
     * @returns {string|null} The stored value, or null if not found.
     */
    getState: function (key) {
      return sessionStorage.getItem(key);
    },

    /**
     * Set a value in sessionStorage.
     * Converts the value to a string before storing.
     * @param {string} key - The storage key.
     * @param {*} value - The value to store (will be stringified).
     */
    setState: function (key, value) {
      sessionStorage.setItem(key, String(value));
    },

    /**
     * Clear all values from sessionStorage.
     */
    clearState: function () {
      sessionStorage.clear();
    },

    /**
     * Guard a page by requiring specific session state keys to be present.
     * If any of the specified keys are missing from sessionStorage, the
     * user is redirected to index.html.
     *
     * Usage at the top of each page script:
     *   if (!Router.requireState('roomCode', 'playerId')) return;
     *
     * @param {...string} keys - One or more required sessionStorage keys.
     * @returns {boolean} true if all keys are present, false if redirecting.
     */
    requireState: function () {
      for (var i = 0; i < arguments.length; i++) {
        var key = arguments[i];
        if (sessionStorage.getItem(key) === null) {
          window.location.href = 'index.html';
          return false;
        }
      }
      return true;
    }
  };
})();
