/* lobby.js — Lobby logic: ready states, player list rendering, host controls,
   kick functionality.
   Owns: lobby page UI and interactions.
   Does NOT own: room creation, game logic, Firebase init. */

(function () {
  'use strict';

  /* ── DOM refs ─────────────────────────────────────────────── */
  const $soundToggle      = document.getElementById('soundToggle');
  const $statusBanner     = document.getElementById('statusBanner');
  const $roomCodeDisplay  = document.getElementById('roomCodeDisplay');
  const $roomCodeText     = document.getElementById('roomCodeText');
  const $roomName         = document.getElementById('roomName');
  const $settingRounds    = document.getElementById('settingRounds');
  const $settingTimer     = document.getElementById('settingTimer');
  const $settingType      = document.getElementById('settingType');
  const $playerCount      = document.getElementById('playerCount');
  const $playerList       = document.getElementById('playerList');
  const $hostControls     = document.getElementById('hostControls');
  const $playerControls   = document.getElementById('playerControls');
  const $btnStartGame     = document.getElementById('btnStartGame');
  const $btnReady         = document.getElementById('btnReady');
  const $btnLeave         = document.getElementById('btnLeave');

  /* ── State ────────────────────────────────────────────────── */
  let playerId    = null;
  let playerName  = null;
  let roomCode    = null;
  let isHost      = false;
  let hostId      = null;
  let currentMeta = null;
  let players     = {};    // { id: { name, score, isReady, isOnline, … } }
  let myReady     = false;
  let listenersAttached = false;

  // ─── Global Error Logging for Screen Feedback ──────────────────
  window.addEventListener('error', function (e) {
    if (typeof showBanner === 'function') {
      showBanner('Runtime Error: ' + e.message, 'error');
    }
  });
  window.addEventListener('unhandledrejection', function (e) {
    if (typeof showBanner === 'function') {
      var msg = e.reason && e.reason.message ? e.reason.message : e.reason;
      showBanner('Database Error: ' + msg, 'error');
    }
  });

  /* ── Helpers ──────────────────────────────────────────────── */

  function showBanner(msg, type) {
    $statusBanner.textContent = msg;
    $statusBanner.className = 'banner';
    if (type === 'error')   $statusBanner.classList.add('banner--error');
    if (type === 'warning') $statusBanner.classList.add('banner--warning');
    if (type === 'success') $statusBanner.classList.add('banner--success');
    setTimeout(function () {
      $statusBanner.classList.add('banner--hidden');
    }, 3000);
  }

  function hideBanner() {
    $statusBanner.classList.add('banner--hidden');
  }

  function updateSoundIcon() {
    $soundToggle.textContent = SFX.isSoundOn() ? '🔊' : '🔇';
  }

  /* ── Render settings ──────────────────────────────────────── */

  function renderSettings(meta) {
    if (!meta) return;
    $roomName.textContent = meta.roomName || '';
    $settingRounds.textContent = meta.rounds + (meta.rounds === 1 ? ' round' : ' rounds');
    $settingTimer.textContent  = meta.timerMinutes + ' min';
    $settingType.textContent   = meta.isOpen ? 'Open' : 'Private';
  }

  /* ── Render player list ───────────────────────────────────── */

  function renderPlayers() {
    $playerList.innerHTML = '';

    var ids = Object.keys(players);
    var onlineCount = 0;

    ids.forEach(function (id) {
      var p = players[id];
      if (p.isOnline) onlineCount++;

      var item = document.createElement('div');
      item.className = 'player-item';
      if (p.isReady) item.classList.add('player-item--ready');
      if (id === playerId) item.classList.add('player-item--you');

      /* Player name */
      var nameSpan = document.createElement('span');
      nameSpan.className = 'player-name';
      nameSpan.textContent = p.name + (id === playerId ? ' (You)' : '');
      item.appendChild(nameSpan);

      /* Badges container */
      var badgeWrap = document.createElement('div');
      badgeWrap.className = 'flex-center gap-sm';

      /* Host badge */
      if (id === hostId) {
        var hostBadge = document.createElement('span');
        hostBadge.className = 'badge badge--pink';
        hostBadge.textContent = 'HOST';
        badgeWrap.appendChild(hostBadge);
      }

      /* Ready badge */
      if (p.isReady) {
        var readyBadge = document.createElement('span');
        readyBadge.className = 'badge badge--green';
        readyBadge.textContent = 'READY';
        badgeWrap.appendChild(readyBadge);
      }

      /* Offline badge */
      if (!p.isOnline) {
        var offBadge = document.createElement('span');
        offBadge.className = 'badge badge--red';
        offBadge.textContent = 'OFFLINE';
        badgeWrap.appendChild(offBadge);
      }

      /* Kick button (host only, not self) */
      if (isHost && id !== playerId) {
        var kickBtn = document.createElement('button');
        kickBtn.className = 'btn btn--danger btn--sm';
        kickBtn.textContent = '✕';
        kickBtn.setAttribute('aria-label', 'Kick ' + p.name);
        kickBtn.addEventListener('click', function (e) {
          e.stopPropagation();
          kickPlayer(id);
        });
        badgeWrap.appendChild(kickBtn);
      }

      item.appendChild(badgeWrap);
      $playerList.appendChild(item);
    });

    $playerCount.textContent = onlineCount + '/' + ids.length + ' online';

    /* Start-game enablement: need >= 2 online players */
    if (isHost) {
      $btnStartGame.disabled = onlineCount < 2;
    }
  }

  /* ── Room code copy ───────────────────────────────────────── */

  $roomCodeDisplay.addEventListener('click', function () {
    Utils.copyToClipboard(roomCode);
    showBanner('Room code copied!', 'success');
    SFX.playPop();
  });

  /* ── Sound toggle ─────────────────────────────────────────── */

  $soundToggle.addEventListener('click', function () {
    SFX.toggleSound();
    updateSoundIcon();
  });

  /* ── Ready toggle ─────────────────────────────────────────── */

  $btnReady.addEventListener('click', function () {
    myReady = !myReady;
    FB.update('rooms/' + roomCode + '/players/' + playerId, {
      isReady: myReady
    });
    $btnReady.textContent = myReady ? 'Not Ready' : 'Ready';
    $btnReady.className = myReady
      ? 'btn btn--secondary btn--full'
      : 'btn btn--primary btn--full';
    SFX.playPop();
  });

  /* ── Start game (host only) ───────────────────────────────── */

  $btnStartGame.addEventListener('click', async function () {
    if (!isHost) return;

    $btnStartGame.disabled = true;
    $btnStartGame.textContent = 'Starting…';

    try {
      var onlineIds = [];
      var allIds = Object.keys(players);
      allIds.forEach(function (id) {
        if (players[id].isOnline) onlineIds.push(id);
      });

      /* Generate hot-seat order */
      var hotSeatOrder = Utils.buildHotSeatOrder(onlineIds, currentMeta.rounds);

      /* Reset all players' isReady */
      var readyUpdates = {};
      allIds.forEach(function (id) {
        readyUpdates[id + '/isReady'] = false;
      });

      await FB.update('rooms/' + roomCode + '/players', readyUpdates);

      /* Update meta to start the game */
      await FB.update('rooms/' + roomCode + '/meta', {
        status: 'playing',
        currentRound: 1,
        currentHotSeatIndex: 0,
        hotSeatOrder: hotSeatOrder
      });

    } catch (err) {
      showBanner('Error starting game: ' + err.message, 'error');
      $btnStartGame.disabled = false;
      $btnStartGame.textContent = 'Start Game';
    }
  });

  /* ── Kick player ──────────────────────────────────────────── */

  function kickPlayer(targetId) {
    if (!isHost || targetId === playerId) return;
    FB.remove('rooms/' + roomCode + '/players/' + targetId);
    SFX.playPop();
  }

  /* ── Leave room ───────────────────────────────────────────── */

  $btnLeave.addEventListener('click', async function () {
    try {
      /* Remove self from players */
      await FB.remove('rooms/' + roomCode + '/players/' + playerId);

      if (isHost) {
        /* Check if other players exist */
        var snap = await FB.get('rooms/' + roomCode + '/players');
        if (snap && Object.keys(snap).length > 0) {
          /* Transfer host to the first remaining player */
          var newHostId = Object.keys(snap)[0];
          await FB.update('rooms/' + roomCode + '/meta', {
            hostId: newHostId
          });
        } else {
          /* No players left — delete the entire room */
          await FB.remove('rooms/' + roomCode);
        }
      }
    } catch (err) {
      /* Best-effort cleanup */
    }

    detachAllListeners();
    sessionStorage.removeItem('playerId');
    sessionStorage.removeItem('playerName');
    sessionStorage.removeItem('roomCode');
    sessionStorage.removeItem('isHost');
    sessionStorage.removeItem('personName');
    Router.navigateTo('index.html');
  });

  /* ── Real-time listeners ──────────────────────────────────── */

  function attachListeners() {
    if (listenersAttached) return;
    listenersAttached = true;

    /* Meta listener */
    FB.onValue('rooms/' + roomCode + '/meta', function (data) {
      if (!data) {
        /* Room has been deleted */
        showBanner('Room was closed.', 'warning');
        detachAllListeners();
        sessionStorage.clear();
        Router.navigateTo('index.html');
        return;
      }

      currentMeta = data;
      hostId = data.hostId;
      isHost = (hostId === playerId);

      /* Update session isHost in case of host transfer */
      sessionStorage.setItem('isHost', isHost ? 'true' : 'false');

      renderSettings(data);
      updateControls();

      /* Navigate to game if status changed */
      if (data.status === 'playing') {
        detachAllListeners();
        Router.navigateTo('game.html');
        return;
      }
    });

    /* Players listener */
    FB.onValue('rooms/' + roomCode + '/players', function (data) {
      if (!data) {
        players = {};
      } else {
        players = data;
      }

      /* Check if current player was kicked */
      if (!players[playerId]) {
        detachAllListeners();
        showBanner('You have been removed from the room.', 'warning');
        sessionStorage.clear();
        setTimeout(function () {
          Router.navigateTo('index.html');
        }, 1500);
        return;
      }

      /* Sync local ready state */
      myReady = players[playerId].isReady;
      $btnReady.textContent = myReady ? 'Not Ready' : 'Ready';
      $btnReady.className = myReady
        ? 'btn btn--secondary btn--full'
        : 'btn btn--primary btn--full';

      renderPlayers();

      /* Check if ALL players are offline → clean up room */
      var allOffline = true;
      Object.keys(players).forEach(function (id) {
        if (players[id].isOnline) allOffline = false;
      });
      if (allOffline && Object.keys(players).length > 0) {
        FB.remove('rooms/' + roomCode);
      }
    });

    /* Connection monitoring */
    FB.onValue('.info/connected', function (connected) {
      if (connected === true || connected === 'true') {
        hideBanner();

        /* Re-establish onDisconnect */
        var disconnectRef = FB.onDisconnect('rooms/' + roomCode + '/players/' + playerId);
        if (disconnectRef) {
          disconnectRef.update({
            isOnline: false,
            lastSeen: FB.serverTimestamp()
          });
        }

        /* Mark as online */
        FB.update('rooms/' + roomCode + '/players/' + playerId, {
          isOnline: true,
          lastSeen: FB.serverTimestamp()
        });
      } else {
        showBanner('Reconnecting…', 'warning');
      }
    });
  }

  function detachAllListeners() {
    FB.off('rooms/' + roomCode + '/meta');
    FB.off('rooms/' + roomCode + '/players');
    FB.off('.info/connected');
    listenersAttached = false;
  }

  /* ── Update controls visibility ───────────────────────────── */

  function updateControls() {
    if (isHost) {
      $hostControls.classList.remove('hidden');
      $playerControls.classList.add('hidden');
    } else {
      $hostControls.classList.add('hidden');
      $playerControls.classList.remove('hidden');
    }
  }

  /* ── onDisconnect setup ───────────────────────────────────── */

  function setupOnDisconnect() {
    var disconnectRef = FB.onDisconnect('rooms/' + roomCode + '/players/' + playerId);
    if (disconnectRef) {
      disconnectRef.update({
        isOnline: false,
        lastSeen: FB.serverTimestamp()
      });
    }
  }

  /* ── Cleanup on page unload ───────────────────────────────── */

  window.addEventListener('beforeunload', function () {
    detachAllListeners();
  });

  /* ── Init ─────────────────────────────────────────────────── */

  document.addEventListener('DOMContentLoaded', function () {
    FB.init();
    SFX.init();
    updateSoundIcon();

    /* Guard required session state */
    if (!Router.requireState('playerId', 'playerName', 'roomCode')) {
      return; // requireState navigates away if missing
    }

    playerId   = sessionStorage.getItem('playerId');
    playerName = sessionStorage.getItem('playerName');
    roomCode   = sessionStorage.getItem('roomCode');
    isHost     = sessionStorage.getItem('isHost') === 'true';

    /* Display room code */
    $roomCodeText.textContent = roomCode;

    /* Set initial ready state — host starts ready, non-host starts not-ready */
    myReady = isHost;

    /* Mark self as online */
    FB.update('rooms/' + roomCode + '/players/' + playerId, {
      isOnline: true,
      lastSeen: FB.serverTimestamp()
    });

    /* Set up onDisconnect */
    setupOnDisconnect();

    /* Show correct controls */
    updateControls();

    /* Attach real-time listeners */
    attachListeners();
  });

})();
