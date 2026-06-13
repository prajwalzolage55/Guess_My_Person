/* firebase.js — Firebase initialization and all database helper functions.
   Owns: Firebase config, init, all CRUD operations, listener management.
   Does NOT own: game logic, UI updates. */

(function () {
  'use strict';

  const firebaseConfig = {
    apiKey: "AIzaSyBjvS4eVImQhjZ-QvsJOz-gp3TfeqVWNL8",
    authDomain: "guess-name1.firebaseapp.com",
    databaseURL: "https://guess-name1-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "guess-name1",
    storageBucket: "guess-name1.firebasestorage.app",
    messagingSenderId: "934709377503",
    appId: "1:934709377503:web:471e4ad3d5b7a17d14ec6a",
    measurementId: "G-0B6VXT9Y1L"
  };

  /** @type {firebase.database.Database|null} */
  let db = null;

  /** @type {number} */
  let serverTimeOffset = 0;

  /**
   * Internal map of active listeners for cleanup.
   * Key: path (string)
   * Value: Array of { eventType: string, callback: function }
   */
  const activeListeners = new Map();

  /**
   * Store a listener reference for later cleanup.
   * @param {string} path
   * @param {string} eventType
   * @param {Function} callback
   */
  /**
   * Store a listener reference for later cleanup.
   * @param {string} path
   * @param {string} eventType
   * @param {Function} callback
   */
  function storeListener(path, eventType, callback) {
    if (!activeListeners.has(path)) {
      activeListeners.set(path, []);
    }
    activeListeners.get(path).push({ eventType, callback });
  }

  /**
   * Pending write queue to debounce writes by 100ms.
   * Key: path (string)
   * Value: { type: 'set'|'update', data: *, resolves: Array<Function>, rejects: Array<Function>, timer: TimerID }
   */
  const pendingWrites = new Map();

  /**
   * Debounce a Firebase set or update operation.
   * @param {string} path
   * @param {*} data
   * @param {'set'|'update'} type
   * @returns {Promise<void>}
   */
  function debouncedWrite(path, data, type) {
    if (pendingWrites.has(path)) {
      const pending = pendingWrites.get(path);
      clearTimeout(pending.timer);
      if (type === 'update' && pending.type === 'update') {
        pending.data = Object.assign({}, pending.data, data);
      } else {
        pending.data = data;
        pending.type = type;
      }
      return new Promise((resolve, reject) => {
        pending.resolves.push(resolve);
        pending.rejects.push(reject);
      });
    }

    return new Promise((resolve, reject) => {
      const entry = {
        type: type,
        data: data,
        resolves: [resolve],
        rejects: [reject],
        timer: null
      };

      entry.timer = setTimeout(() => {
        pendingWrites.delete(path);
        const ref = db.ref(path);
        const promise = entry.type === 'set' ? ref.set(entry.data) : ref.update(entry.data);
        promise.then(() => {
          entry.resolves.forEach(r => r());
        }).catch(err => {
          entry.rejects.forEach(r => r(err));
        });
      }, 100);

      pendingWrites.set(path, entry);
    });
  }

  window.FB = {
    /**
     * Initialize the Firebase app and store a reference to the database.
     * Call this once on page load.
     */
    init: function () {
      if (!firebase) {
        console.error('Firebase SDK not loaded. Ensure the compat scripts are included in the HTML.');
        return;
      }
      // Prevent re-initialization if already initialized
      if (!firebase.apps.length) {
        firebase.initializeApp(firebaseConfig);
      }
      db = firebase.database();

      // Listen for server time offset to synchronize timers
      db.ref('.info/serverTimeOffset').on('value', function (snap) {
        serverTimeOffset = snap.val() || 0;
      });
    },

    /**
     * Return a DatabaseReference for the given path.
     * @param {string} path
     * @returns {firebase.database.Reference}
     */
    ref: function (path) {
      return db.ref(path);
    },

    /**
     * Set data at the given path (overwrites).
     * @param {string} path
     * @param {*} data
     * @returns {Promise<void>}
     */
    set: function (path, data) {
      return debouncedWrite(path, data, 'set');
    },

    /**
     * Update (merge) data at the given path.
     * @param {string} path
     * @param {Object} data
     * @returns {Promise<void>}
     */
    update: function (path, data) {
      return debouncedWrite(path, data, 'update');
    },

    /**
     * Push a new child under the given path.
     * @param {string} path
     * @param {*} data
     * @returns {string} The generated push key.
     */
    push: function (path, data) {
      const newRef = db.ref(path).push(data);
      return newRef.key;
    },

    /**
     * Read data at the given path once.
     * @param {string} path
     * @returns {Promise<*>} Resolves to snapshot.val().
     */
    get: function (path) {
      return db.ref(path).once('value').then(function (snapshot) {
        return snapshot.val();
      });
    },

    /**
     * Attach a 'value' listener on the given path.
     * @param {string} path
     * @param {Function} callback - receives snapshot.val() and the snapshot key.
     * @returns {Function} Unsubscribe function.
     */
    onValue: function (path, callback) {
      var ref = db.ref(path);
      var handler = function (snapshot) {
        callback(snapshot.val(), snapshot.key);
      };
      ref.on('value', handler);
      storeListener(path, 'value', handler);
      return function () {
        ref.off('value', handler);
      };
    },

    /**
     * Attach a 'child_added' listener on the given path.
     * @param {string} path
     * @param {Function} callback - receives snapshot.val() and the snapshot key.
     * @returns {Function} Unsubscribe function.
     */
    onChildAdded: function (path, callback) {
      var ref = db.ref(path);
      var handler = function (snapshot) {
        callback(snapshot.val(), snapshot.key);
      };
      ref.on('child_added', handler);
      storeListener(path, 'child_added', handler);
      return function () {
        ref.off('child_added', handler);
      };
    },

    /**
     * Attach a 'child_changed' listener on the given path.
     * @param {string} path
     * @param {Function} callback - receives snapshot.val() and the snapshot key.
     * @returns {Function} Unsubscribe function.
     */
    onChildChanged: function (path, callback) {
      var ref = db.ref(path);
      var handler = function (snapshot) {
        callback(snapshot.val(), snapshot.key);
      };
      ref.on('child_changed', handler);
      storeListener(path, 'child_changed', handler);
      return function () {
        ref.off('child_changed', handler);
      };
    },

    /**
     * Attach a 'child_removed' listener on the given path.
     * @param {string} path
     * @param {Function} callback - receives snapshot.val() and the snapshot key.
     * @returns {Function} Unsubscribe function.
     */
    onChildRemoved: function (path, callback) {
      var ref = db.ref(path);
      var handler = function (snapshot) {
        callback(snapshot.val(), snapshot.key);
      };
      ref.on('child_removed', handler);
      storeListener(path, 'child_removed', handler);
      return function () {
        ref.off('child_removed', handler);
      };
    },

    /**
     * Detach all listeners on the given path.
     * @param {string} path
     */
    off: function (path) {
      var ref = db.ref(path);
      ref.off();
      activeListeners.delete(path);
    },

    /**
     * Remove data at the given path.
     * @param {string} path
     * @returns {Promise<void>}
     */
    remove: function (path) {
      return db.ref(path).remove();
    },

    /**
     * Return the onDisconnect object for the given path.
     * @param {string} path
     * @returns {firebase.database.OnDisconnect}
     */
    onDisconnect: function (path) {
      return db.ref(path).onDisconnect();
    },

    /**
     * Return the Firebase server timestamp sentinel value.
     * @returns {Object}
     */
    serverTimestamp: function () {
      return firebase.database.ServerValue.TIMESTAMP;
    },

    /**
     * Get the estimated current server time in ms.
     * @returns {number}
     */
    getServerTime: function () {
      return Date.now() + serverTimeOffset;
    },

    /**
     * Detach ALL stored listeners across all paths.
     * Call on page unload to clean up.
     */
    detachAll: function () {
      activeListeners.forEach(function (listeners, path) {
        var ref = db.ref(path);
        listeners.forEach(function (entry) {
          ref.off(entry.eventType, entry.callback);
        });
      });
      activeListeners.clear();
    },

    /**
     * Return a reference to .info/connected for monitoring connection state.
     * @returns {firebase.database.Reference}
     */
    connectedRef: function () {
      return db.ref('.info/connected');
    }
  };

  // Automatically clean up all listeners when the page unloads
  window.addEventListener('beforeunload', function () {
    FB.detachAll();
  });
})();
