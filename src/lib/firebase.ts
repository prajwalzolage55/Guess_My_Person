/* firebase.ts — Firebase initialization and all database helper functions.
   Owns: Firebase config, init, all CRUD operations, listener management, anonymous auth.
   Does NOT own: game logic, UI updates. */

import { z } from "zod";

import { initializeApp, getApps, getApp } from "firebase/app";
import {
  getDatabase,
  ref as dbRef,
  set as dbSet,
  update as dbUpdate,
  push as dbPush,
  get as dbGet,
  onValue as dbOnValue,
  onChildAdded as dbOnChildAdded,
  onChildChanged as dbOnChildChanged,
  onChildRemoved as dbOnChildRemoved,
  off as dbOff,
  remove as dbRemove,
  onDisconnect as dbOnDisconnect,
  serverTimestamp as dbServerTimestamp,
  runTransaction as dbRunTransaction,
  Database,
  Unsubscribe,
  DataSnapshot
} from "firebase/database";
import {
  getAuth,
  signInAnonymously,
  onAuthStateChanged,
  Auth,
  User
} from "firebase/auth";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  databaseURL: process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID,
};

let db: Database | null = null;
let auth: Auth | null = null;
let serverTimeOffset = 0;

if (typeof window !== "undefined") {
  try {
    const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
    db = getDatabase(app);
    auth = getAuth(app);

    // Listen for server time offset
    const offsetRef = dbRef(db, ".info/serverTimeOffset");
    dbOnValue(offsetRef, (snap) => {
      serverTimeOffset = (snap.val() as number) || 0;
    });
  } catch (e) {
    console.error("Firebase initialization failed:", e);
  }
}

/**
 * Sign in anonymously and return the Firebase Auth UID.
 * If already signed in, returns the existing UID immediately.
 * This UID becomes the canonical player ID used in RTDB paths.
 */
export async function initAuth(): Promise<string> {
  if (typeof window === "undefined" || !auth) {
    throw new Error("Firebase Auth not available (server or uninitialised)");
  }

  // If already signed in, return immediately
  if (auth.currentUser) {
    return auth.currentUser.uid;
  }

  // Try signing in anonymously
  const credential = await signInAnonymously(auth);
  return credential.user.uid;
}

/**
 * Returns a promise that resolves with the current user's UID once auth state is determined.
 * Useful for pages that need to wait for auth to be ready before reading sessionStorage etc.
 */
export function waitForAuth(): Promise<string | null> {
  return new Promise((resolve) => {
    if (typeof window === "undefined" || !auth) {
      resolve(null);
      return;
    }
    if (auth.currentUser) {
      resolve(auth.currentUser.uid);
      return;
    }
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      unsubscribe();
      resolve(user ? user.uid : null);
    });
  });
}

/**
 * Internal map of active listeners for cleanup.
 * Key: path (string)
 * Value: Array of unsubscriber functions
 */
const activeListeners = new Map<string, Unsubscribe[]>();

function storeListener(path: string, unsubscribe: Unsubscribe) {
  if (!activeListeners.has(path)) {
    activeListeners.set(path, []);
  }
  activeListeners.get(path)!.push(unsubscribe);
}

interface PendingWriteEntry {
  type: "set" | "update";
  data: any;
  resolves: Array<() => void>;
  rejects: Array<(err: any) => void>;
  timer: any;
}

const pendingWrites = new Map<string, PendingWriteEntry>();

function debouncedWrite(path: string, data: any, type: "set" | "update"): Promise<void> {
  if (typeof window === "undefined" || !db) {
    return Promise.resolve();
  }

  if (pendingWrites.has(path)) {
    const pending = pendingWrites.get(path)!;
    clearTimeout(pending.timer);
    if (type === "update" && pending.type === "update") {
      pending.data = Object.assign({}, pending.data, data);
    } else {
      pending.data = data;
      pending.type = type;
    }
    
    // Reset the timer so it actually fires
    pending.timer = setTimeout(() => {
      pendingWrites.delete(path);
      if (!db) return;
      const targetRef = dbRef(db, path);
      const promise =
        pending.type === "set"
          ? dbSet(targetRef, pending.data)
          : dbUpdate(targetRef, pending.data);

      promise
        .then(() => {
          pending.resolves.forEach((r) => r());
        })
        .catch((err) => {
          pending.rejects.forEach((r) => r(err));
        });
    }, 100);

    return new Promise<void>((resolve, reject) => {
      pending.resolves.push(resolve);
      pending.rejects.push(reject);
    });
  }

  return new Promise<void>((resolve, reject) => {
    const entry: PendingWriteEntry = {
      type: type,
      data: data,
      resolves: [resolve],
      rejects: [reject],
      timer: null
    };

    entry.timer = setTimeout(() => {
      pendingWrites.delete(path);
      if (!db) return;
      const targetRef = dbRef(db, path);
      const promise =
        entry.type === "set"
          ? dbSet(targetRef, entry.data)
          : dbUpdate(targetRef, entry.data);

      promise
        .then(() => {
          entry.resolves.forEach((r) => r());
        })
        .catch((err) => {
          entry.rejects.forEach((r) => r(err));
        });
    }, 100);

    pendingWrites.set(path, entry);
  });
}

export const FB = {
  db: () => db,

  ref: (path: string) => {
    if (!db) throw new Error("Firebase database not initialized");
    return dbRef(db, path);
  },

  runTransaction: (ref: any, transactionUpdate: (currentData: any) => any) => {
    return dbRunTransaction(ref, transactionUpdate);
  },

  set: (path: string, data: any) => {
    return debouncedWrite(path, data, "set");
  },

  update: (path: string, data: any) => {
    return debouncedWrite(path, data, "update");
  },

  push: (path: string, data: any): string => {
    if (!db) throw new Error("Firebase database not initialized");
    const newRef = dbPush(dbRef(db, path), data);
    return newRef.key || "";
  },

  get: async (path: string): Promise<any> => {
    if (!db) return null;
    const snap = await dbGet(dbRef(db, path));
    return snap.val();
  },

  /**
   * Type-safe get with Zod validation at the read boundary.
   * Logs a warning on validation failure but returns the raw data
   * for graceful degradation (never crashes).
   */
  getSafe: async <T>(path: string, schema: z.ZodSchema<T>): Promise<T | null> => {
    if (!db) return null;
    const snap = await dbGet(dbRef(db, path));
    const raw = snap.val();
    if (raw === null || raw === undefined) return null;

    const result = schema.safeParse(raw);
    if (!result.success) {
      console.warn(
        `[FB.getSafe] Validation failed at "${path}":`,
        result.error.issues
      );
      // Graceful degradation: return raw data cast as T
      return raw as T;
    }
    return result.data;
  },

  onValue: (path: string, callback: (data: any, key: string | null) => void): Unsubscribe => {
    if (!db) return () => {};
    const targetRef = dbRef(db, path);
    const unsub = dbOnValue(targetRef, (snapshot) => {
      callback(snapshot.val(), snapshot.key);
    });
    storeListener(path, unsub);
    return unsub;
  },

  onChildAdded: (path: string, callback: (data: any, key: string | null) => void): Unsubscribe => {
    if (!db) return () => {};
    const targetRef = dbRef(db, path);
    const unsub = dbOnChildAdded(targetRef, (snapshot) => {
      callback(snapshot.val(), snapshot.key);
    });
    storeListener(path, unsub);
    return unsub;
  },

  onChildChanged: (path: string, callback: (data: any, key: string | null) => void): Unsubscribe => {
    if (!db) return () => {};
    const targetRef = dbRef(db, path);
    const unsub = dbOnChildChanged(targetRef, (snapshot) => {
      callback(snapshot.val(), snapshot.key);
    });
    storeListener(path, unsub);
    return unsub;
  },

  onChildRemoved: (path: string, callback: (data: any, key: string | null) => void): Unsubscribe => {
    if (!db) return () => {};
    const targetRef = dbRef(db, path);
    const unsub = dbOnChildRemoved(targetRef, (snapshot) => {
      callback(snapshot.val(), snapshot.key);
    });
    storeListener(path, unsub);
    return unsub;
  },

  off: (path: string) => {
    if (!db) return;
    const targetRef = dbRef(db, path);
    dbOff(targetRef);
    const unsubs = activeListeners.get(path);
    if (unsubs) {
      unsubs.forEach((unsub) => unsub());
      activeListeners.delete(path);
    }
  },

  remove: (path: string): Promise<void> => {
    if (!db) return Promise.resolve();
    return dbRemove(dbRef(db, path));
  },

  onDisconnect: (path: string) => {
    if (!db) throw new Error("Firebase database not initialized");
    return dbOnDisconnect(dbRef(db, path));
  },

  serverTimestamp: () => {
    return dbServerTimestamp();
  },

  getServerTime: (): number => {
    return Date.now() + serverTimeOffset;
  },

  detachAll: () => {
    activeListeners.forEach((unsubs) => {
      unsubs.forEach((unsub) => unsub());
    });
    activeListeners.clear();
  },

  connectedRef: () => {
    if (!db) throw new Error("Firebase database not initialized");
    return dbRef(db, ".info/connected");
  }
};

// Automatic cleanup in browser environments
if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", () => {
    FB.detachAll();
  });
}
