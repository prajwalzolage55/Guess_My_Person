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



export default function RoastPage() {
  return (
    <Suspense fallback={<div className="page-container flex-center">Loading...</div>}>
      <ErrorBoundary>
        <RoastContent />
      </ErrorBoundary>
    </Suspense>
  );
}

function RoastContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const roomCode = (searchParams.get("code") || "").toUpperCase();

  const [playerId, setPlayerId] = useState("");
  const [playerName, setPlayerName] = useState("");
  const [isHost, setIsHost] = useState(false);
  const [soundOn, setSoundOn] = useState(true);

  // Synchronised room state
  const [meta, setMeta] = useState<RoomMeta | null>(null);
  const [players, setPlayers] = useState<Record<string, PlayerInfo>>({});

  // Roast loading state
  const [roastLoading, setRoastLoading] = useState(true);
  const [roastText, setRoastText] = useState("");
  const [roastTargetName, setRoastTargetName] = useState("");
  const [isResetting, setIsResetting] = useState(false);
  const [isLeaving, setIsLeaving] = useState(false);

  const { banner, showBanner, hideBanner } = useBanner();

  const navigatingRef = useRef(false);
  const typewriterIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const roastLoadedRef = useRef(false);
  const leaderboardAnimatedRef = useRef(false);

  // Animated leaderboard state
  const [revealedCount, setRevealedCount] = useState(0);

  // Initial confetti on mount (small burst)
  useEffect(() => {
    Utils.confetti(2000);
  }, []);

  // Setup sound & user identities via Firebase Auth
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

        // Online status
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

        // Attach DB Listeners
        const unsubMeta = FB.onValue(`rooms/${roomCode}/meta`, (data: RoomMeta) => {
          if (!data || navigatingRef.current) return;
          setMeta(data);
          const host = data.hostId === uid;
          setIsHost(host);
          sessionStorage.setItem("isHost", host ? "true" : "false");

          if (data.status === "lobby") {
            navigatingRef.current = true;
            router.push(`/lobby?code=${roomCode}`);
          }
        });

        const unsubPlayers = FB.onValue(`rooms/${roomCode}/players`, (data) => {
          if (!data) return;
          setPlayers(data);
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

        // Store cleanup for when component unmounts
        cleanupRef.current = () => {
          unsubMeta();
          unsubPlayers();
          unsubConnected();
          FB.off(`rooms/${roomCode}/meta`);
          FB.off(`rooms/${roomCode}/players`);
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

  // Load standings and trigger roast generation
  useEffect(() => {
    if (Object.keys(players).length === 0 || !meta || roastLoadedRef.current || !playerId) return;
    roastLoadedRef.current = true;

    loadAndGenerateRoast();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [players, meta, playerId]);

  const loadAndGenerateRoast = async () => {
    const sorted = Object.entries(players)
      .map(([id, p]) => ({
        id,
        name: p.name || "Unknown",
        score: p.score || 0,
      }))
      .sort((a, b) => b.score - a.score);

    const lastPlacePlayer = sorted[sorted.length - 1];
    if (!lastPlacePlayer) return;

    setRoastTargetName(lastPlacePlayer.name);
    setRoastLoading(true);

    try {
      // Check if roast text is already stored in database
      const existingRoast = await FB.get(`rooms/${roomCode}/roast`);
      if (existingRoast && existingRoast.text) {
        setRoastLoading(false);
        runTypewriter(existingRoast.text);
        return;
      }

      if (playerId === meta?.hostId) {
        // Host client generates the roast via server-side API route
        const questionsList: string[] = [];
        const guessesList: string[] = [];

        // Fetch questions
        try {
          const qSnap = await FB.get(`rooms/${roomCode}/questions`);
          if (qSnap) {
            Object.values(qSnap).forEach((q: any) => {
              if (q.askerId === lastPlacePlayer.id && q.text) {
                questionsList.push(q.text);
              }
            });
          }
        } catch (e) {
          console.error("Questions fetch error:", e);
        }

        // Fetch guesses
        try {
          const gSnap = await FB.get(`rooms/${roomCode}/guesses`);
          if (gSnap) {
            Object.values(gSnap).forEach((g: any) => {
              if (g.guesserId === lastPlacePlayer.id && g.guess) {
                guessesList.push(g.guess);
              }
            });
          }
        } catch (e) {
          console.error("Guesses fetch error:", e);
        }

        // Call server-side API route instead of Groq directly
        const roastTextContent = await callRoastAPI(
          lastPlacePlayer.name,
          questionsList,
          guessesList
        );

        // Save roast to Firebase
        await FB.set(`rooms/${roomCode}/roast`, {
          text: roastTextContent,
          playerName: lastPlacePlayer.name,
          generatedAt: FB.serverTimestamp(),
        });

        setRoastLoading(false);
        runTypewriter(roastTextContent);
      } else {
        // Non-host: listen for roast text from DB
        const unsubRoast = FB.onValue(`rooms/${roomCode}/roast`, (roastData) => {
          if (roastData && roastData.text) {
            setRoastLoading(false);
            runTypewriter(roastData.text);
            unsubRoast();
            FB.off(`rooms/${roomCode}/roast`);
          }
        });
      }
    } catch (err) {
      console.error(err);
      setRoastLoading(false);
      setRoastText(`${lastPlacePlayer.name} performed so badly that even the AI roast generator crashed.`);
    }
  };

  /**
   * Call the server-side /api/roast Route Handler instead of Groq directly.
   * The API key never leaves the server.
   */
  const callRoastAPI = async (
    targetName: string,
    questions: string[],
    guesses: string[]
  ): Promise<string> => {
    try {
      const response = await fetch("/api/roast", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ targetName, questions, guesses }),
      });

      if (!response.ok) throw new Error("Roast API request failed");
      const data = await response.json();
      return data.roastText;
    } catch (error) {
      console.error("Roast API call error:", error);
      return `${targetName} asked questions so bad even AI refused to roast them. That's worse.`;
    }
  };

  const runTypewriter = (text: string) => {
    let charIndex = 0;
    setRoastText("");

    if (typewriterIntervalRef.current) clearInterval(typewriterIntervalRef.current);

    typewriterIntervalRef.current = setInterval(() => {
      if (charIndex < text.length) {
        setRoastText((prev) => prev + text.charAt(charIndex));
        charIndex++;
      } else {
        clearInterval(typewriterIntervalRef.current!);
        typewriterIntervalRef.current = null;
      }
    }, 30);
  };

  const handlePlayAgain = async () => {
    if (!isHost) return;
    setIsResetting(true);

    try {
      // Clear game data
      await FB.remove(`rooms/${roomCode}/hotSeat`);
      await FB.remove(`rooms/${roomCode}/questions`);
      await FB.remove(`rooms/${roomCode}/guesses`);
      await FB.remove(`rooms/${roomCode}/chat`);
      await FB.remove(`rooms/${roomCode}/roast`);

      // Reset players scores/streaks/readiness
      const playerIds = Object.keys(players);
      const resetPromises = playerIds.map((pid) =>
        FB.update(`rooms/${roomCode}/players/${pid}`, {
          score: 0,
          isReady: false,
          guessChancesLeft: 3,
          streak: 0,
        })
      );
      await Promise.all(resetPromises);

      // Reset meta
      await FB.update(`rooms/${roomCode}/meta`, {
        status: "lobby",
        currentRound: 0,
        currentHotSeatIndex: 0,
        hotSeatOrder: [],
      });

      navigatingRef.current = true;
      router.push(`/lobby?code=${roomCode}`);
    } catch (err: any) {
      showBanner(`Reset room failed: ${err.message}`, "error");
      setIsResetting(false);
    }
  };

  const handleLeaveRoom = async () => {
    setIsLeaving(true);
    try {
      await FB.remove(`rooms/${roomCode}/players/${playerId}`);

      const remainingSnap = await FB.get(`rooms/${roomCode}/players`);
      if (!remainingSnap || Object.keys(remainingSnap).length === 0) {
        await FB.remove(`rooms/${roomCode}`);
      } else if (isHost) {
        const nextHostId = Object.keys(remainingSnap)[0];
        await FB.update(`rooms/${roomCode}/meta`, { hostId: nextHostId });
      }

      sessionStorage.clear();
      FB.detachAll();
      navigatingRef.current = true;
      router.push("/");
    } catch (err: any) {
      showBanner(`Leave room failed: ${err.message}`, "error");
      setIsLeaving(false);
    }
  };

  const handleSoundToggle = () => {
    const newState = SFX.toggleSound();
    setSoundOn(newState);
  };

  // Compile final standing scoreboard (reversed for animation: worst→best)
  const sortedLeaderboard = Object.entries(players)
    .map(([id, p]) => ({
      id,
      name: p.name || "Unknown",
      score: p.score || 0,
    }))
    .sort((a, b) => b.score - a.score);

  const winner = sortedLeaderboard[0] || null;

  // Reversed for staggered reveal: worst first, winner last
  const reversedLeaderboard = [...sortedLeaderboard].reverse();

  // Animated leaderboard reveal effect
  useEffect(() => {
    if (reversedLeaderboard.length === 0 || leaderboardAnimatedRef.current) return;
    leaderboardAnimatedRef.current = true;

    const total = reversedLeaderboard.length;
    for (let i = 0; i < total; i++) {
      setTimeout(() => {
        setRevealedCount(i + 1);

        // When the winner (last card) is revealed
        if (i === total - 1) {
          SFX.playCorrect();
          Utils.confetti(5000);
        } else {
          SFX.playPop();
        }
      }, (i + 1) * 600);
    }
  }, [reversedLeaderboard.length]);

  return (
    <div className="page-container">
      <button onClick={handleSoundToggle} className="sound-toggle" aria-label="Toggle sound">
        {soundOn ? "🔊" : "🔇"}
      </button>

      <div className={`banner ${banner.type ? `banner--${banner.type}` : "banner--hidden"}`}>
        {banner.message}
      </div>

      <h1 className="title-xl text-center glitch-text" data-text="Game Over!" style={{ marginTop: "1rem" }}>
        Game Over!
      </h1>

      {winner && (
        <div className="section text-center" style={{ margin: "1rem 0" }}>
          <h2 className="title-sm text-accent-blue">🏆 Winner 🏆</h2>
          <p className="title-lg text-accent-pink" style={{ fontSize: "2.2rem", fontWeight: "bold" }}>
            {winner.name}
          </p>
          <p className="text-body text-muted">{winner.score} pts</p>
        </div>
      )}

      {/* Animated Standings list */}
      <div className="section" style={{ marginBottom: "1.5rem" }}>
        <h2 className="title-sm">Final Standings</h2>
        <div className="leaderboard">
          {reversedLeaderboard.map((player, index) => {
            const actualRank = sortedLeaderboard.findIndex((p) => p.id === player.id) + 1;
            const isSelf = player.id === playerId;
            const isRevealed = index < revealedCount;
            const isWinner = actualRank === 1;

            if (!isRevealed) return null;

            return (
              <div
                key={player.id}
                className={`leaderboard-item ${isSelf ? "leaderboard-item--you" : ""} ${isWinner ? "leaderboard-item--winner" : ""} leaderboard-item--animate`}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "0.75rem 1rem",
                  margin: "0.5rem 0",
                  background: isWinner
                    ? "linear-gradient(135deg, rgba(236, 72, 153, 0.15), rgba(59, 130, 246, 0.15))"
                    : isSelf
                    ? "rgba(59, 130, 246, 0.1)"
                    : "rgba(255,255,255,0.03)",
                  border: isWinner
                    ? "2px solid var(--accent-pink)"
                    : isSelf
                    ? "2px solid var(--accent-blue)"
                    : "1px solid rgba(255,255,255,0.05)",
                  borderRadius: "8px",
                  animationDelay: "0s",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                  <span style={{ fontSize: "1.25rem", fontWeight: "bold", width: "32px", textAlign: "center" }}>
                    {actualRank === 1 ? "🥇" : actualRank === 2 ? "🥈" : actualRank === 3 ? "🥉" : `#${actualRank}`}
                  </span>
                  <span>
                    {player.name} {isSelf && " (You)"}
                  </span>
                </div>
                <span style={{ fontWeight: "bold", color: isWinner ? "var(--accent-pink)" : "var(--accent-blue)" }}>
                  {player.score} pts
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Roast section */}
      <div className="section" style={{ marginBottom: "1.5rem" }}>
        <h2 className="title-md text-accent-pink">The Roast 🔥</h2>
        <p className="text-sm text-muted" style={{ margin: "-4px 0 12px 0" }}>
          Roasting: {roastTargetName || "..."}
        </p>

        {roastLoading ? (
          <div className="flex-center" style={{ padding: "1.5rem" }}>
            <div className="loading-spinner"></div>
          </div>
        ) : (
          <div
            className="roast-card"
            style={{
              border: "2px solid var(--accent-pink)",
              borderRadius: "12px",
              padding: "1.25rem",
              background: "rgba(236, 72, 153, 0.05)",
              boxShadow: "var(--shadow-glow-pink)",
              position: "relative",
            }}
          >
            <div
              className="roast-card__label"
              style={{
                position: "absolute",
                top: "-10px",
                left: "16px",
                background: "var(--bg-primary)",
                padding: "0 8px",
                fontSize: "0.7rem",
                color: "var(--accent-pink)",
                letterSpacing: "1px",
                fontWeight: "bold",
              }}
            >
              AI GENERATED ROAST
            </div>
            <div className="roast-card__text typewriter" style={{ fontSize: "1.05rem", minHeight: "60px" }}>
              {roastText}
            </div>
          </div>
        )}
      </div>

      {/* Actions buttons */}
      <div className="section flex-col gap-md">
        {isHost ? (
          <button
            onClick={handlePlayAgain}
            className="btn btn--pink btn--full btn--lg"
            disabled={isResetting}
          >
            {isResetting ? "Resetting..." : "Play Again"}
          </button>
        ) : (
          <button className="btn btn--ghost btn--full" disabled>
            Waiting for host...
          </button>
        )}
        <button
          onClick={handleLeaveRoom}
          className="btn btn--ghost btn--full"
          disabled={isLeaving}
        >
          {isLeaving ? "Leaving..." : "Leave Room"}
        </button>
      </div>
    </div>
  );
}
