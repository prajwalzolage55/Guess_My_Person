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



interface ChatMessage {
  id: string;
  playerId: string;
  playerName: string;
  text: string;
  timestamp: number;
}

export default function ChatPage() {
  return (
    <Suspense fallback={<div className="page-container flex-center">Loading...</div>}>
      <ErrorBoundary>
        <ChatContent />
      </ErrorBoundary>
    </Suspense>
  );
}

function ChatContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const roomCode = (searchParams.get("code") || "").toUpperCase();

  const [playerId, setPlayerId] = useState("");
  const [playerName, setPlayerName] = useState("");
  const [isHost, setIsHost] = useState(false);
  const [soundOn, setSoundOn] = useState(true);

  // Database synchronised state
  const [meta, setMeta] = useState<RoomMeta | null>(null);
  const [players, setPlayers] = useState<Record<string, PlayerInfo>>({});
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);

  // Intermission Countdown
  const [countdownSeconds, setCountdownSeconds] = useState(30);

  // Form input
  const [chatInput, setChatInput] = useState("");

  const { banner, showBanner, hideBanner } = useBanner();

  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const navigatingRef = useRef(false);
  const countdownIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const stateRef = useRef({ meta, isHost, players, roomCode });
  useEffect(() => {
    stateRef.current = { meta, isHost, players, roomCode };
  }, [meta, isHost, players, roomCode]);

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

        // Update connection status
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

        // Attach Listeners
        const unsubMeta = FB.onValue(`rooms/${roomCode}/meta`, (data: RoomMeta) => {
          if (!data || navigatingRef.current) return;
          setMeta(data);
          const host = data.hostId === uid;
          setIsHost(host);
          sessionStorage.setItem("isHost", host ? "true" : "false");

          if (data.status === "playing") {
            navigatingRef.current = true;
            router.push(`/game?code=${roomCode}`);
          } else if (data.status === "ended") {
            navigatingRef.current = true;
            router.push(`/roast?code=${roomCode}`);
          }
        });

        const unsubPlayers = FB.onValue(`rooms/${roomCode}/players`, (data) => {
          if (!data) return;
          setPlayers(data);
        });

        // Listen to chat list in real time
        const unsubChat = FB.onValue(`rooms/${roomCode}/chat`, (data: Record<string, Omit<ChatMessage, "id">>) => {
          if (!data) {
            setChatMessages([]);
            return;
          }
          const msgs = Object.entries(data).map(([id, m]) => ({
            id,
            playerId: m.playerId,
            playerName: m.playerName,
            text: m.text,
            timestamp: m.timestamp || 0,
          }));
          msgs.sort((a, b) => a.timestamp - b.timestamp);
          setChatMessages(msgs);
          SFX.playPop();
        });

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
          unsubChat();
          unsubConnected();
          FB.off(`rooms/${roomCode}/meta`);
          FB.off(`rooms/${roomCode}/players`);
          FB.off(`rooms/${roomCode}/chat`);
          FB.off(".info/connected");
        };
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

  // Countdown timer clock
  useEffect(() => {
    countdownIntervalRef.current = setInterval(() => {
      setCountdownSeconds((prev) => {
        if (prev <= 1) {
          clearInterval(countdownIntervalRef.current!);
          countdownIntervalRef.current = null;
          onCountdownEnd();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (countdownIntervalRef.current) {
        clearInterval(countdownIntervalRef.current);
      }
    };
  }, [meta, isHost, players, roomCode]);

  const onCountdownEnd = async () => {
    if (navigatingRef.current) {
      showBanner("Already navigating...", "warning");
      return;
    }
    
    const { meta: currentMeta, isHost: currentIsHost, players: currentPlayers, roomCode: currentRoomCode } = stateRef.current;

    if (!currentIsHost) {
      showBanner("You are not the host. Waiting for host...", "warning");
      return;
    }

    if (!currentMeta) {
      showBanner("Room data missing.", "error");
      return;
    }

    try {
      showBanner("Transitioning...", "success");
      const currentRound = currentMeta.currentRound || 1;
      const totalRounds = currentMeta.rounds || 3;

      if (currentRound < totalRounds) {
        const playerIds = Object.keys(currentPlayers);
        const playerUpdates: Record<string, number | boolean> = {};
        playerIds.forEach((pid) => {
          playerUpdates[`${pid}/guessChancesLeft`] = 3;
          playerUpdates[`${pid}/streak`] = 0;
          playerUpdates[`${pid}/isReady`] = false;
        });

        if (Object.keys(playerUpdates).length > 0) {
          FB.update(`rooms/${currentRoomCode}/players`, playerUpdates);
        }

        FB.remove(`rooms/${currentRoomCode}/questions`);
        FB.remove(`rooms/${currentRoomCode}/guesses`);
        FB.remove(`rooms/${currentRoomCode}/chat`);

        FB.update(`rooms/${currentRoomCode}/meta`, {
          currentRound: currentRound + 1,
          status: "playing",
        });
      } else {
        FB.update(`rooms/${currentRoomCode}/meta`, {
          status: "ended",
        });
      }
    } catch (err: any) {
      console.error(err);
      showBanner(`Error: ${err.message}`, "error");
    }
  };

  const handleSendChat = () => {
    const cleanText = Utils.sanitize(chatInput.trim(), 200);
    if (!cleanText) return;

    FB.push(`rooms/${roomCode}/chat`, {
      playerId,
      playerName,
      text: cleanText,
      timestamp: FB.serverTimestamp(),
    });

    setChatInput("");
    SFX.playPop();
  };

  // Scroll chat window to bottom
  useEffect(() => {
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [chatMessages]);

  const handleSoundToggle = () => {
    const newState = SFX.toggleSound();
    setSoundOn(newState);
  };

  // Score sorted leaderboard array
  const sortedLeaderboard = Object.entries(players)
    .map(([id, p]) => ({
      id,
      name: p.name || "Unknown",
      score: p.score || 0,
    }))
    .sort((a, b) => b.score - a.score);

  return (
    <div className="page-container">
      <button 
        onClick={handleSoundToggle} 
        className="sound-toggle" 
        aria-label="Toggle sound" 
        suppressHydrationWarning
      >
        {soundOn ? "🔊" : "🔇"}
      </button>

      <div className={`banner ${banner.type ? `banner--${banner.type}` : "banner--hidden"}`}>
        {banner.message}
      </div>

      <h1 className="title-lg text-center text-accent-pink" style={{ marginTop: "1rem" }}>
        Round {meta?.currentRound || 1} Complete!
      </h1>

      <div className="flex-col flex-center gap-sm" style={{ margin: "1rem 0 1.5rem 0" }}>
        <div className="text-sm text-muted">
          Next round in: {countdownSeconds}s
        </div>
        {isHost && (
          <button 
            className="btn btn--primary btn--sm" 
            onClick={() => {
              setCountdownSeconds(0);
              onCountdownEnd();
            }}
          >
            Start Next Round Now
          </button>
        )}
      </div>

      {/* Leaderboard Card Section */}
      <div className="section" style={{ marginBottom: "1.5rem" }}>
        <h2 className="title-sm">Leaderboard</h2>
        <div className="leaderboard">
          {sortedLeaderboard.map((player, index) => {
            const rank = index + 1;
            const isSelf = player.id === playerId;
            return (
              <div
                key={player.id}
                className={`leaderboard-item ${isSelf ? "leaderboard-item--you" : ""}`}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "0.75rem 1rem",
                  margin: "0.5rem 0",
                  background: isSelf ? "rgba(59, 130, 246, 0.1)" : "rgba(255,255,255,0.03)",
                  border: isSelf ? "2px solid var(--accent-blue)" : "1px solid rgba(255,255,255,0.05)",
                  borderRadius: "8px",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                  <span
                    style={{
                      fontSize: "1.25rem",
                      fontWeight: "bold",
                      width: "32px",
                      textAlign: "center",
                    }}
                  >
                    {rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : `#${rank}`}
                  </span>
                  <span style={{ fontWeight: 500 }}>
                    {player.name} {isSelf && " (You)"}
                  </span>
                </div>
                <span className="leaderboard-score" style={{ fontWeight: "bold", color: "var(--accent-pink)" }}>
                  {player.score} pts
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Chat Section */}
      <div className="section chat-section" style={{ flex: 1, display: "flex", flexDirection: "column", height: "300px" }}>
        <h2 className="title-sm">Chat</h2>
        <p className="text-xs text-muted" style={{ margin: "-4px 0 8px 0" }}>
          Roast freely for 30 seconds
        </p>
        <div
          className="chat-container"
          style={{
            flex: 1,
            overflowY: "auto",
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: "8px",
            padding: "1rem",
            background: "rgba(0,0,0,0.2)",
          }}
        >
          {chatMessages.map((msg) => (
            <div
              key={msg.id}
              className="chat-message"
              style={{ margin: "0.5rem 0", display: "flex", flexDirection: "column" }}
            >
              <span
                className="chat-message__name"
                style={{ fontSize: "0.8rem", color: "var(--accent-blue)", fontWeight: "bold" }}
              >
                {msg.playerName}
              </span>
              <span className="chat-message__text" style={{ fontSize: "0.95rem" }}>
                {msg.text}
              </span>
            </div>
          ))}
          <div ref={chatEndRef} />
        </div>
      </div>

      {/* Bottom typing bar */}
      <div className="bottom-bar bottom-bar--question" style={{ position: "relative", marginTop: "1rem" }}>
        <input
          type="text"
          className="input-field"
          placeholder="Type a message..."
          maxLength={200}
          value={chatInput}
          onChange={(e) => setChatInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSendChat()}
          suppressHydrationWarning
        />
        <button className="btn btn--primary" onClick={handleSendChat} suppressHydrationWarning>
          →
        </button>
      </div>
    </div>
  );
}
