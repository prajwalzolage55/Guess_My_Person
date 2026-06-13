/* chat.js — Between-round chat and leaderboard display. Owns: chat page UI, real-time chat messages, round transition. Does NOT own: game logic, room creation, roast. */

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
  const roundCompleteTitle = document.getElementById('roundCompleteTitle');
  const chatCountdown = document.getElementById('chatCountdown');
  const leaderboardList = document.getElementById('leaderboardList');
  const chatFeed = document.getElementById('chatFeed');
  const chatInput = document.getElementById('chatInput');
  const btnSendChat = document.getElementById('btnSendChat');
  const soundToggle = document.getElementById('soundToggle');
  const statusBanner = document.getElementById('statusBanner');

  /* ───── State ───── */
  let countdownSeconds = 30;
  let countdownInterval = null;
  let metaListenerPath = null;
  let chatListenerPath = null;
  let navigating = false;

  /* ───── Sound toggle ───── */
  soundToggle.textContent = window.SFX.isSoundOn() ? '🔊' : '🔇';
  soundToggle.addEventListener('click', () => {
    window.SFX.toggleSound();
    soundToggle.textContent = window.SFX.isSoundOn() ? '🔊' : '🔇';
  });

  /* ───── Connection / Disconnect & Monitoring ───── */
  const playerPath = `rooms/${roomCode}/players/${playerId}`;
  
  function hideBanner() {
    statusBanner.classList.add('banner--hidden');
    statusBanner.classList.remove('banner--warning');
  }

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

  /* ───── Fetch current round for title ───── */
  (async function setTitle() {
    try {
      const meta = await window.FB.get(`rooms/${roomCode}/meta`);
      if (meta && meta.currentRound) {
        roundCompleteTitle.textContent = `Round ${meta.currentRound} Complete!`;
      }
    } catch (err) {
      console.error('Failed to fetch meta for title:', err);
    }
  })();

  /* ═══════════════════════════════════════════
     1. LEADERBOARD
     ═══════════════════════════════════════════ */
  async function loadLeaderboard() {
    try {
      const players = await window.FB.get(`rooms/${roomCode}/players`);
      if (!players) return;

      const sorted = Object.entries(players)
        .map(([id, p]) => ({ id, name: p.name || 'Unknown', score: p.score || 0 }))
        .sort((a, b) => b.score - a.score);

      leaderboardList.innerHTML = '';

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
        leaderboardList.appendChild(item);
      });
    } catch (err) {
      console.error('Failed to load leaderboard:', err);
    }
  }

  loadLeaderboard();

  /* ═══════════════════════════════════════════
     2. CHAT
     ═══════════════════════════════════════════ */
  chatListenerPath = `rooms/${roomCode}/chat`;

  window.FB.onChildAdded(chatListenerPath, (message) => {
    if (!message) return;

    const msgDiv = document.createElement('div');
    msgDiv.className = 'chat-message';

    const nameSpan = document.createElement('span');
    nameSpan.className = 'chat-message__name';
    nameSpan.textContent = message.playerName || 'Unknown';

    const textSpan = document.createElement('span');
    textSpan.className = 'chat-message__text';
    textSpan.textContent = message.text || '';

    msgDiv.appendChild(nameSpan);
    msgDiv.appendChild(textSpan);
    chatFeed.appendChild(msgDiv);

    /* Auto-scroll to bottom */
    chatFeed.scrollTop = chatFeed.scrollHeight;

    /* Sound */
    window.SFX.playPop();
  });

  /* Throttled send */
  const throttledSend = window.Utils.throttle(sendChatMessage, 500);

  function sendChatMessage() {
    const raw = chatInput.value.trim();
    if (!raw) return;

    const text = window.Utils.sanitize(raw, 200);
    if (!text) return;

    window.FB.push(`rooms/${roomCode}/chat`, {
      playerId: playerId,
      playerName: playerName,
      text: text,
      timestamp: window.FB.serverTimestamp()
    });

    chatInput.value = '';
    chatInput.focus();
  }

  btnSendChat.addEventListener('click', () => {
    throttledSend();
  });

  chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      throttledSend();
    }
  });

  /* ═══════════════════════════════════════════
     3. COUNTDOWN
     ═══════════════════════════════════════════ */
  function updateCountdownDisplay() {
    chatCountdown.textContent = `Next round in: ${countdownSeconds}s`;
  }

  updateCountdownDisplay();

  countdownInterval = setInterval(() => {
    countdownSeconds--;
    if (countdownSeconds < 0) countdownSeconds = 0;
    updateCountdownDisplay();

    if (countdownSeconds <= 0) {
      clearInterval(countdownInterval);
      countdownInterval = null;
      onCountdownEnd();
    }
  }, 1000);

  async function onCountdownEnd() {
    if (navigating) return;

    if (isHost) {
      try {
        const meta = await window.FB.get(`rooms/${roomCode}/meta`);
        if (!meta) return;

        const currentRound = meta.currentRound || 1;
        const totalRounds = meta.rounds || 3;

        if (currentRound < totalRounds) {
          /* More rounds to play */
          const players = await window.FB.get(`rooms/${roomCode}/players`);
          const playerIds = players ? Object.keys(players) : [];

          /* Reset player guess chances for next round */
          const playerUpdates = {};
          playerIds.forEach((pid) => {
            playerUpdates[`${pid}/guessChancesLeft`] = 3;
            playerUpdates[`${pid}/streak`] = 0;
          });

          /* Batch update players */
          if (Object.keys(playerUpdates).length > 0) {
            await window.FB.update(`rooms/${roomCode}/players`, playerUpdates);
          }

          /* Clear round-specific data */
          await window.FB.remove(`rooms/${roomCode}/questions`);
          await window.FB.remove(`rooms/${roomCode}/guesses`);
          await window.FB.remove(`rooms/${roomCode}/chat`);

          /* Update meta for next round */
          await window.FB.update(`rooms/${roomCode}/meta`, {
            currentRound: currentRound + 1,
            status: 'playing'
          });
        } else {
          /* All rounds done */
          await window.FB.update(`rooms/${roomCode}/meta`, {
            status: 'ended'
          });
        }
      } catch (err) {
        console.error('Host countdown end error:', err);
        showBanner('Error transitioning round. Please refresh.');
      }
    }
    /* Non-host: do nothing here, meta listener handles navigation */
  }

  /* ═══════════════════════════════════════════
     4. META LISTENER
     ═══════════════════════════════════════════ */
  metaListenerPath = `rooms/${roomCode}/meta`;

  window.FB.onValue(metaListenerPath, (meta) => {
    if (!meta || navigating) return;

    if (meta.status === 'playing') {
      navigating = true;
      cleanup();
      window.Router.navigateTo('game.html');
    } else if (meta.status === 'ended') {
      navigating = true;
      cleanup();
      window.Router.navigateTo('roast.html');
    }
  });

  /* ═══════════════════════════════════════════
     5. STATUS BANNER
     ═══════════════════════════════════════════ */
  function showBanner(msg) {
    statusBanner.textContent = msg;
    statusBanner.classList.remove('banner--hidden');
    statusBanner.classList.add('banner--warning');
  }

  /* ═══════════════════════════════════════════
     CLEANUP
     ═══════════════════════════════════════════ */
  function cleanup() {
    if (countdownInterval) {
      clearInterval(countdownInterval);
      countdownInterval = null;
    }
    window.FB.detachAll();
  }

  window.addEventListener('beforeunload', cleanup);
});
