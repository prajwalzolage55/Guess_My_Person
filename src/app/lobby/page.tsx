"use client";

import { useEffect, useState, useRef } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Suspense } from "react";
import { FB, initAuth } from "@/lib/firebase";
import { SFX } from "@/lib/audio";
import { Utils } from "@/lib/utils";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { useBanner } from "@/hooks/useBanner";
import { PlayerInfo, RoomMeta } from "@/types/game";



export default function LobbyPage() {
  return (
    <Suspense fallback={<div className="page-container flex-center">Loading...</div>}>
      <ErrorBoundary>
        <LobbyContent />
      </ErrorBoundary>
    </Suspense>
  );
}

function LobbyContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const roomCode = (searchParams.get("code") || "").toUpperCase();

  const [playerId, setPlayerId] = useState<string>("");
  const [playerName, setPlayerName] = useState<string>("");
  const [isHost, setIsHost] = useState<boolean>(false);
  const [soundOn, setSoundOn] = useState<boolean>(true);

  // Database synchronised state
  const [players, setPlayers] = useState<Record<string, PlayerInfo>>({});
  const [meta, setMeta] = useState<RoomMeta | null>(null);

  const { banner, showBanner, hideBanner } = useBanner();

  const listenersAttachedRef = useRef(false);

  // Setup sound & user identities
  useEffect(() => {
    SFX.init();
    setSoundOn(SFX.isSoundOn());

    const pName = sessionStorage.getItem("playerName");

    if (!pName || !roomCode) {
      router.push("/");
      return;
    }

    let cancelled = false;
    const cleanupRef = { current: () => {} };

    (async () => {
      try {
        const uid = await initAuth();
        if (cancelled) return;

        setPlayerId(uid);
        setPlayerName(pName);

        // Initialise player online state
        FB.update(`rooms/${roomCode}/players/${uid}`, {
          isOnline: true,
          lastSeen: FB.serverTimestamp(),
        });

        const disconnectRef = FB.onDisconnect(`rooms/${roomCode}/players/${uid}`);
        if (disconnectRef) {
          disconnectRef.update({
            isOnline: false,
            lastSeen: FB.serverTimestamp(),
          });
        }

        // Attach firebase listeners
        if (!listenersAttachedRef.current) {
          listenersAttachedRef.current = true;

          // Meta listener
          const unsubMeta = FB.onValue(`rooms/${roomCode}/meta`, (data: RoomMeta) => {
            if (!data) {
              showBanner("Room was closed.", "warning");
              sessionStorage.clear();
              setTimeout(() => {
                router.push("/");
              }, 1500);
              return;
            }

            setMeta(data);
            const host = data.hostId === uid;
            setIsHost(host);
            sessionStorage.setItem("isHost", host ? "true" : "false");

            // Navigate if status changes
            if (data.status === "playing") {
              router.push(`/game?code=${roomCode}`);
            }
          });

          // Players listener
          const unsubPlayers = FB.onValue(`rooms/${roomCode}/players`, (data: Record<string, PlayerInfo>) => {
            if (!data) {
              setPlayers({});
              return;
            }

            // Check if kicked
            if (!data[uid]) {
              showBanner("You have been removed from the room.", "warning");
              sessionStorage.clear();
              setTimeout(() => {
                router.push("/");
              }, 1500);
              return;
            }

            setPlayers(data);

            // Sync local offline status if all player are offline
            let allOffline = true;
            Object.keys(data).forEach((id) => {
              if (data[id].isOnline) allOffline = false;
            });
            if (allOffline && Object.keys(data).length > 0) {
              FB.remove(`rooms/${roomCode}`);
            }
          });

          // Connection state listener
          const unsubConnected = FB.onValue(".info/connected", (connected: boolean) => {
            if (connected) {
              hideBanner();
              const discRef = FB.onDisconnect(`rooms/${roomCode}/players/${uid}`);
              if (discRef) {
                discRef.update({
                  isOnline: false,
                  lastSeen: FB.serverTimestamp(),
                });
              }
              FB.update(`rooms/${roomCode}/players/${uid}`, {
                isOnline: true,
                lastSeen: FB.serverTimestamp(),
              });
            } else {
              showBanner("Reconnecting…", "warning");
            }
          });

          cleanupRef.current = () => {
            unsubMeta();
            unsubPlayers();
            unsubConnected();
            FB.off(`rooms/${roomCode}/meta`);
            FB.off(`rooms/${roomCode}/players`);
            FB.off(".info/connected");
            listenersAttachedRef.current = false;
          };
        }
      } catch (err) {
        console.error("Auth failed:", err);
        router.push("/");
      }
    })();

    return () => {
      cancelled = true;
      cleanupRef.current();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomCode]);

  const handleSoundToggle = () => {
    const newState = SFX.toggleSound();
    setSoundOn(newState);
  };

  const handleReadyToggle = () => {
    const myPlayer = players[playerId];
    if (!myPlayer) return;

    const nextReady = !myPlayer.isReady;
    FB.update(`rooms/${roomCode}/players/${playerId}`, {
      isReady: nextReady,
    });
    SFX.playPop();
  };

  const handleStartGame = async () => {
    if (!isHost || !meta) return;

    try {
      const onlineIds: string[] = [];
      const allIds = Object.keys(players);
      allIds.forEach((id) => {
        if (players[id].isOnline) onlineIds.push(id);
      });

      if (onlineIds.length < 2) {
        showBanner("Need at least 2 online players to start.", "error");
        return;
      }

      // Generate hot-seat order
      const hotSeatOrder = Utils.buildHotSeatOrder(onlineIds, meta.rounds);

      // Reset players isReady
      const readyUpdates: Record<string, boolean> = {};
      allIds.forEach((id) => {
        readyUpdates[`${id}/isReady`] = false;
      });

      await FB.update(`rooms/${roomCode}/players`, readyUpdates);

      // Start game status
      await FB.update(`rooms/${roomCode}/meta`, {
        status: "playing",
        currentRound: 1,
        currentHotSeatIndex: 0,
        hotSeatOrder: hotSeatOrder,
      });
    } catch (err: any) {
      showBanner(`Error starting game: ${err.message}`, "error");
    }
  };

  const handleKickPlayer = (targetId: string) => {
    if (!isHost || targetId === playerId) return;
    FB.remove(`rooms/${roomCode}/players/${targetId}`);
    SFX.playPop();
  };

  const handleLeaveRoom = async () => {
    try {
      // Remove self
      await FB.remove(`rooms/${roomCode}/players/${playerId}`);

      if (isHost) {
        const snap = await FB.get(`rooms/${roomCode}/players`);
        if (snap && Object.keys(snap).length > 0) {
          // Transfer host
          const newHostId = Object.keys(snap)[0];
          await FB.update(`rooms/${roomCode}/meta`, {
            hostId: newHostId,
          });
        } else {
          // Clean up empty room
          await FB.remove(`rooms/${roomCode}`);
        }
      }
    } catch (e) {
      // Best-effort leave
    }

    FB.detachAll();
    sessionStorage.clear();
    router.push("/");
  };

  // Count players
  const playerIds = Object.keys(players);
  const onlineCount = playerIds.filter((id) => players[id].isOnline).length;
  const myPlayer = players[playerId];
  const isReady = myPlayer?.isReady || false;

  return (
    <div className="page-container flex-col gap-lg">
      <button
        onClick={handleSoundToggle}
        className="sound-toggle"
        aria-label="Toggle sound"
      >
        {soundOn ? "🔊" : "🔇"}
      </button>

      <div
        className={`banner ${banner.type ? `banner--${banner.type}` : "banner--hidden"}`}
      >
        {banner.message}
      </div>

      {/* Room code header */}
      <div className="flex-col flex-center gap-sm">
        <div
          className="room-code"
          title="Click to copy room code"
          onClick={() => {
            Utils.copyToClipboard(roomCode);
            showBanner("Room code copied!", "success");
            SFX.playPop();
          }}
          style={{ cursor: "pointer" }}
        >
          <span className="room-code__label">ROOM CODE</span>
          <span className="room-code__text" style={{ fontSize: "2rem", fontWeight: "bold", letterSpacing: "2px" }}>
            {roomCode}
          </span>
        </div>
        <button
          className="btn btn--secondary btn--sm"
          onClick={() => {
            const url = `${window.location.origin}/?join=${roomCode}`;
            Utils.copyToClipboard(url);
            showBanner("Invite link copied!", "success");
            SFX.playPop();
          }}
          style={{ fontSize: "0.8rem" }}
        >
          📋 Copy Invite Link
        </button>
        <p className="text-sm text-muted text-center">
          {meta?.roomName || "Loading room info..."}
        </p>
      </div>

      {/* Settings badge info */}
      {meta && (
        <div className="card flex-center gap-sm" style={{ padding: "0.75rem 1.5rem", borderRadius: "12px", border: "1px solid rgba(255,255,255,0.1)", flexWrap: "wrap" }}>
          <span className="badge badge--blue">
            {meta.rounds} {meta.rounds === 1 ? "round" : "rounds"}
          </span>
          <span className="badge badge--blue">{meta.timerMinutes} min</span>
          <span className="badge badge--pink">{meta.isOpen ? "Open" : "Private"}</span>
          {meta.category && meta.category !== "Free for all" && (
            <span className="badge badge--green">{meta.category}</span>
          )}
        </div>
      )}

      {/* Player List Card */}
      <div className="section flex-col gap-sm">
        <div className="flex-between">
          <h2 className="title-sm">Players</h2>
          <span className="text-sm text-muted">
            {onlineCount}/{playerIds.length} online
          </span>
        </div>
        <div className="player-list">
          {playerIds.map((id) => {
            const p = players[id];
            const isSelf = id === playerId;
            const isRoomHost = id === meta?.hostId;
            return (
              <div
                key={id}
                className={`player-item ${p.isReady ? "player-item--ready" : ""} ${isSelf ? "player-item--you" : ""}`}
              >
                <span className="player-name">
                  {p.name} {isSelf && " (You)"}
                </span>

                <div className="flex-center gap-sm">
                  {isRoomHost && <span className="badge badge--pink">HOST</span>}
                  {p.isReady && <span className="badge badge--green">READY</span>}
                  {!p.isOnline && <span className="badge badge--red">OFFLINE</span>}

                  {isHost && !isSelf && (
                    <button
                      onClick={() => handleKickPlayer(id)}
                      className="btn btn--danger btn--sm"
                      style={{ padding: "0.25rem 0.5rem", minWidth: "24px" }}
                      aria-label={`Kick ${p.name}`}
                    >
                      ✕
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Host Controls */}
      {isHost ? (
        <div className="section flex-col gap-md">
          <button
            onClick={handleStartGame}
            className="btn btn--pink btn--full btn--lg"
            disabled={onlineCount < 2}
          >
            Start Game
          </button>
        </div>
      ) : (
        /* Player Controls */
        <div className="section flex-col gap-md">
          <button
            onClick={handleReadyToggle}
            className={`btn ${isReady ? "btn--secondary" : "btn--primary"} btn--full`}
          >
            {isReady ? "Not Ready" : "Ready"}
          </button>
        </div>
      )}

      {/* Leave */}
      <button
        onClick={handleLeaveRoom}
        className="btn btn--ghost btn--full btn--sm"
      >
        Leave Room
      </button>
    </div>
  );
}
