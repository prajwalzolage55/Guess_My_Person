"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { FB, initAuth } from "@/lib/firebase";
import { SFX } from "@/lib/audio";
import { Utils } from "@/lib/utils";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { useBanner } from "@/hooks/useBanner";
import { RoomCategory } from "@/types/game";

type ViewType = "menu" | "open" | "create" | "code";

interface OpenRoomInfo {
  code: string;
  name: string;
  playerCount: number;
  timerMinutes: number;
  rounds: number;
}

const CATEGORIES: RoomCategory[] = [
  "Celebrities",
  "Fictional Characters",
  "Athletes",
  "Historical Figures",
  "Free for all",
];

export default function HomePage() {
  return (
    <Suspense fallback={<div className="page-container flex-center">Loading...</div>}>
      <ErrorBoundary>
        <HomeContent />
      </ErrorBoundary>
    </Suspense>
  );
}

function HomeContent() {
  const router = useRouter();
  const [view, setView] = useState<ViewType>("menu");
  const [playerId, setPlayerId] = useState("");
  const [soundOn, setSoundOn] = useState(true);
  const [authReady, setAuthReady] = useState(false);

  const { banner, showBanner } = useBanner();

  // Form States
  const [openRoomName, setOpenRoomName] = useState("");
  const [openRooms, setOpenRooms] = useState<OpenRoomInfo[]>([]);
  const [loadingRooms, setLoadingRooms] = useState(false);

  const [createName, setCreateName] = useState("");
  const [roomName, setRoomName] = useState("");
  const [createType, setCreateType] = useState<"open" | "private">("open");
  const [createRounds, setCreateRounds] = useState<number>(3);
  const [createTimer, setCreateTimer] = useState<number>(3);
  const [createCategory, setCreateCategory] = useState<RoomCategory>("Free for all");
  const [isCreating, setIsCreating] = useState(false);

  const [codeName, setCodeName] = useState("");
  const [codeInput, setCodeInput] = useState("");

  const searchParams = useSearchParams();

  // Initialize client state — Firebase Anonymous Auth
  useEffect(() => {
    SFX.init();
    setSoundOn(SFX.isSoundOn());

    (async () => {
      try {
        const uid = await initAuth();
        setPlayerId(uid);
        setAuthReady(true);
      } catch (err) {
        console.error("Anonymous auth failed:", err);
        showBanner("Authentication failed. Please refresh.", "error");
      }
    })();

    // Hydrate fields if stored
    const storedName = sessionStorage.getItem("playerName") || "";
    setOpenRoomName(storedName);
    setCreateName(storedName);
    setCodeName(storedName);

    // Detect ?join= invite link
    const joinCode = searchParams.get("join");
    if (joinCode) {
      setCodeInput(joinCode.toUpperCase());
      setView("code");
    }
  }, []);

  // Listen to open rooms in real time
  useEffect(() => {
    if (view !== "open") return;

    setLoadingRooms(true);
    const unsub = FB.onValue("rooms", (roomsData) => {
      try {
        const rooms = roomsData || {};
        const foundRooms: OpenRoomInfo[] = [];

        for (const code of Object.keys(rooms)) {
          const room = rooms[code];
          if (!room || !room.meta) continue;
          if (room.meta.isOpen !== true) continue;
          if (room.meta.status !== "lobby") continue;

          const playerCount = room.players ? Object.keys(room.players).length : 0;
          if (playerCount >= 8) continue;

          foundRooms.push({
            code,
            name: room.meta.roomName || "Unnamed Room",
            playerCount,
            timerMinutes: room.meta.timerMinutes || 3,
            rounds: room.meta.rounds || 3,
          });
        }
        setOpenRooms(foundRooms);
      } catch (err: any) {
        showBanner("Failed to load rooms. Please try again.", "error");
      } finally {
        setLoadingRooms(false);
      }
    });

    return () => unsub();
  }, [view, showBanner]);

  const handleSoundToggle = () => {
    const newState = SFX.toggleSound();
    setSoundOn(newState);
  };

  const handleJoinOpenRoom = (roomCode: string) => {
    const name = Utils.sanitize(openRoomName.trim(), 16);
    if (!name) {
      showBanner("Please enter a display name first.", "error");
      return;
    }
    joinRoom(roomCode, name);
  };

  const handleCreateRoom = async () => {
    const name = Utils.sanitize(createName.trim(), 16);
    const rName = Utils.sanitize(roomName.trim(), 24);

    if (!name) {
      showBanner("Please enter a display name.", "error");
      return;
    }
    if (!rName) {
      showBanner("Please enter a room name.", "error");
      return;
    }
    if (!authReady) {
      showBanner("Still authenticating. Please wait.", "warning");
      return;
    }

    setIsCreating(true);

    try {
      let code = null;
      let committed = false;

      for (let attempt = 0; attempt < 5; attempt++) {
        const candidate = Utils.generateRoomCode();
        const roomRef = FB.ref(`rooms/${candidate}`);

        const result = await FB.runTransaction(roomRef, (currentData) => {
          if (currentData !== null) {
            return; // Room already exists, abort
          }
          return {
            meta: {
              hostId: playerId,
              roomName: rName,
              isOpen: createType === "open",
              rounds: createRounds,
              timerMinutes: createTimer,
              category: createCategory,
              status: "lobby",
              createdAt: Date.now(),
              currentRound: 0,
              currentHotSeatIndex: 0,
              hotSeatOrder: [],
            },
            players: {
              [playerId]: {
                name,
                score: 0,
                isReady: true,
                isOnline: true,
                guessChancesLeft: 3,
                streak: 0,
                lastSeen: Date.now(),
              }
            }
          };
        });

        if (result.committed) {
          code = candidate;
          committed = true;
          break;
        }
      }

      if (!committed || !code) {
        showBanner("Could not generate a unique room code. Try again.", "error");
        setIsCreating(false);
        return;
      }

      const disconnectRef = FB.onDisconnect(`rooms/${code}/players/${playerId}`);
      if (disconnectRef) {
        disconnectRef.update({
          isOnline: false,
          lastSeen: FB.serverTimestamp(),
        });
      }

      sessionStorage.setItem("playerName", name);
      sessionStorage.setItem("roomCode", code);
      sessionStorage.setItem("isHost", "true");

      SFX.playPop();
      router.push(`/lobby?code=${code}`);
    } catch (err: any) {
      showBanner(`Error creating room: ${err.message}`, "error");
      setIsCreating(false);
    }
  };

  const handleJoinWithCode = () => {
    const name = Utils.sanitize(codeName.trim(), 16);
    const code = codeInput.trim().toUpperCase();

    if (!name) {
      showBanner("Please enter a display name.", "error");
      return;
    }
    if (!code || code.length !== 6) {
      showBanner("Please enter a valid 6-character room code.", "error");
      return;
    }

    joinRoom(code, name);
  };

  const joinRoom = async (code: string, name: string) => {
    if (!authReady) {
      showBanner("Still authenticating. Please wait.", "warning");
      return;
    }

    try {
      const meta = await FB.get(`rooms/${code}/meta`);
      if (!meta) {
        showBanner("Room not found.", "error");
        return;
      }

      // Spectator mode: if the game is already playing, join as spectator
      if (meta.status === "playing" || meta.status === "chat") {
        await FB.set(`rooms/${code}/spectators/${playerId}`, {
          name,
          joinedAt: Date.now(),
        });

        sessionStorage.setItem("playerName", name);
        sessionStorage.setItem("roomCode", code);
        sessionStorage.setItem("isHost", "false");
        sessionStorage.setItem("isSpectator", "true");

        SFX.playPop();
        router.push(`/game?code=${code}`);
        return;
      }

      if (meta.status !== "lobby") {
        showBanner("Game has ended.", "error");
        return;
      }

      const playersSnap = await FB.get(`rooms/${code}/players`);
      const playerCount = playersSnap ? Object.keys(playersSnap).length : 0;
      if (playerCount >= 8) {
        showBanner("Room is full (8/8).", "error");
        return;
      }

      await FB.set(`rooms/${code}/players/${playerId}`, {
        name,
        score: 0,
        isReady: false,
        isOnline: true,
        guessChancesLeft: 3,
        streak: 0,
        lastSeen: FB.serverTimestamp(),
      });

      const disconnectRef = FB.onDisconnect(`rooms/${code}/players/${playerId}`);
      if (disconnectRef) {
        disconnectRef.update({
          isOnline: false,
          lastSeen: FB.serverTimestamp(),
        });
      }

      const isHost = meta.hostId === playerId;

      sessionStorage.setItem("playerName", name);
      sessionStorage.setItem("roomCode", code);
      sessionStorage.setItem("isHost", isHost ? "true" : "false");

      SFX.playPop();
      router.push(`/lobby?code=${code}`);
    } catch (err: any) {
      showBanner(`Error joining room: ${err.message}`, "error");
    }
  };

  return (
    <div className="page-container flex-center flex-col gap-lg">
      <button
        onClick={handleSoundToggle}
        className="sound-toggle"
        aria-label="Toggle sound"
      >
        {soundOn ? "🔊" : "🔇"}
      </button>

      <header className="flex-col flex-center gap-sm">
        <h1 className="title-xl glitch-text" data-text="GUESS MY PERSON">
          GUESS MY PERSON
        </h1>
        <p className="tagline text-center">The ultimate multiplayer guessing game</p>
      </header>

      {/* VIEW A — Main Menu */}
      {view === "menu" && (
        <div className="section flex-col gap-md">
          <button
            onClick={() => setView("open")}
            className="btn btn--primary btn--full"
          >
            Join Open Room
          </button>
          <button
            onClick={() => setView("create")}
            className="btn btn--secondary btn--full"
          >
            Create Room
          </button>
          <button
            onClick={() => setView("code")}
            className="btn btn--ghost btn--full"
          >
            Join With Code
          </button>
        </div>
      )}

      {/* VIEW B — Join Open Room */}
      {view === "open" && (
        <div className="section flex-col gap-md">
          <button
            onClick={() => setView("menu")}
            className="btn btn--ghost btn--sm"
            style={{ alignSelf: "flex-start" }}
          >
            ← Back
          </button>
          <h2 className="title-md text-center">Open Rooms</h2>
          <div className="input-group">
            <label htmlFor="openRoomName">Display Name</label>
            <input
              id="openRoomName"
              className="input-field"
              type="text"
              maxLength={16}
              placeholder="Your display name"
              autoComplete="off"
              value={openRoomName}
              onChange={(e) => {
                setOpenRoomName(e.target.value);
                sessionStorage.setItem("playerName", e.target.value);
              }}
            />
          </div>
          <div className="room-list">
            {openRooms.map((r) => (
              <div
                key={r.code}
                className="room-list-item"
                onClick={() => handleJoinOpenRoom(r.code)}
              >
                <span className="room-list-item__name">{r.name}</span>
                <span className="room-list-item__info">
                  {r.rounds} rounds · {r.timerMinutes} min
                </span>
                <span className="room-list-item__players">{r.playerCount}/8</span>
              </div>
            ))}
          </div>
          {loadingRooms && (
            <div className="flex-center">
              <div className="loading-spinner"></div>
            </div>
          )}
          {!loadingRooms && openRooms.length === 0 && (
            <p className="text-muted text-center">
              No open rooms right now.{" "}
              <a
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  setView("create");
                }}
                style={{ color: "var(--accent-pink)", textDecoration: "underline" }}
              >
                Create one?
              </a>
            </p>
          )}
        </div>
      )}

      {/* VIEW C — Create Room */}
      {view === "create" && (
        <div className="section flex-col gap-md">
          <button
            onClick={() => setView("menu")}
            className="btn btn--ghost btn--sm"
            style={{ alignSelf: "flex-start" }}
          >
            ← Back
          </button>
          <h2 className="title-md text-center">Create Room</h2>
          <div className="input-group">
            <label htmlFor="createName">Display Name</label>
            <input
              id="createName"
              className="input-field"
              type="text"
              maxLength={16}
              placeholder="Your display name"
              autoComplete="off"
              value={createName}
              onChange={(e) => {
                setCreateName(e.target.value);
                sessionStorage.setItem("playerName", e.target.value);
              }}
            />
          </div>
          <div className="input-group">
            <label htmlFor="roomNameInput">Room Name</label>
            <input
              id="roomNameInput"
              className="input-field"
              type="text"
              maxLength={24}
              placeholder="e.g. Friday Night Fun"
              autoComplete="off"
              value={roomName}
              onChange={(e) => setRoomName(e.target.value)}
            />
          </div>
          <div className="input-group">
            <label>Room Type</label>
            <div className="option-group">
              <button
                type="button"
                className={`option-btn ${createType === "open" ? "option-btn--active" : ""}`}
                onClick={() => setCreateType("open")}
              >
                Open
              </button>
              <button
                type="button"
                className={`option-btn ${createType === "private" ? "option-btn--active" : ""}`}
                onClick={() => setCreateType("private")}
              >
                Private
              </button>
            </div>
          </div>
          <div className="input-group">
            <label>Rounds</label>
            <div className="option-group">
              {[1, 2, 3].map((r) => (
                <button
                  key={r}
                  type="button"
                  className={`option-btn ${createRounds === r ? "option-btn--active" : ""}`}
                  onClick={() => setCreateRounds(r)}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>
          <div className="input-group">
            <label>Timer</label>
            <div className="option-group">
              {[2, 3, 4].map((t) => (
                <button
                  key={t}
                  type="button"
                  className={`option-btn ${createTimer === t ? "option-btn--active" : ""}`}
                  onClick={() => setCreateTimer(t)}
                >
                  {t} min
                </button>
              ))}
            </div>
          </div>
          <div className="input-group">
            <label>Topic Category</label>
            <div className="option-group" style={{ flexWrap: "wrap" }}>
              {CATEGORIES.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  className={`option-btn ${createCategory === cat ? "option-btn--active" : ""}`}
                  onClick={() => setCreateCategory(cat)}
                  style={{ fontSize: "0.8rem" }}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>
          <button
            onClick={handleCreateRoom}
            className="btn btn--pink btn--full"
            disabled={isCreating || !authReady}
          >
            {isCreating ? "Creating…" : "Create Room"}
          </button>
        </div>
      )}

      {/* VIEW D — Join With Code */}
      {view === "code" && (
        <div className="section flex-col gap-md">
          <button
            onClick={() => setView("menu")}
            className="btn btn--ghost btn--sm"
            style={{ alignSelf: "flex-start" }}
          >
            ← Back
          </button>
          <h2 className="title-md text-center">Join With Code</h2>
          <div className="input-group">
            <label htmlFor="codeName">Display Name</label>
            <input
              id="codeName"
              className="input-field"
              type="text"
              maxLength={16}
              placeholder="Your display name"
              autoComplete="off"
              value={codeName}
              onChange={(e) => {
                setCodeName(e.target.value);
                sessionStorage.setItem("playerName", e.target.value);
              }}
            />
          </div>
          <div className="input-group">
            <label htmlFor="codeInput">Room Code</label>
            <input
              id="codeInput"
              className="input-field"
              type="text"
              maxLength={6}
              placeholder="e.g. K7X2PM"
              autoComplete="off"
              value={codeInput}
              onChange={(e) => setCodeInput(e.target.value.toUpperCase())}
            />
          </div>
          <button
            onClick={handleJoinWithCode}
            className="btn btn--primary btn--full"
            disabled={!authReady}
          >
            Join Room
          </button>
        </div>
      )}

      {/* Status / error banner */}
      <div
        className={`banner ${banner.type ? `banner--${banner.type}` : "banner--hidden"}`}
      >
        {banner.message}
      </div>
    </div>
  );
}
