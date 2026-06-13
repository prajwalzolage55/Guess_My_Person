/* room.js — Room creation, joining, open room discovery, code generation.
   Owns: landing page logic, room CRUD.
   Does NOT own: lobby, game, chat, roast logic. */

(function () {
  'use strict';

  /* ── DOM refs ─────────────────────────────────────────────── */
  const $soundToggle    = document.getElementById('soundToggle');
  const $statusBanner   = document.getElementById('statusBanner');

  /* Views */
  const $menuView       = document.getElementById('menuView');
  const $openRoomView   = document.getElementById('openRoomView');
  const $createRoomView = document.getElementById('createRoomView');
  const $joinCodeView   = document.getElementById('joinCodeView');
  const views = [$menuView, $openRoomView, $createRoomView, $joinCodeView];

  /* Menu buttons */
  const $btnJoinOpen    = document.getElementById('btnJoinOpen');
  const $btnCreateRoom  = document.getElementById('btnCreateRoom');
  const $btnJoinCode    = document.getElementById('btnJoinCode');

  /* Back buttons */
  const $btnBackFromOpen   = document.getElementById('btnBackFromOpen');
  const $btnBackFromCreate = document.getElementById('btnBackFromCreate');
  const $btnBackFromCode   = document.getElementById('btnBackFromCode');

  /* Open room view */
  const $openRoomName   = document.getElementById('openRoomName');
  const $openRoomList   = document.getElementById('openRoomList');
  const $openRoomSpinner = document.getElementById('openRoomSpinner');
  const $noRoomsMsg     = document.getElementById('noRoomsMsg');
  const $linkCreateFromOpen = document.getElementById('linkCreateFromOpen');

  /* Create room view */
  const $createName     = document.getElementById('createName');
  const $roomNameInput  = document.getElementById('roomNameInput');
  const $optOpen        = document.getElementById('optOpen');
  const $optPrivate     = document.getElementById('optPrivate');
  const $optRound1      = document.getElementById('optRound1');
  const $optRound2      = document.getElementById('optRound2');
  const $optRound3      = document.getElementById('optRound3');
  const $optTimer2      = document.getElementById('optTimer2');
  const $optTimer3      = document.getElementById('optTimer3');
  const $optTimer4      = document.getElementById('optTimer4');
  const $btnCreate      = document.getElementById('btnCreate');

  /* Join with code view */
  const $codeName       = document.getElementById('codeName');
  const $codeInput      = document.getElementById('codeInput');
  const $btnJoinCode2   = document.getElementById('btnJoinCode2');

  /* ── State ────────────────────────────────────────────────── */
  let playerId       = sessionStorage.getItem('playerId') || Utils.generateId();
  let selectedType   = 'open';   // 'open' | 'private'
  let selectedRounds = 3;
  let selectedTimer  = 3;        // minutes
  let openRoomInterval = null;

  sessionStorage.setItem('playerId', playerId);

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

  /** Show one view, hide all others. */
  function showView(target) {
    views.forEach(function (v) {
      if (v === target) {
        v.classList.remove('hidden');
      } else {
        v.classList.add('hidden');
      }
    });
  }

  /** Display the status banner with a message and optional type. */
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

  /** Hide the status banner immediately. */
  function hideBanner() {
    $statusBanner.classList.add('banner--hidden');
  }

  /** Mark the active option button inside its group. */
  function activateOption(btn) {
    var siblings = btn.parentElement.querySelectorAll('.option-btn');
    siblings.forEach(function (s) { s.classList.remove('option-btn--active'); });
    btn.classList.add('option-btn--active');
  }

  /** Clear the open-room refresh interval. */
  function clearOpenRoomPolling() {
    if (openRoomInterval) {
      clearInterval(openRoomInterval);
      openRoomInterval = null;
    }
  }

  /* ── View switching ───────────────────────────────────────── */

  function goToMenu() {
    clearOpenRoomPolling();
    showView($menuView);
  }

  $btnJoinOpen.addEventListener('click', function () {
    showView($openRoomView);
    loadOpenRooms();
    openRoomInterval = setInterval(loadOpenRooms, 10000);
  });

  $btnCreateRoom.addEventListener('click', function () {
    showView($createRoomView);
  });

  $btnJoinCode.addEventListener('click', function () {
    showView($joinCodeView);
  });

  $btnBackFromOpen.addEventListener('click', goToMenu);
  $btnBackFromCreate.addEventListener('click', goToMenu);
  $btnBackFromCode.addEventListener('click', goToMenu);

  $linkCreateFromOpen.addEventListener('click', function (e) {
    e.preventDefault();
    clearOpenRoomPolling();
    showView($createRoomView);
  });

  /* ── Sound toggle ─────────────────────────────────────────── */

  function updateSoundIcon() {
    $soundToggle.textContent = SFX.isSoundOn() ? '🔊' : '🔇';
  }

  $soundToggle.addEventListener('click', function () {
    SFX.toggleSound();
    updateSoundIcon();
  });

  /* ── Option buttons ───────────────────────────────────────── */

  $optOpen.addEventListener('click', function () { activateOption($optOpen); selectedType = 'open'; });
  $optPrivate.addEventListener('click', function () { activateOption($optPrivate); selectedType = 'private'; });

  $optRound1.addEventListener('click', function () { activateOption($optRound1); selectedRounds = 1; });
  $optRound2.addEventListener('click', function () { activateOption($optRound2); selectedRounds = 2; });
  $optRound3.addEventListener('click', function () { activateOption($optRound3); selectedRounds = 3; });

  $optTimer2.addEventListener('click', function () { activateOption($optTimer2); selectedTimer = 2; });
  $optTimer3.addEventListener('click', function () { activateOption($optTimer3); selectedTimer = 3; });
  $optTimer4.addEventListener('click', function () { activateOption($optTimer4); selectedTimer = 4; });

  /* ── Code input auto-uppercase ────────────────────────────── */

  $codeInput.addEventListener('input', function () {
    $codeInput.value = $codeInput.value.toUpperCase();
  });

  /* ── Open room discovery ──────────────────────────────────── */

  async function loadOpenRooms() {
    $openRoomSpinner.classList.remove('hidden');
    $noRoomsMsg.classList.add('hidden');
    $openRoomList.innerHTML = '';

    try {
      var snapshot = await FB.get('rooms');
      var rooms = snapshot ? snapshot : {};
      var openRooms = [];

      var codes = Object.keys(rooms);
      for (var i = 0; i < codes.length; i++) {
        var code = codes[i];
        var room = rooms[code];
        if (!room || !room.meta) continue;
        if (room.meta.isOpen !== true) continue;
        if (room.meta.status !== 'lobby') continue;

        var playerCount = room.players ? Object.keys(room.players).length : 0;
        if (playerCount >= 8) continue;

        openRooms.push({
          code: code,
          name: room.meta.roomName || 'Unnamed Room',
          playerCount: playerCount,
          timerMinutes: room.meta.timerMinutes || 3,
          rounds: room.meta.rounds || 3
        });
      }

      $openRoomSpinner.classList.add('hidden');

      if (openRooms.length === 0) {
        $noRoomsMsg.classList.remove('hidden');
        return;
      }

      openRooms.forEach(function (r) {
        var item = document.createElement('div');
        item.className = 'room-list-item';
        item.setAttribute('data-code', r.code);

        var nameEl = document.createElement('span');
        nameEl.className = 'room-list-item__name';
        nameEl.textContent = r.name;

        var infoEl = document.createElement('span');
        infoEl.className = 'room-list-item__info';
        infoEl.textContent = r.rounds + ' rounds · ' + r.timerMinutes + ' min';

        var playersEl = document.createElement('span');
        playersEl.className = 'room-list-item__players';
        playersEl.textContent = r.playerCount + '/8';

        item.appendChild(nameEl);
        item.appendChild(infoEl);
        item.appendChild(playersEl);

        item.addEventListener('click', function () {
          handleJoinOpenRoom(r.code);
        });

        $openRoomList.appendChild(item);
      });
    } catch (err) {
      $openRoomSpinner.classList.add('hidden');
      showBanner('Failed to load rooms. Please try again.', 'error');
    }
  }

  function handleJoinOpenRoom(roomCode) {
    var name = Utils.sanitize($openRoomName.value.trim(), 16);
    if (!name) {
      showBanner('Please enter a display name first.', 'error');
      $openRoomName.focus();
      return;
    }
    joinRoom(roomCode, name);
  }

  /* ── Create room ──────────────────────────────────────────── */

  $btnCreate.addEventListener('click', async function () {
    var name = Utils.sanitize($createName.value.trim(), 16);
    var roomName = Utils.sanitize($roomNameInput.value.trim(), 24);

    if (!name) {
      showBanner('Please enter a display name.', 'error');
      $createName.focus();
      return;
    }
    if (!roomName) {
      showBanner('Please enter a room name.', 'error');
      $roomNameInput.focus();
      return;
    }

    $btnCreate.disabled = true;
    $btnCreate.textContent = 'Creating…';

    try {
      var code = null;
      for (var attempt = 0; attempt < 5; attempt++) {
        var candidate = Utils.generateRoomCode();
        var existing = await FB.get('rooms/' + candidate + '/meta');
        if (!existing) {
          code = candidate;
          break;
        }
      }

      if (!code) {
        showBanner('Could not generate a unique room code. Try again.', 'error');
        $btnCreate.disabled = false;
        $btnCreate.textContent = 'Create Room';
        return;
      }

      var isOpen = selectedType === 'open';

      await FB.set('rooms/' + code + '/meta', {
        hostId: playerId,
        roomName: roomName,
        isOpen: isOpen,
        rounds: selectedRounds,
        timerMinutes: selectedTimer,
        status: 'lobby',
        createdAt: FB.serverTimestamp(),
        currentRound: 0,
        currentHotSeatIndex: 0,
        hotSeatOrder: []
      });

      await FB.set('rooms/' + code + '/players/' + playerId, {
        name: name,
        score: 0,
        isReady: true,
        isOnline: true,
        guessChancesLeft: 3,
        streak: 0,
        lastSeen: FB.serverTimestamp()
      });

      /* onDisconnect: mark player offline */
      var disconnectRef = FB.onDisconnect('rooms/' + code + '/players/' + playerId);
      if (disconnectRef) {
        disconnectRef.update({
          isOnline: false,
          lastSeen: FB.serverTimestamp()
        });
      }

      sessionStorage.setItem('playerId', playerId);
      sessionStorage.setItem('playerName', name);
      sessionStorage.setItem('roomCode', code);
      sessionStorage.setItem('isHost', 'true');

      Router.navigateTo('lobby.html');
    } catch (err) {
      showBanner('Error creating room: ' + err.message, 'error');
      $btnCreate.disabled = false;
      $btnCreate.textContent = 'Create Room';
    }
  });

  /* ── Join with code ───────────────────────────────────────── */

  $btnJoinCode2.addEventListener('click', function () {
    var name = Utils.sanitize($codeName.value.trim(), 16);
    var code = $codeInput.value.trim().toUpperCase();

    if (!name) {
      showBanner('Please enter a display name.', 'error');
      $codeName.focus();
      return;
    }
    if (!code || code.length !== 6) {
      showBanner('Please enter a valid 6-character room code.', 'error');
      $codeInput.focus();
      return;
    }

    joinRoom(code, name);
  });

  /* ── Shared join logic ────────────────────────────────────── */

  async function joinRoom(code, name) {
    try {
      var meta = await FB.get('rooms/' + code + '/meta');
      if (!meta) {
        showBanner('Room not found.', 'error');
        return;
      }

      if (meta.status !== 'lobby') {
        showBanner('Game already in progress.', 'error');
        return;
      }

      var playersSnap = await FB.get('rooms/' + code + '/players');
      var playerCount = playersSnap ? Object.keys(playersSnap).length : 0;
      if (playerCount >= 8) {
        showBanner('Room is full (8/8).', 'error');
        return;
      }

      await FB.set('rooms/' + code + '/players/' + playerId, {
        name: name,
        score: 0,
        isReady: false,
        isOnline: true,
        guessChancesLeft: 3,
        streak: 0,
        lastSeen: FB.serverTimestamp()
      });

      /* onDisconnect: mark player offline */
      var disconnectRef = FB.onDisconnect('rooms/' + code + '/players/' + playerId);
      if (disconnectRef) {
        disconnectRef.update({
          isOnline: false,
          lastSeen: FB.serverTimestamp()
        });
      }

      var isHost = meta.hostId === playerId;

      sessionStorage.setItem('playerId', playerId);
      sessionStorage.setItem('playerName', name);
      sessionStorage.setItem('roomCode', code);
      sessionStorage.setItem('isHost', isHost ? 'true' : 'false');

      SFX.playPop();
      Router.navigateTo('lobby.html');
    } catch (err) {
      showBanner('Error joining room: ' + err.message, 'error');
    }
  }

  /* ── Init ─────────────────────────────────────────────────── */

  document.addEventListener('DOMContentLoaded', function () {
    FB.init();
    SFX.init();
    updateSoundIcon();
    showView($menuView);
  });

})();
