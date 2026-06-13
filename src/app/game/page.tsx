"use client";

import { useEffect, useState, useRef } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Suspense } from "react";
import { FB, initAuth } from "@/lib/firebase";
import { SFX } from "@/lib/audio";
import { Utils } from "@/lib/utils";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { useBanner } from "@/hooks/useBanner";
import { PlayerInfo, RoomMeta, HotSeatData, QuestionData, GuessData, FeedItem, SpectatorInfo } from "@/types/game";



interface ScorePopup {
  id: string;
  amount: string;
  x: number;
  y: number;
}

const CIRCUMFERENCE = 2 * Math.PI * 54; // ≈ 339.292

export default function GamePage() {
  return (
    <Suspense fallback={<div className="page-container--full flex-center">Loading...</div>}>
      <ErrorBoundary>
        <GameContent />
      </ErrorBoundary>
    </Suspense>
  );
}

function GameContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const roomCode = (searchParams.get("code") || "").toUpperCase();

  const [playerId, setPlayerId] = useState("");
  const [playerName, setPlayerName] = useState("");
  const [isHost, setIsHost] = useState(false);
  const [soundOn, setSoundOn] = useState(true);

  // Synchronised Game State
  const [meta, setMeta] = useState<RoomMeta | null>(null);
  const [players, setPlayers] = useState<Record<string, PlayerInfo>>({});
  const [hotSeat, setHotSeat] = useState<HotSeatData | null>(null);
  const [questions, setQuestions] = useState<Record<string, QuestionData>>({});
  const [guesses, setGuesses] = useState<Record<string, GuessData>>({});

  // Countdown state
  const [countdownVal, setCountdownVal] = useState<number | null>(null);
  const [countdownText, setCountdownText] = useState("");

  const [flashClass, setFlashClass] = useState("");
  const [isEvaluatingGuess, setIsEvaluatingGuess] = useState(false);

  // Derived state
  const hotSeatOrder = meta?.hotSeatOrder || [];
  const currentHotSeatIndex = meta?.currentHotSeatIndex ?? 0;
  const hotSeatPid = hotSeatOrder[currentHotSeatIndex] || "";
  const isSelfHotSeat = hotSeatPid === playerId;

  // Score popups state
  const [popups, setPopups] = useState<ScorePopup[]>([]);

  const { banner, showBanner, hideBanner } = useBanner();

  // User input states
  const [personInput, setPersonInput] = useState("");
  const [questionInput, setQuestionInput] = useState("");
  const [guessInput, setGuessInput] = useState("");
  const [showGuessModal, setShowGuessModal] = useState(false);

  // Refs for tracking host updates
  const lastHandledHotSeatIndex = useRef(-1);
  const lastHandledRound = useRef(-1);
  const hotSeatDisconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const feedEndRef = useRef<HTMLDivElement | null>(null);

  // Spectator mode
  const [isSpectator, setIsSpectator] = useState(false);
  const [spectators, setSpectators] = useState<Record<string, SpectatorInfo>>({});

  // Voice input
  const [isRecording, setIsRecording] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(false);
  const recognitionRef = useRef<any>(null);



  const flashScreen = (color: "green" | "red") => {
    setFlashClass(`flash-${color}`);
    setTimeout(() => setFlashClass(""), 500);
  };

  const showScorePopup = (amount: string, x: number, y: number) => {
    const id = Utils.generateId();
    setPopups((prev) => [...prev, { id, amount, x, y }]);
    setTimeout(() => {
      setPopups((prev) => prev.filter((p) => p.id !== id));
    }, 1000);
  };

  // Setup sound & user identities
  useEffect(() => {
    SFX.init();
    setSoundOn(SFX.isSoundOn());

    const pName = sessionStorage.getItem("playerName");

    if (!pName || !roomCode) {
      router.push("/");
      return;
    }

    // Check spectator status
    const spectatorFlag = sessionStorage.getItem("isSpectator") === "true";
    setIsSpectator(spectatorFlag);

    // Detect Web Speech API
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
      setSpeechSupported(true);
      const recognition = new SpeechRecognition();
      recognition.continuous = false;
      recognition.interimResults = false;
      recognition.lang = "en-US";
      recognition.onresult = (event: any) => {
        const transcript = event.results[0][0].transcript;
        setQuestionInput((prev) => prev + transcript);
      };
      recognition.onend = () => setIsRecording(false);
      recognition.onerror = () => setIsRecording(false);
      recognitionRef.current = recognition;
    }

    let cancelled = false;
    const cleanupRef = { current: () => {} };

    (async () => {
      try {
        const uid = await initAuth();
        if (cancelled) return;

        setPlayerId(uid);
        setPlayerName(pName);

        // Initialise player presence
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

        // Attach listeners
        const unsubMeta = FB.onValue(`rooms/${roomCode}/meta`, (data: RoomMeta) => {
          if (!data) {
            showBanner("Room was closed.", "warning");
            sessionStorage.clear();
            setTimeout(() => router.push("/"), 1500);
            return;
          }
          setMeta(data);
          const host = data.hostId === uid;
          setIsHost(host);
          sessionStorage.setItem("isHost", host ? "true" : "false");

          if (data.status === "chat") {
            router.push(`/chat?code=${roomCode}`);
          } else if (data.status === "ended") {
            router.push(`/roast?code=${roomCode}`);
          } else if (data.status === "lobby") {
            router.push(`/lobby?code=${roomCode}`);
          }
        });

        const unsubPlayers = FB.onValue(`rooms/${roomCode}/players`, (data) => {
          if (!data) return;
          setPlayers(data);
        });

        const unsubHotSeat = FB.onValue(`rooms/${roomCode}/hotSeat`, (data) => {
          if (!data) return;
          setHotSeat(data);
        });

        const unsubQuestions = FB.onValue(`rooms/${roomCode}/questions`, (data) => {
          setQuestions(data || {});
        });

        const unsubGuesses = FB.onValue(`rooms/${roomCode}/guesses`, (data) => {
          setGuesses(data || {});
        });

        const unsubSpectators = FB.onValue(`rooms/${roomCode}/spectators`, (data) => {
          setSpectators(data || {});
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
          unsubHotSeat();
          unsubQuestions();
          unsubGuesses();
          unsubSpectators();
          FB.off(`rooms/${roomCode}/meta`);
          FB.off(`rooms/${roomCode}/players`);
          FB.off(`rooms/${roomCode}/hotSeat`);
          FB.off(`rooms/${roomCode}/questions`);
          FB.off(`rooms/${roomCode}/guesses`);
          FB.off(`rooms/${roomCode}/spectators`);
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

  // Host-driven hot seat lifecycle initialisation
  useEffect(() => {
    if (!meta || !isHost) return;

    const hotIdx = meta.currentHotSeatIndex ?? 0;
    const curRound = meta.currentRound ?? 1;

    if (hotIdx !== lastHandledHotSeatIndex.current || curRound !== lastHandledRound.current) {
      lastHandledHotSeatIndex.current = hotIdx;
      lastHandledRound.current = curRound;

      const playerIds = Object.keys(players);
      const updates: Record<string, number> = {};
      playerIds.forEach((pid) => {
        updates[`${pid}/guessChancesLeft`] = 3;
      });

      if (playerIds.length > 0) {
        FB.update(`rooms/${roomCode}/players`, updates);
      }

      FB.set(`rooms/${roomCode}/hotSeat`, {
        currentPersonHash: "",
        phase: "entering",
        timerEnd: 0,
      });

      FB.remove(`rooms/${roomCode}/questions`);
      FB.remove(`rooms/${roomCode}/guesses`);
    }
  }, [meta?.currentHotSeatIndex, meta?.currentRound, isHost, roomCode, players]);

  // AI Guess Validation Effect
  useEffect(() => {
    // Identify unverified guesses
    const unverified = Object.keys(guesses)
      .map((k) => ({ id: k, ...guesses[k] }))
      .filter((g) => g.isCorrect === null || g.isCorrect === undefined)
      .sort((a, b) => a.timestamp - b.timestamp);

    const guessToVerify = unverified[0] || null;

    // Only the hot seat player runs the validation to prevent duplicate API calls
    // and maintain authority over the score updates.
    if (guessToVerify && hotSeat && isSelfHotSeat && !isEvaluatingGuess) {
      setIsEvaluatingGuess(true);

      (async () => {
        try {
          const actualSecretPerson = sessionStorage.getItem("personName") || "";
          
          const res = await fetch("/api/validate-guess", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              guess: guessToVerify.guess,
              secretPerson: actualSecretPerson,
            }),
          });
          
          let isCorrect = false;
          if (res.ok) {
            const data = await res.json();
            isCorrect = data.isCorrect ?? false;
          } else {
            console.error("AI validation failed with status", res.status);
          }

          // Call the existing verify function with the result
          await handleVerifyGuess(isCorrect, guessToVerify);
        } catch (err) {
          console.error("Failed to validate guess via AI", err);
          await handleVerifyGuess(false, guessToVerify);
        } finally {
          setIsEvaluatingGuess(false);
        }
      })();
    }
  }, [guesses, hotSeat, isSelfHotSeat, isEvaluatingGuess]);

  // Reveal secret person on timeout for hot seat player
  useEffect(() => {
    if (isSelfHotSeat && hotSeat?.phase === "timeout" && !hotSeat.secretPerson) {
      const p = sessionStorage.getItem("personName");
      if (p) {
        FB.update(`rooms/${roomCode}/hotSeat`, { secretPerson: p });
      }
    }
  }, [isSelfHotSeat, hotSeat?.phase, hotSeat?.secretPerson, roomCode]);

  // Countdown timer trigger
  useEffect(() => {
    if (!meta) return;
    const hotSeatOrder = meta.hotSeatOrder || [];
    const hotIdx = meta.currentHotSeatIndex ?? 0;
    const hotSeatPid = hotSeatOrder[hotIdx];
    const isSelfHotSeat = hotSeatPid === playerId;

    if (!isSelfHotSeat && hotSeatPid) {
      const hotSeatPlayerName = players[hotSeatPid]?.name || "Player";
      setCountdownVal(3);
      setCountdownText("");

      let count = 3;
      const interval = setInterval(() => {
        count--;
        if (count > 0) {
          setCountdownVal(count);
        } else if (count === 0) {
          setCountdownVal(null);
          setCountdownText(`${hotSeatPlayerName} is thinking of a person...`);
        } else {
          clearInterval(interval);
        }
      }, 1000);

      return () => clearInterval(interval);
    } else {
      setCountdownVal(null);
      setCountdownText("");
    }
  }, [meta?.currentHotSeatIndex, meta?.currentRound, playerId, players]);


  // Hot seat disconnected monitoring
  useEffect(() => {
    if (!isHost || !meta || !roomCode) return;

    const hotSeatOrder = meta.hotSeatOrder || [];
    const hotIdx = meta.currentHotSeatIndex ?? 0;
    const hotSeatPid = hotSeatOrder[hotIdx];
    if (!hotSeatPid) return;

    const hotSeatPlayer = players[hotSeatPid];
    const isOnline = hotSeatPlayer?.isOnline ?? true;

    if (!isOnline) {
      hotSeatDisconnectTimeoutRef.current = setTimeout(async () => {
        const stillOnline = await FB.get(`rooms/${roomCode}/players/${hotSeatPid}/isOnline`);
        if (!stillOnline) {
          showBanner("Hot seat player disconnected. Skipping turn...", "warning");
          setTimeout(() => {
            moveToNextHotSeat();
          }, 2000);
        }
      }, 15000);
    } else {
      if (hotSeatDisconnectTimeoutRef.current) {
        clearTimeout(hotSeatDisconnectTimeoutRef.current);
        hotSeatDisconnectTimeoutRef.current = null;
      }
    }

    return () => {
      if (hotSeatDisconnectTimeoutRef.current) {
        clearTimeout(hotSeatDisconnectTimeoutRef.current);
      }
    };
  }, [meta?.currentHotSeatIndex, players, isHost, roomCode]);

  // Scroll feed to bottom when questions or guesses update
  useEffect(() => {
    if (feedEndRef.current) {
      feedEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [questions, guesses]);

  // Host watch for phase changes to automatically start next round
  useEffect(() => {
    if (!isHost || !hotSeat?.phase) return;

    if (hotSeat.phase === "guessed") {
      const timer = setTimeout(() => {
        moveToNextHotSeat();
      }, 1500);
      return () => clearTimeout(timer);
    }
  }, [isHost, hotSeat?.phase]);

  const handleTimeout = async () => {
    if (!isHost || !roomCode || !meta || hotSeat?.phase !== "questioning") return;

    try {
      await FB.update(`rooms/${roomCode}/hotSeat`, { phase: "timeout" });

      const hotSeatOrder = meta.hotSeatOrder || [];
      const hotIdx = meta.currentHotSeatIndex ?? 0;
      const hotSeatPid = hotSeatOrder[hotIdx] || "";

      const playerIds = Object.keys(players);
      const updates: Record<string, number> = {};

      playerIds.forEach((pid) => {
        const player = players[pid];
        const currentScore = player.score || 0;
        if (pid === hotSeatPid) {
          updates[`${pid}/score`] = currentScore + 2;
        } else {
          updates[`${pid}/score`] = currentScore - 1;
        }
      });

      if (playerIds.length > 0) {
        await FB.update(`rooms/${roomCode}/players`, updates);
      }

      setTimeout(() => {
        moveToNextHotSeat();
      }, 3000);
    } catch (err) {
      console.error(err);
    }
  };

  const handlePersonSubmit = async () => {
    const cleanPerson = Utils.sanitize(personInput.trim(), 60);
    if (!cleanPerson) {
      showBanner("Please enter a person's name.", "error");
      return;
    }

    sessionStorage.setItem("personName", cleanPerson);

    try {
      const hash = await Utils.hashString(cleanPerson);
      await FB.update(`rooms/${roomCode}/hotSeat`, {
        currentPersonHash: hash,
        phase: "questioning",
        timerEnd: FB.getServerTime() + (meta?.timerMinutes || 3) * 60 * 1000,
      });
      setPersonInput("");
      hideBanner();
    } catch (err: any) {
      showBanner(`Error locking name: ${err.message}`, "error");
    }
  };

  const handleSendQuestion = () => {
    const cleanText = Utils.sanitize(questionInput.trim(), 200);
    if (!cleanText) return;

    FB.push(`rooms/${roomCode}/questions`, {
      askerId: playerId,
      askerName: playerName,
      text: cleanText,
      answer: "pending",
      timestamp: FB.serverTimestamp(),
    });

    setQuestionInput("");
    SFX.playPop();
  };

  const handleAnswerQuestion = async (answer: "YES" | "NO" | "MAYBE") => {
    if (!pendingQuestionId) return;

    try {
      await FB.update(`rooms/${roomCode}/questions/${pendingQuestionId}`, {
        answer,
      });

      if (answer === "MAYBE") {
        const hotSeatOrder = meta?.hotSeatOrder || [];
        const hotIdx = meta?.currentHotSeatIndex ?? 0;
        const hotSeatPid = hotSeatOrder[hotIdx] || "";
        const hotPlayer = players[hotSeatPid];
        if (hotPlayer) {
          const newScore = Math.round(((hotPlayer.score || 0) - 0.3) * 10) / 10;
          await FB.update(`rooms/${roomCode}/players/${hotSeatPid}`, {
            score: newScore,
          });
          showScorePopup("-0.3", window.innerWidth / 2, window.innerHeight / 2);
        }
      }
      SFX.playPop();
    } catch (err) {
      console.error(err);
    }
  };

  const handleSendGuess = () => {
    const cleanGuess = Utils.sanitize(guessInput.trim(), 60);
    if (!cleanGuess) return;

    FB.push(`rooms/${roomCode}/guesses`, {
      guesserId: playerId,
      guesserName: playerName,
      guess: cleanGuess,
      isCorrect: null,
      timestamp: FB.serverTimestamp(),
    });

    setGuessInput("");
    setShowGuessModal(false);
    SFX.playPop();
  };

  const handleVerifyGuess = async (isCorrect: boolean, guessItem: GuessData & { id: string }) => {
    if (!guessItem) return;
    const guessKey = guessItem.id;
    const guesserId = guessItem.guesserId!;

    try {
      if (isCorrect) {
        // Correct guess scoring
        await FB.update(`rooms/${roomCode}/guesses/${guessKey}`, { isCorrect: true });
        
        const actualSecretPerson = sessionStorage.getItem("personName") || "";
        await FB.update(`rooms/${roomCode}/hotSeat`, { 
          phase: "guessed", 
          secretPerson: actualSecretPerson 
        });

        const guesser = players[guesserId];
        const guesserStreak = guesser?.streak || 0;
        const guesserScore = guesser?.score || 0;
        const points = guesserStreak >= 2 ? 5 : 3;

        // guseer update
        await FB.update(`rooms/${roomCode}/players/${guesserId}`, {
          score: guesserScore + points,
          streak: guesserStreak + 1,
        });

        // hot seat update
        const hotSeatOrder = meta?.hotSeatOrder || [];
        const hotIdx = meta?.currentHotSeatIndex ?? 0;
        const hotSeatPid = hotSeatOrder[hotIdx] || "";
        const hotPlayer = players[hotSeatPid];
        if (hotPlayer) {
          await FB.update(`rooms/${roomCode}/players/${hotSeatPid}`, {
            score: (hotPlayer.score || 0) + 1,
          });
        }

        // Reset others streaks
        const streakUpdates: Record<string, number> = {};
        Object.keys(players).forEach((id) => {
          if (id !== guesserId) {
            streakUpdates[`${id}/streak`] = 0;
          }
        });
        if (Object.keys(streakUpdates).length > 0) {
          await FB.update(`rooms/${roomCode}/players`, streakUpdates);
        }

        SFX.playCorrect();
        Utils.confetti(1500);
        flashScreen("green");
        showScorePopup(`+${points}`, window.innerWidth / 2, window.innerHeight / 3);

      } else {
        // Wrong guess chances deduction
        await FB.update(`rooms/${roomCode}/guesses/${guessKey}`, { isCorrect: false });

        const guesser = players[guesserId];
        const chances = guesser?.guessChancesLeft ?? 3;
        await FB.update(`rooms/${roomCode}/players/${guesserId}`, {
          guessChancesLeft: Math.max(0, chances - 1),
        });

        SFX.playWrong();
        flashScreen("red");
      }
    } catch (err) {
      console.error(err);
    }
  };

  const moveToNextHotSeat = async () => {
    if (!isHost || !meta) return;

    const hotSeatOrder = meta.hotSeatOrder || [];
    const hotIdx = meta.currentHotSeatIndex ?? 0;
    const curRound = meta.currentRound ?? 1;
    const totalRounds = meta.rounds || 3;

    const nextIdx = hotIdx + 1;
    const turnsPerRound = Math.ceil(hotSeatOrder.length / totalRounds) || 3;
    const isRoundComplete = nextIdx % turnsPerRound === 0;

    if (isRoundComplete || nextIdx >= hotSeatOrder.length) {
      if (curRound < totalRounds) {
        await FB.update(`rooms/${roomCode}/meta`, {
          status: "chat",
          currentHotSeatIndex: nextIdx,
        });
      } else {
        await FB.update(`rooms/${roomCode}/meta`, { status: "ended" });
      }
    } else {
      await FB.update(`rooms/${roomCode}/hotSeat`, { phase: "waiting" });
      await FB.remove(`rooms/${roomCode}/questions`);
      await FB.remove(`rooms/${roomCode}/guesses`);
      await FB.update(`rooms/${roomCode}/meta`, {
        currentHotSeatIndex: nextIdx,
      });
    }
  };

  const handleSoundToggle = () => {
    const newState = SFX.toggleSound();
    setSoundOn(newState);
  };

  const startVoiceInput = () => {
    if (!recognitionRef.current || isRecording) return;
    setIsRecording(true);
    recognitionRef.current.start();
  };

  const stopVoiceInput = () => {
    if (!recognitionRef.current || !isRecording) return;
    recognitionRef.current.stop();
    setIsRecording(false);
  };

  // Compile combined chronological feed
  const combinedFeed: FeedItem[] = [];
  Object.entries(questions).forEach(([id, q]) => {
    combinedFeed.push({
      id,
      type: "question",
      timestamp: q.timestamp || 0,
      askerId: q.askerId,
      askerName: q.askerName,
      text: q.text,
      answer: q.answer,
    });
  });
  Object.entries(guesses).forEach(([id, g]) => {
    combinedFeed.push({
      id,
      type: "guess",
      timestamp: g.timestamp || 0,
      guesserId: g.guesserId,
      guesserName: g.guesserName,
      guess: g.guess,
      isCorrect: g.isCorrect,
    });
  });
  combinedFeed.sort((a, b) => a.timestamp - b.timestamp);

  // Identify active pending question (first question with "pending" answer status)
  const pendingQuestion = combinedFeed.find(
    (item) => item.type === "question" && item.answer === "pending"
  );
  const pendingQuestionId = pendingQuestion?.id || null;

  // Identify current hot seat details (derived state moved to top)
  const hotSeatPlayerName = players[hotSeatPid]?.name || "Player";

  // Identify guesses waiting to be verified by hot seat player
  const unverifiedGuesses = combinedFeed.filter(
    (item) => item.type === "guess" && (item.isCorrect === null || item.isCorrect === undefined)
  );
  const currentGuessToVerify = unverifiedGuesses[0] || null;

  // Format countdown state
  const showCountdownOverlay =
    hotSeat?.phase === "entering" && !isSelfHotSeat && (countdownVal !== null || countdownText);

  // My chances left
  const myPlayer = players[playerId];
  const guessChancesLeft = myPlayer?.guessChancesLeft ?? 3;

  return (
    <div className={`page-container--full ${flashClass}`} style={{ paddingBottom: "120px" }}>
      <button onClick={handleSoundToggle} className="sound-toggle" aria-label="Toggle sound">
        {soundOn ? "🔊" : "🔇"}
      </button>

      <div className={`banner ${banner.type ? `banner--${banner.type}` : "banner--hidden"}`}>
        {banner.message}
      </div>

      {/* Countdown overlay */}
      {showCountdownOverlay && (
        <div className="countdown-overlay">
          {countdownVal !== null ? (
            <div className="countdown-number shake">{countdownVal}</div>
          ) : (
            <div className="countdown-text">{countdownText}</div>
          )}
        </div>
      )}

      {/* Score Popups */}
      {popups.map((p) => (
        <div
          key={p.id}
          className={`score-popup ${
            parseFloat(p.amount) > 0 ? "score-popup--positive" : "score-popup--negative"
          }`}
          style={{ left: p.x, top: p.y }}
        >
          {parseFloat(p.amount) > 0 ? `+${p.amount}` : p.amount}
        </div>
      ))}

      {/* TOP SECTION: Game Info Bar */}
      <div className="flex-between game-info-bar" style={{ flexWrap: "wrap", gap: "8px", padding: "0 1rem" }}>
        <span className="title-sm">
          Round {meta?.currentRound || 1}/{meta?.rounds || 3}
        </span>
        <span className="badge badge--pink">{hotSeatPlayerName}&apos;s turn</span>
        {meta?.category && meta.category !== "Free for all" && (
          <span className="badge badge--green" style={{ fontSize: "0.7rem" }}>{meta.category}</span>
        )}
        {isSpectator && (
          <span className="badge badge--blue" style={{ fontSize: "0.7rem" }}>SPECTATING</span>
        )}
      </div>

      {/* TIMER SECTION */}
      <div className="flex-center timer-section">
        {hotSeat?.phase === "questioning" ? (
          <ActiveTimer 
            timerEndMs={hotSeat.timerEnd || 0}
            timerTotalMs={(meta?.timerMinutes || 3) * 60 * 1000}
            onTimeout={handleTimeout}
          />
        ) : (
          <div className="timer-container" style={{ opacity: 0.5 }}>
            <svg className="timer-svg" viewBox="0 0 120 120">
              <circle className="timer-circle-bg" cx="60" cy="60" r="54" />
            </svg>
            <div className="timer-text">--:--</div>
          </div>
        )}
      </div>

      {/* RULES REMINDER */}
      <div className="card" style={{ margin: "0 1rem" }}>
        <p className="text-sm text-muted text-center">
          Ask YES/NO/MAYBE questions only. No name-letter questions.
        </p>
        <p className="text-xs text-muted text-center">
          Examples: Is this person alive? / Is this person an actor?
        </p>
      </div>

      {/* QUESTION FEED */}
      <div id="feedSection" style={{ flex: 1, overflowY: "auto", padding: "1rem" }}>
        <div className="feed-container">
          {combinedFeed.map((item) => {
            if (item.type === "question") {
              const isPending = item.id === pendingQuestionId;
              return (
                <div
                  key={item.id}
                  className={`feed-item ${
                    item.answer !== "pending"
                      ? `feed-item--answered-${item.answer?.toLowerCase()}`
                      : ""
                  } ${isPending ? "flash-green" : ""}`}
                >
                  <span className="feed-item__asker">{item.askerName}</span>
                  <span className="feed-item__text">{item.text}</span>
                  <span className="feed-item__answer">{item.answer}</span>
                </div>
              );
            } else {
              return (
                <div
                  key={item.id}
                  className={`feed-item feed-item--guess ${
                    item.isCorrect ? "feed-item--guess-correct" : ""
                  }`}
                >
                  <span className="feed-item__asker">{item.guesserName}</span>
                  <span className="feed-item__text">guesses: {item.guess}</span>
                  <span className="feed-item__answer">
                    {item.isCorrect === true
                      ? "✓ CORRECT!"
                      : item.isCorrect === false
                      ? "✗ Wrong"
                      : "..."}
                  </span>
                </div>
              );
            }
          })}
          <div ref={feedEndRef} />
        </div>
      </div>

      {/* PLAYER SCOREBOARD */}
      <div className="section" style={{ padding: "0 1rem 1rem 1rem" }}>
        <div className="player-list">
          {Object.keys(players).map((pid) => {
            const p = players[pid];
            const isHot = pid === hotSeatPid;
            const isSelf = pid === playerId;
            return (
              <div
                key={pid}
                className={`player-item ${isHot ? "player-item--hot-seat" : ""} ${
                  isSelf ? "player-item--you" : ""
                }`}
              >
                <span className="player-name">
                  {p.name.length > 12 ? `${p.name.substring(0, 12)}…` : p.name}{" "}
                  {isSelf && " (You)"}
                </span>
                <span className="player-score">{p.score}</span>
                {p.streak >= 2 && <span className="player-streak">🔥</span>}

                {!isHot && (
                  <span className="guess-chances">
                    {[0, 1, 2].map((c) => (
                      <span
                        key={c}
                        className={`guess-chance ${c >= p.guessChancesLeft ? "guess-chance--used" : ""}`}
                      />
                    ))}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Spectators Watching Section */}
      {Object.keys(spectators).length > 0 && (
        <div className="section" style={{ padding: "0 1rem 0.5rem 1rem" }}>
          <div className="flex-between" style={{ marginBottom: "0.25rem" }}>
            <span className="text-xs text-muted">👁️ Watching</span>
            <span className="text-xs text-muted">{Object.keys(spectators).length}</span>
          </div>
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            {Object.entries(spectators).map(([id, s]) => (
              <span key={id} className="badge badge--blue" style={{ fontSize: "0.7rem", opacity: 0.7 }}>
                {s.name}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* HOT SEAT ENTERING VIEW */}
      {hotSeat?.phase === "entering" && isSelfHotSeat && !isSpectator && (
        <div className="modal-overlay">
          <div className="modal">
            <h2 className="modal__title">You are in the hot seat!</h2>
            <p className="text-body text-center text-muted">
              Think of a person. Enter their name below. Only you can see this.
            </p>
            {meta?.category && meta.category !== "Free for all" && (
              <p className="text-sm text-center text-accent-green" style={{ margin: "0.5rem 0" }}>
                Category: <strong>{meta.category}</strong>
              </p>
            )}
            <div className="input-group">
              <input
                className="input-field"
                type="text"
                placeholder="Enter person name"
                maxLength={60}
                autoComplete="off"
                value={personInput}
                onChange={(e) => setPersonInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handlePersonSubmit()}
              />
            </div>
            <button className="btn btn--pink btn--full" onClick={handlePersonSubmit}>
              Lock It In
            </button>
          </div>
        </div>
      )}

      {/* HOT SEAT ANSWER BOTTOM BAR */}
      {hotSeat?.phase === "questioning" && isSelfHotSeat && !isSpectator && (
        <div className="bottom-bar bottom-bar--answer">
          <div
            className={`text-sm text-center ${
              pendingQuestionId ? "text-accent-green" : "text-muted"
            }`}
            style={{ fontWeight: 500 }}
          >
            {pendingQuestionId
              ? "Answer the active question (highlighted in green):"
              : "Waiting for players to ask questions..."}
          </div>
          <div
            className="flex-center gap-sm"
            style={{ display: "flex", width: "100%", justifyContent: "center", gap: "8px" }}
          >
            <button
              onClick={() => handleAnswerQuestion("YES")}
              className="btn btn--green"
              style={{ flex: 1, minWidth: "80px" }}
              disabled={!pendingQuestionId}
            >
              YES
            </button>
            <button
              onClick={() => handleAnswerQuestion("NO")}
              className="btn btn--danger"
              style={{ flex: 1, minWidth: "80px" }}
              disabled={!pendingQuestionId}
            >
              NO
            </button>
            <button
              onClick={() => handleAnswerQuestion("MAYBE")}
              className="btn btn--ghost"
              style={{ flex: 1, minWidth: "120px" }}
              disabled={!pendingQuestionId}
            >
              MAYBE (-0.3)
            </button>
          </div>
        </div>
      )}

      {/* QUESTIONER BOTTOM BAR */}
      {hotSeat?.phase === "questioning" && !isSelfHotSeat && !isSpectator && (
        <div className="bottom-bar bottom-bar--question">
          <div style={{ display: "flex", flex: 1, gap: "0.25rem", alignItems: "center" }}>
            <input
              className="input-field"
              type="text"
              placeholder="Ask a yes/no question..."
              autoComplete="off"
              value={questionInput}
              onChange={(e) => setQuestionInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSendQuestion()}
              style={{ flex: 1 }}
            />
            {speechSupported && (
              <button
                className={`btn btn--ghost btn--sm mic-btn ${isRecording ? "mic-btn--recording" : ""}`}
                onMouseDown={startVoiceInput}
                onMouseUp={stopVoiceInput}
                onTouchStart={startVoiceInput}
                onTouchEnd={stopVoiceInput}
                aria-label="Voice input"
                title="Hold to speak"
              >
                🎤
              </button>
            )}
          </div>
          <button className="btn btn--primary" onClick={handleSendQuestion}>
            →
          </button>
          <button
            className="btn btn--pink"
            onClick={() => {
              if (guessChancesLeft <= 0) {
                showBanner("No guess chances left this round!", "error");
                return;
              }
              setShowGuessModal(true);
            }}
          >
            GUESS
          </button>
        </div>
      )}

      {/* GUESS MODAL */}
      {showGuessModal && (
        <div className="modal-overlay">
          <div className="modal">
            <h2 className="modal__title">Make Your Guess</h2>
            <div className="guess-chances">
              {[0, 1, 2].map((c) => (
                <span
                  key={c}
                  className={`guess-chance ${c >= guessChancesLeft ? "guess-chance--used" : ""}`}
                />
              ))}
            </div>
            {guessChancesLeft === 1 && (
              <p className="text-xs text-center text-accent-red" style={{ margin: "-5px 0 10px 0" }}>
                ⚠ Last guess chance!
              </p>
            )}
            <div className="input-group">
              <input
                className="input-field"
                type="text"
                placeholder="Who do you think it is?"
                maxLength={60}
                autoComplete="off"
                value={guessInput}
                onChange={(e) => setGuessInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSendGuess()}
              />
            </div>
            <button className="btn btn--pink btn--full" onClick={handleSendGuess}>
              Submit Guess
            </button>
            <button className="btn btn--ghost btn--full" onClick={() => setShowGuessModal(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* HOT SEAT GUESS EVALUATING MODAL */}
      {isEvaluatingGuess && currentGuessToVerify && (
        <div className="modal-overlay">
          <div className="modal">
            <h2 className="modal__title text-center">{currentGuessToVerify.guesserName} guesses:</h2>
            <p className="title-lg text-center" style={{ margin: "1rem 0" }}>
              {currentGuessToVerify.guess}
            </p>
            <div className="flex-col flex-center gap-sm">
              <div className="loading-spinner"></div>
              <p className="text-accent-pink glitch-text text-sm mt-4" data-text="AI is evaluating...">
                AI is evaluating...
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ROUND END REVEAL MODAL */}
      {(hotSeat?.phase === "guessed" || hotSeat?.phase === "timeout") && (
        <div className="modal-overlay">
          <div className="modal" style={{ border: hotSeat.phase === "guessed" ? "2px solid var(--accent-green)" : "2px solid var(--accent-red)" }}>
            <h2 className="modal__title text-center text-muted">
              {hotSeat.phase === "guessed" ? "WE HAVE A WINNER!" : "TIME IS UP!"}
            </h2>
            <div className="text-center mt-4">
              <p className="text-sm text-secondary uppercase tracking-widest mb-2">The Secret Person was:</p>
              <p className="title-xl text-accent-blue" style={{ fontSize: "2.5rem" }}>
                {hotSeat.secretPerson || "..."}
              </p>
            </div>
            {isHost && (
              <p className="text-xs text-center text-muted" style={{ marginTop: "24px" }}>
                Starting next round automatically...
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ActiveTimer({
  timerEndMs,
  timerTotalMs,
  onTimeout,
}: {
  timerEndMs: number;
  timerTotalMs: number;
  onTimeout: () => void;
}) {
  const [remainingTime, setRemainingTime] = useState(0);
  const [timerOffset, setTimerOffset] = useState(0);

  useEffect(() => {
    if (timerEndMs <= 0) {
      setRemainingTime(0);
      setTimerOffset(0);
      return;
    }

    let rafId: number;
    let lastTick = -1;

    const tick = () => {
      const now = FB.getServerTime();
      const remaining = Math.max(0, timerEndMs - now);
      setRemainingTime(remaining);

      const elapsed = timerTotalMs - remaining;
      const fraction = timerTotalMs > 0 ? elapsed / timerTotalMs : 1;
      const offset = Math.min(CIRCUMFERENCE, Math.max(0, CIRCUMFERENCE * (1 - fraction)));
      setTimerOffset(offset);

      if (remaining < 30000 && remaining > 0) {
        const currentSecond = Math.ceil(remaining / 1000);
        if (currentSecond !== lastTick) {
          lastTick = currentSecond;
          SFX.playTick();
        }
      }

      if (remaining <= 0) {
        onTimeout();
      } else {
        rafId = requestAnimationFrame(tick);
      }
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [timerEndMs, timerTotalMs, onTimeout]);

  return (
    <div className="timer-container">
      <svg className="timer-svg" viewBox="0 0 120 120">
        <circle className="timer-circle-bg" cx="60" cy="60" r="54" />
        <circle
          className={`timer-circle-fg ${
            remainingTime < 30000 && remainingTime > 0 ? "timer-circle-fg--warning" : ""
          }`}
          cx="60"
          cy="60"
          r="54"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={timerOffset}
        />
      </svg>
      <div className="timer-text">{Utils.formatTime(remainingTime)}</div>
    </div>
  );
}
