/* roast.js — Groq API roast card generation, final leaderboard, play again / leave logic. Owns: roast page UI, AI integration, game reset, room cleanup. Does NOT own: game logic, room creation, lobby, chat. */

const GROQ_API_KEY = 'YOUR_API_KEY_HERE';
const GROQ_MODEL = 'llama-3.3-70b-versatile';

document.addEventListener('DOMContentLoaded', () => {
  'use strict';

  /* ───── Init ───── */
  window.FB.init();
  window.SFX.init();

  if (!window.Router.requireState('playerId', 'playerName', 'roomCode')) return;

  const playerId = window.Router.getState('playerId');
  const playerName = window.Router.getState('playerName');
  const roomCode = window.Router.getState('roomCode');
  const isHost = window.Router.getState('isHost') === 'true';

  /* ───── DOM refs ───── */
  const gameOverTitle = document.getElementById('gameOverTitle');
  const winnerName = document.getElementById('winnerName');
  const winnerScore = document.getElementById('winnerScore');
  const finalLeaderboardList = document.getElementById('finalLeaderboardList');
  const roastTarget = document.getElementById('roastTarget');
  const roastCard = document.getElementById('roastCard');
  const roastText = document.getElementById('roastText');
  const roastLoading = document.getElementById('roastLoading');
  const btnPlayAgain = document.getElementById('btnPlayAgain');
  const btnLeave = document.getElementById('btnLeave');
  const soundToggle = document.getElementById('soundToggle');
  const statusBanner = document.getElementById('statusBanner');

  /* ───── State ───── */
  let metaListenerPath = null;
  let navigating = false;
  let typewriterInterval = null;

  /* ───── Banner functions ───── */
  function showBanner(msg) {
    statusBanner.textContent = msg;
    statusBanner.classList.remove('banner--hidden');
    statusBanner.classList.add('banner--warning');
  }

  function hideBanner() {
    statusBanner.classList.add('banner--hidden');
    statusBanner.classList.remove('banner--warning');
  }

  /* ───── Sound toggle ───── */
  soundToggle.textContent = window.SFX.isSoundOn() ? '🔊' : '🔇';
  soundToggle.addEventListener('click', () => {
    window.SFX.toggleSound();
    soundToggle.textContent = window.SFX.isSoundOn() ? '🔊' : '🔇';
  });

  /* ───── Connection / Disconnect & Monitoring ───── */
  const playerPath = `rooms/${roomCode}/players/${playerId}`;
  
  window.FB.onValue('.info/connected', (connected) => {
    if (connected === true || connected === 'true') {
      hideBanner();

      const disconnectRef = window.FB.onDisconnect(playerPath);
      if (disconnectRef && disconnectRef.update) {
        disconnectRef.update({
          isOnline: false,
          lastSeen: window.FB.serverTimestamp()
        });
      }

      window.FB.update(playerPath, {
        isOnline: true,
        lastSeen: window.FB.serverTimestamp()
      });
    } else {
      showBanner('Reconnecting…');
    }
  });

  /* ═══════════════════════════════════════════
     1. CONFETTI
     ═══════════════════════════════════════════ */
  window.Utils.confetti(5000);

  /* ═══════════════════════════════════════════
     2. LEADERBOARD & WINNER
     ═══════════════════════════════════════════ */
  let lastPlacePlayer = null;

  async function loadLeaderboardAndWinner() {
    try {
      const players = await window.FB.get(`rooms/${roomCode}/players`);
      if (!players) return;

      const sorted = Object.entries(players)
        .map(([id, p]) => ({ id, name: p.name || 'Unknown', score: p.score || 0 }))
        .sort((a, b) => b.score - a.score);

      /* Winner */
      const winner = sorted[0];
      winnerName.textContent = winner.name;
      winnerScore.textContent = `${winner.score} pts`;

      /* Last place */
      lastPlacePlayer = sorted[sorted.length - 1];
      roastTarget.textContent = `Roasting: ${lastPlacePlayer.name}`;

      /* Render full leaderboard */
      finalLeaderboardList.innerHTML = '';

      sorted.forEach((player, index) => {
        const rank = index + 1;
        const item = document.createElement('div');
        item.className = 'leaderboard-item';
        if (player.id === playerId) {
          item.classList.add('leaderboard-item--you');
        }

        let rankClass = 'leaderboard-rank';
        if (rank === 1) rankClass += ' leaderboard-rank--1';
        else if (rank === 2) rankClass += ' leaderboard-rank--2';
        else if (rank === 3) rankClass += ' leaderboard-rank--3';

        const rankEl = document.createElement('span');
        rankEl.className = rankClass;
        rankEl.textContent = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `#${rank}`;

        const nameEl = document.createElement('span');
        nameEl.className = 'leaderboard-name';
        nameEl.textContent = player.name;
        if (player.id === playerId) {
          nameEl.textContent += ' (You)';
        }

        const scoreEl = document.createElement('span');
        scoreEl.className = 'leaderboard-score';
        scoreEl.textContent = `${player.score} pts`;

        item.appendChild(rankEl);
        item.appendChild(nameEl);
        item.appendChild(scoreEl);
        finalLeaderboardList.appendChild(item);
      });

      /* Now load the roast */
      await loadOrGenerateRoast();
    } catch (err) {
      console.error('Failed to load leaderboard:', err);
    }
  }

  /* ═══════════════════════════════════════════
     3. ROAST GENERATION
     ═══════════════════════════════════════════ */
  async function generateRoast(roastPlayerName, questions, guesses) {
    try {
      const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${GROQ_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: GROQ_MODEL,
          messages: [
            {
              role: 'system',
              content: 'You are a savage comedian who writes extremely dark, brutal roast jokes. No mercy. Dark humor only. Be creative and specific. Max 3 sentences.'
            },
            {
              role: 'user',
              content: `Roast this player based on their terrible performance:\nPlayer name: ${roastPlayerName}\nQuestions they asked: ${questions.join(', ') || 'None - they were too scared to even ask'}\nGuesses they made: ${guesses.join(', ') || 'None - they had no clue'}\nThey came LAST PLACE in the game.\nWrite the darkest most brutal roast of this player based specifically on how dumb their questions and guesses were. Reference their actual questions and guesses in the roast. Make it hurt.`
            }
          ],
          temperature: 0.9,
          max_tokens: 256
        })
      });

      if (!response.ok) throw new Error('API failed');
      const data = await response.json();
      return data.choices[0].message.content;
    } catch (error) {
      console.error('Groq API error:', error);
      return `${roastPlayerName} asked questions so bad even AI refused to roast them. That's worse.`;
    }
  }

  async function loadOrGenerateRoast() {
    if (!lastPlacePlayer) return;

    /* Show loading */
    roastLoading.classList.remove('hidden');
    roastCard.classList.add('hidden');

    try {
      /* Check if roast already exists */
      const existingRoast = await window.FB.get(`rooms/${roomCode}/roast`);

      if (existingRoast && existingRoast.text) {
        /* Roast already generated by another client */
        roastLoading.classList.add('hidden');
        roastCard.classList.remove('hidden');
        displayRoastTypewriter(existingRoast.text);
        return;
      }

      if (isHost) {
        /* Only host generates the roast to avoid duplicates */
        const questions = [];
        const guesses = [];

        /* Fetch questions asked by last place player */
        try {
          const allQuestions = await window.FB.get(`rooms/${roomCode}/questions`);
          if (allQuestions) {
            Object.values(allQuestions).forEach((q) => {
              if (q.askerId === lastPlacePlayer.id && q.text) {
                questions.push(q.text);
              }
            });
          }
        } catch (err) {
          console.error('Failed to fetch questions:', err);
        }

        /* Fetch guesses made by last place player */
        try {
          const allGuesses = await window.FB.get(`rooms/${roomCode}/guesses`);
          if (allGuesses) {
            Object.values(allGuesses).forEach((g) => {
              if (g.guesserId === lastPlacePlayer.id && g.guess) {
                guesses.push(g.guess);
              }
            });
          }
        } catch (err) {
          console.error('Failed to fetch guesses:', err);
        }

        /* Generate roast via Groq */
        const roastContent = await generateRoast(lastPlacePlayer.name, questions, guesses);

        /* Save to Firebase */
        await window.FB.set(`rooms/${roomCode}/roast`, {
          text: roastContent,
          playerName: lastPlacePlayer.name,
          generatedAt: window.FB.serverTimestamp()
        });

        /* Display */
        roastLoading.classList.add('hidden');
        roastCard.classList.remove('hidden');
        displayRoastTypewriter(roastContent);
      } else {
        /* Non-host: wait for roast to appear in Firebase */
        window.FB.onValue(`rooms/${roomCode}/roast`, (roastData) => {
          if (roastData && roastData.text) {
            roastLoading.classList.add('hidden');
            roastCard.classList.remove('hidden');
            displayRoastTypewriter(roastData.text);
            /* Stop listening once we have the roast */
            window.FB.off(`rooms/${roomCode}/roast`);
          }
        });
      }
    } catch (err) {
      console.error('Roast generation error:', err);
      roastLoading.classList.add('hidden');
      roastCard.classList.remove('hidden');
      roastText.textContent = `${lastPlacePlayer.name} played so badly that even the roast generator gave up.`;
    }
  }

  /* ═══════════════════════════════════════════
     4. TYPEWRITER EFFECT
     ═══════════════════════════════════════════ */
  function displayRoastTypewriter(text) {
    roastText.textContent = '';
    roastText.classList.add('typewriter');

    let charIndex = 0;

    typewriterInterval = setInterval(() => {
      if (charIndex < text.length) {
        roastText.textContent += text.charAt(charIndex);
        charIndex++;
      } else {
        clearInterval(typewriterInterval);
        typewriterInterval = null;
        /* Remove blinking cursor after completion */
        roastText.classList.remove('typewriter');
      }
    }, 30);
  }

  /* ═══════════════════════════════════════════
     5. PLAY AGAIN (Host only)
     ═══════════════════════════════════════════ */
  if (!isHost) {
    btnPlayAgain.textContent = 'Waiting for host...';
    btnPlayAgain.disabled = true;
    btnPlayAgain.classList.add('btn--ghost');
    btnPlayAgain.classList.remove('btn--pink');
  }

  btnPlayAgain.addEventListener('click', async () => {
    if (!isHost) return;

    btnPlayAgain.disabled = true;
    btnPlayAgain.textContent = 'Resetting...';

    try {
      /* Delete game data */
      await window.FB.remove(`rooms/${roomCode}/hotSeat`);
      await window.FB.remove(`rooms/${roomCode}/questions`);
      await window.FB.remove(`rooms/${roomCode}/guesses`);
      await window.FB.remove(`rooms/${roomCode}/chat`);
      await window.FB.remove(`rooms/${roomCode}/roast`);

      /* Reset all players */
      const players = await window.FB.get(`rooms/${roomCode}/players`);
      if (players) {
        const resetPromises = Object.keys(players).map((pid) =>
          window.FB.update(`rooms/${roomCode}/players/${pid}`, {
            score: 0,
            isReady: false,
            guessChancesLeft: 3,
            streak: 0
          })
        );
        await Promise.all(resetPromises);
      }

      /* Reset meta */
      await window.FB.update(`rooms/${roomCode}/meta`, {
        status: 'lobby',
        currentRound: 0,
        currentHotSeatIndex: 0,
        hotSeatOrder: []
      });

      /* Navigate */
      navigating = true;
      cleanup();
      window.Router.navigateTo('lobby.html');
    } catch (err) {
      console.error('Play again error:', err);
      btnPlayAgain.disabled = false;
      btnPlayAgain.textContent = 'Play Again';
    }
  });

  /* ═══════════════════════════════════════════
     6. LEAVE ROOM
     ═══════════════════════════════════════════ */
  btnLeave.addEventListener('click', async () => {
    btnLeave.disabled = true;
    btnLeave.textContent = 'Leaving...';

    try {
      /* Remove current player */
      await window.FB.remove(`rooms/${roomCode}/players/${playerId}`);

      /* Check remaining players */
      const remainingPlayers = await window.FB.get(`rooms/${roomCode}/players`);

      if (!remainingPlayers || Object.keys(remainingPlayers).length === 0) {
        /* No players left — delete entire room */
        await window.FB.remove(`rooms/${roomCode}`);
      } else if (isHost) {
        /* Transfer host to next player */
        const nextHostId = Object.keys(remainingPlayers)[0];
        await window.FB.update(`rooms/${roomCode}/meta`, {
          hostId: nextHostId
        });
      }

      /* Clear session */
      sessionStorage.removeItem('playerId');
      sessionStorage.removeItem('playerName');
      sessionStorage.removeItem('roomCode');
      sessionStorage.removeItem('isHost');
      sessionStorage.removeItem('personName');

      /* Navigate to home */
      navigating = true;
      cleanup();
      window.Router.navigateTo('index.html');
    } catch (err) {
      console.error('Leave room error:', err);
      btnLeave.disabled = false;
      btnLeave.textContent = 'Leave Room';
    }
  });

  /* ═══════════════════════════════════════════
     7. NON-HOST META LISTENER
     ═══════════════════════════════════════════ */
  if (!isHost) {
    metaListenerPath = `rooms/${roomCode}/meta`;

    window.FB.onValue(metaListenerPath, (meta) => {
      if (!meta || navigating) return;

      if (meta.status === 'lobby') {
        navigating = true;
        cleanup();
        window.Router.navigateTo('lobby.html');
      }
    });
  }

  /* ═══════════════════════════════════════════
     CLEANUP
     ═══════════════════════════════════════════ */
  function cleanup() {
    if (typewriterInterval) {
      clearInterval(typewriterInterval);
      typewriterInterval = null;
    }
    window.FB.detachAll();
  }

  window.addEventListener('beforeunload', cleanup);

  /* ───── Kick off ───── */
  loadLeaderboardAndWinner();
});
