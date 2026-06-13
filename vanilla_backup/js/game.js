/* game.js — Core game logic: hot seat flow, timer, questions, guesses, scoring, streaks.
   Owns: game page UI and all gameplay mechanics.
   Does NOT own: room creation, lobby, chat, roast. */

document.addEventListener('DOMContentLoaded', function () {
  'use strict';

  // ─── Initialise shared modules ──────────────────────────────────
  FB.init();
  SFX.init();

  // ─── Guard required state ───────────────────────────────────────
  if (!Router.requireState('playerId', 'playerName', 'roomCode')) return;

  // ─── State from session ─────────────────────────────────────────
  var roomCode   = Router.getState('roomCode');
  var playerId   = Router.getState('playerId');
  var playerName = Router.getState('playerName');
  var isHost     = Router.getState('isHost') === 'true';

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

  // ─── Core local state ───────────────────────────────────────────
  var currentMeta       = null;
  var players           = {};
  var isHotSeat         = false;
  var myPersonName      = sessionStorage.getItem('personName') || '';
  var timerInterval     = null;
  var timerRAF          = null;
  var feedItemCount     = 0;
  var pendingQuestionId = null;
  var timerTotalMs      = 0;
  var timerEndMs        = 0;
  var lastTickSecond    = -1;
  var hotSeatDisconnectTimeout = null;
  var previousHotSeatIndex     = -1;
  var previousRound            = -1;
  var guessVerifyQueue         = [];
  var isVerifyingGuess         = false;
  var countdownInterval        = null;
  var CIRCUMFERENCE            = 2 * Math.PI * 54; // ≈ 339.292
  var MAX_FEED_ITEMS           = 50;

  // Throttled question sender (one per 500ms)
  var questionThrottled = Utils.throttle(sendQuestion, 500);

  // ─── Cache DOM elements ─────────────────────────────────────────
  var dom = {
    soundToggle:        document.getElementById('soundToggle'),
    statusBanner:       document.getElementById('statusBanner'),
    countdownOverlay:   document.getElementById('countdownOverlay'),
    countdownNumber:    document.getElementById('countdownNumber'),
    countdownText:      document.getElementById('countdownText'),
    gameInfoBar:        document.getElementById('gameInfoBar'),
    roundIndicator:     document.getElementById('roundIndicator'),
    hotSeatName:        document.getElementById('hotSeatName'),
    timerSmall:         document.getElementById('timerSmall'),
    timerSection:       document.getElementById('timerSection'),
    timerContainer:     document.getElementById('timerContainer'),
    timerCircle:        document.getElementById('timerCircle'),
    timerText:          document.getElementById('timerText'),
    rulesReminder:      document.getElementById('rulesReminder'),
    feedSection:        document.getElementById('feedSection'),
    questionFeed:       document.getElementById('questionFeed'),
    scoreboardSection:  document.getElementById('scoreboardSection'),
    playerScoreboard:   document.getElementById('playerScoreboard'),
    hotSeatEnterView:   document.getElementById('hotSeatEnterView'),
    personNameInput:    document.getElementById('personNameInput'),
    btnSubmitPerson:    document.getElementById('btnSubmitPerson'),
    answerBar:          document.getElementById('answerBar'),
    answerBarStatus:    document.getElementById('answerBarStatus'),
    btnYes:             document.getElementById('btnYes'),
    btnNo:              document.getElementById('btnNo'),
    btnMaybe:           document.getElementById('btnMaybe'),
    questionBar:        document.getElementById('questionBar'),
    questionInput:      document.getElementById('questionInput'),
    btnSendQuestion:    document.getElementById('btnSendQuestion'),
    btnGuess:           document.getElementById('btnGuess'),
    guessModal:         document.getElementById('guessModal'),
    guessChancesDisplay:document.getElementById('guessChancesDisplay'),
    guessInput:         document.getElementById('guessInput'),
    btnSubmitGuess:     document.getElementById('btnSubmitGuess'),
    btnCancelGuess:     document.getElementById('btnCancelGuess'),
    guessVerifyModal:   document.getElementById('guessVerifyModal'),
    guessVerifyTitle:   document.getElementById('guessVerifyTitle'),
    guessVerifyText:    document.getElementById('guessVerifyText'),
    btnCorrect:         document.getElementById('btnCorrect'),
    btnWrong:           document.getElementById('btnWrong')
  };

  // ─── Set initial SVG stroke ─────────────────────────────────────
  dom.timerCircle.setAttribute('stroke-dasharray', CIRCUMFERENCE);
  dom.timerCircle.setAttribute('stroke-dashoffset', '0');

  // ─── Event listeners ────────────────────────────────────────────
  dom.soundToggle.addEventListener('click', function () {
    SFX.toggleSound();
    dom.soundToggle.textContent = SFX.isSoundOn() ? '🔊' : '🔇';
  });

  dom.btnSubmitPerson.addEventListener('click', handlePersonSubmit);
  dom.personNameInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') handlePersonSubmit();
  });

  dom.btnYes.addEventListener('click', function () { answerPendingQuestion('YES'); });
  dom.btnNo.addEventListener('click', function () { answerPendingQuestion('NO'); });
  dom.btnMaybe.addEventListener('click', function () { answerPendingQuestion('MAYBE'); });

  dom.btnSendQuestion.addEventListener('click', function () { questionThrottled(); });
  dom.questionInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') questionThrottled();
  });

  dom.btnGuess.addEventListener('click', openGuessModal);
  dom.btnSubmitGuess.addEventListener('click', submitGuess);
  dom.guessInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') submitGuess();
  });
  dom.btnCancelGuess.addEventListener('click', function () {
    dom.guessModal.classList.add('hidden');
  });

  dom.btnCorrect.addEventListener('click', function () { verifyGuess(true); });
  dom.btnWrong.addEventListener('click', function () { verifyGuess(false); });

  // ─── Mobile keyboard adjustment ─────────────────────────────────
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', function () {
      var offset = window.innerHeight - window.visualViewport.height;
      dom.answerBar.style.transform  = offset > 0 ? 'translateY(-' + offset + 'px)' : '';
      dom.questionBar.style.transform = offset > 0 ? 'translateY(-' + offset + 'px)' : '';
    });
  }

  // ─── Presence / online heartbeat & Connection Monitoring ────────
  function setupConnectionMonitoring() {
    FB.onValue('.info/connected', function (connected) {
      if (connected === true || connected === 'true') {
        hideBanner();

        // Re-establish onDisconnect
        var disconnectRef = FB.onDisconnect('rooms/' + roomCode + '/players/' + playerId);
        if (disconnectRef && typeof disconnectRef.update === 'function') {
          disconnectRef.update({
            isOnline: false,
            lastSeen: FB.serverTimestamp()
          });
        }

        // Mark as online
        FB.update('rooms/' + roomCode + '/players/' + playerId, {
          isOnline: true,
          lastSeen: FB.serverTimestamp()
        });
      } else {
        showBanner('Reconnecting…', 'warning');
      }
    });
  }
  setupConnectionMonitoring();

  // ─── Start Firebase listeners ───────────────────────────────────
  startMetaListener();
  startPlayersListener();
  startHotSeatListener();
  startQuestionsListener();
  startGuessesListener();

  // ═══════════════════════════════════════════════════════════════
  // META LISTENER
  // ═══════════════════════════════════════════════════════════════
  function startMetaListener() {
    FB.onValue('rooms/' + roomCode + '/meta', function (meta) {
      if (!meta) return;
      currentMeta = meta;

      // Navigation on status change
      if (meta.status === 'chat') {
        cleanup();
        Router.navigateTo('chat.html');
        return;
      }
      if (meta.status === 'ended') {
        cleanup();
        Router.navigateTo('roast.html');
        return;
      }
      if (meta.status === 'lobby') {
        cleanup();
        Router.navigateTo('lobby.html');
        return;
      }

      // Update round indicator
      dom.roundIndicator.textContent = 'Round ' + (meta.currentRound || 1) + '/' + (meta.rounds || 3);

      // Detect hot seat / round change
      var hotIdx   = meta.currentHotSeatIndex !== undefined ? meta.currentHotSeatIndex : 0;
      var curRound = meta.currentRound !== undefined ? meta.currentRound : 1;

      if (hotIdx !== previousHotSeatIndex || curRound !== previousRound) {
        previousHotSeatIndex = hotIdx;
        previousRound        = curRound;
        handleHotSeatChange(meta);
      }
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // PLAYERS LISTENER
  // ═══════════════════════════════════════════════════════════════
  function startPlayersListener() {
    FB.onValue('rooms/' + roomCode + '/players', function (data) {
      if (!data) return;
      players = data;
      renderScoreboard();
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // HOT SEAT LISTENER
  // ═══════════════════════════════════════════════════════════════
  function startHotSeatListener() {
    FB.onValue('rooms/' + roomCode + '/hotSeat', function (data) {
      if (!data) return;
      handlePhaseChange(data);
    });
  }

  // ─── Phase change handler ──────────────────────────────────────
  function handlePhaseChange(hotSeatData) {
    var phase = hotSeatData.phase;

    switch (phase) {
      case 'entering':
        stopTimer();
        hideAllBars();
        if (isHotSeat) {
          dom.hotSeatEnterView.classList.remove('hidden');
          dom.personNameInput.value = '';
          dom.personNameInput.focus();
        } else {
          dom.hotSeatEnterView.classList.add('hidden');
          showBanner(getHotSeatPlayerName() + ' is choosing a person...', 'warning');
        }
        break;

      case 'questioning':
        dom.hotSeatEnterView.classList.add('hidden');
        hideBanner();
        hideCountdown();
        timerEndMs  = hotSeatData.timerEnd || 0;
        timerTotalMs = (currentMeta.timerMinutes || 3) * 60 * 1000;
        startTimer();

        if (isHotSeat) {
          dom.answerBar.classList.remove('hidden');
          dom.questionBar.classList.add('hidden');
        } else {
          dom.answerBar.classList.add('hidden');
          dom.questionBar.classList.remove('hidden');
          dom.questionInput.focus();
        }
        dom.rulesReminder.classList.remove('hidden');
        break;

      case 'guessed':
        stopTimer();
        hideAllBars();
        showBanner('✓ Correct guess! 🎉', '');
        break;

      case 'timeout':
        stopTimer();
        hideAllBars();
        showBanner('⏰ Time\'s up!', 'warning');
        break;

      case 'waiting':
        stopTimer();
        hideAllBars();
        hideBanner();
        break;

      default:
        break;
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // QUESTIONS LISTENER (child_added and child_changed)
  // ═══════════════════════════════════════════════════════════════
  function startQuestionsListener() {
    FB.onChildAdded('rooms/' + roomCode + '/questions', function (data, key) {
      if (!data) return;
      addQuestionToFeed(key, data);
      SFX.playPop();

      // If I am hot seat and question is pending, set it for answering (prefer oldest/first)
      if (isHotSeat && data.answer === 'pending') {
        if (!pendingQuestionId) {
          pendingQuestionId = key;
          highlightPendingQuestion(key);
          updateAnswerButtonsState();
        }
      }
    });

    FB.onChildChanged('rooms/' + roomCode + '/questions', function (data, key) {
      if (!data) return;
      updateQuestionInFeed(key, data);
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // GUESSES LISTENER (child_added)
  // ═══════════════════════════════════════════════════════════════
  function startGuessesListener() {
    FB.onChildAdded('rooms/' + roomCode + '/guesses', function (data, key) {
      if (!data) return;
      addGuessToFeed(key, data);
      SFX.playPop();

      // If I am hot seat and result not yet determined, queue verification
      // Use == null to catch both null and undefined (Firebase omits null fields)
      if (isHotSeat && data.isCorrect == null) {
        guessVerifyQueue.push({ key: key, data: data });
        processGuessVerifyQueue();
      }
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // HOT SEAT CHANGE HANDLER
  // ═══════════════════════════════════════════════════════════════
  function handleHotSeatChange(meta) {
    var hotSeatOrder = meta.hotSeatOrder || [];
    var hotIdx       = meta.currentHotSeatIndex !== undefined ? meta.currentHotSeatIndex : 0;
    var hotSeatPid   = hotSeatOrder[hotIdx] || '';

    isHotSeat    = (hotSeatPid === playerId);
    myPersonName = isHotSeat ? '' : myPersonName;
    if (!isHotSeat) {
      sessionStorage.removeItem('personName');
    }

    // Clear pending
    pendingQuestionId = null;
    guessVerifyQueue  = [];
    isVerifyingGuess  = false;
    updateAnswerButtonsState();

    // Clear feed DOM
    dom.questionFeed.innerHTML = '';
    feedItemCount = 0;

    // Update hot seat name display
    var hotSeatPlayerName = getHotSeatPlayerNameById(hotSeatPid);
    dom.hotSeatName.textContent = hotSeatPlayerName + '\'s turn';

    // Hide modals and bars
    hideAllBars();
    dom.hotSeatEnterView.classList.add('hidden');
    dom.guessModal.classList.add('hidden');
    dom.guessVerifyModal.classList.add('hidden');

    // Stop previous timer
    stopTimer();

    // Reset timer display
    dom.timerText.textContent  = formatTimerMinutes(meta.timerMinutes || 3);
    dom.timerSmall.textContent = formatTimerMinutes(meta.timerMinutes || 3);
    dom.timerCircle.setAttribute('stroke-dashoffset', '0');
    dom.timerCircle.classList.remove('timer-circle-fg--warning');
    lastTickSecond = -1;

    // Only host performs Firebase writes for the hot seat transition
    if (isHost) {
      // Detach old child listeners immediately
      FB.off('rooms/' + roomCode + '/questions');
      FB.off('rooms/' + roomCode + '/guesses');

      // Clear previous questions and guesses
      Promise.all([
        FB.remove('rooms/' + roomCode + '/questions'),
        FB.remove('rooms/' + roomCode + '/guesses')
      ]).then(function () {
        // Re-attach fresh listeners after deletion completes
        startQuestionsListener();
        startGuessesListener();
      });

      // Reset all players' guess chances
      var playerIds = Object.keys(players);
      var updates = {};
      for (var i = 0; i < playerIds.length; i++) {
        updates[playerIds[i] + '/guessChancesLeft'] = 3;
      }
      if (playerIds.length > 0) {
        FB.update('rooms/' + roomCode + '/players', updates);
      }

      // Set hot seat phase to entering
      FB.set('rooms/' + roomCode + '/hotSeat', {
        currentPersonHash: '',
        phase: 'entering',
        timerEnd: 0
      });
    } else {
      // Non-host: re-attach child listeners immediately (host ensures deletion is synced)
      FB.off('rooms/' + roomCode + '/questions');
      FB.off('rooms/' + roomCode + '/guesses');
      startQuestionsListener();
      startGuessesListener();
    }

    // Show countdown for non-hot-seat players
    if (!isHotSeat) {
      showCountdown(3, hotSeatPlayerName + ' is thinking of a person...');
    }

    // Render scoreboard
    renderScoreboard();

    // Monitor hot seat player's online status for disconnect skip
    monitorHotSeatDisconnect(hotSeatPid);

    if (isHotSeat) {
      findNextPendingQuestion();
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // PERSON NAME SUBMISSION (HOT SEAT)
  // ═══════════════════════════════════════════════════════════════
  function handlePersonSubmit() {
    var rawName = dom.personNameInput.value;
    var personName = Utils.sanitize(rawName, 60);
    if (!personName || personName.trim().length === 0) {
      showBanner('Please enter a person\'s name.', 'error');
      dom.personNameInput.focus();
      return;
    }
    personName = personName.trim();

    // Store locally only — never send plaintext to Firebase
    myPersonName = personName;
    sessionStorage.setItem('personName', personName);

    // Hash and send to Firebase
    Utils.hashString(personName).then(function (hash) {
      FB.update('rooms/' + roomCode + '/hotSeat', {
        currentPersonHash: hash,
        phase: 'questioning',
        timerEnd: FB.getServerTime() + ((currentMeta.timerMinutes || 3) * 60 * 1000)
      });
      dom.hotSeatEnterView.classList.add('hidden');
      hideBanner();
    }).catch(function () {
      // Fallback if hashString is sync
      var hash = Utils.hashString(personName);
      if (typeof hash === 'string') {
        FB.update('rooms/' + roomCode + '/hotSeat', {
          currentPersonHash: hash,
          phase: 'questioning',
          timerEnd: FB.getServerTime() + ((currentMeta.timerMinutes || 3) * 60 * 1000)
        });
        dom.hotSeatEnterView.classList.add('hidden');
        hideBanner();
      }
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // COUNTDOWN OVERLAY
  // ═══════════════════════════════════════════════════════════════
  function showCountdown(fromNumber, afterText) {
    var count = fromNumber;
    dom.countdownOverlay.classList.remove('hidden');
    dom.countdownNumber.textContent = count;
    dom.countdownText.textContent   = '';

    if (countdownInterval) clearInterval(countdownInterval);

    countdownInterval = setInterval(function () {
      count--;
      if (count > 0) {
        dom.countdownNumber.textContent = count;
        // Trigger animation re-flow
        dom.countdownNumber.classList.remove('shake');
        void dom.countdownNumber.offsetWidth;
        dom.countdownNumber.classList.add('shake');
      } else if (count === 0) {
        dom.countdownNumber.textContent = '';
        dom.countdownText.textContent   = afterText || '';
      } else {
        clearInterval(countdownInterval);
        countdownInterval = null;
        hideCountdown();
      }
    }, 1000);
  }

  function hideCountdown() {
    dom.countdownOverlay.classList.add('hidden');
    if (countdownInterval) {
      clearInterval(countdownInterval);
      countdownInterval = null;
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // TIMER
  // ═══════════════════════════════════════════════════════════════
  function startTimer() {
    stopTimer();
    lastTickSecond = -1;

    function tick() {
      var now       = FB.getServerTime();
      var remaining = timerEndMs - now;
      if (remaining < 0) remaining = 0;

      var elapsed   = timerTotalMs - remaining;
      var fraction  = timerTotalMs > 0 ? elapsed / timerTotalMs : 1;
      var offset    = CIRCUMFERENCE * (1 - fraction);

      // Clamp offset
      if (offset < 0) offset = 0;
      if (offset > CIRCUMFERENCE) offset = CIRCUMFERENCE;

      dom.timerCircle.setAttribute('stroke-dashoffset', offset);

      var formatted = Utils.formatTime(remaining);
      dom.timerText.textContent  = formatted;
      dom.timerSmall.textContent = formatted;

      // Warning state when < 30 seconds
      if (remaining < 30000 && remaining > 0) {
        dom.timerCircle.classList.add('timer-circle-fg--warning');

        // Tick sound every second
        var currentSecond = Math.ceil(remaining / 1000);
        if (currentSecond !== lastTickSecond) {
          lastTickSecond = currentSecond;
          SFX.playTick();
        }
      } else {
        dom.timerCircle.classList.remove('timer-circle-fg--warning');
      }

      // Time's up
      if (remaining <= 0) {
        stopTimer();
        dom.timerText.textContent  = '0:00';
        dom.timerSmall.textContent = '0:00';
        dom.timerCircle.setAttribute('stroke-dashoffset', CIRCUMFERENCE);

        // Host handles timeout
        if (isHost) {
          handleTimeout();
        }
        return;
      }

      timerRAF = requestAnimationFrame(tick);
    }

    timerRAF = requestAnimationFrame(tick);
  }

  function stopTimer() {
    if (timerRAF) {
      cancelAnimationFrame(timerRAF);
      timerRAF = null;
    }
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
  }

  function formatTimerMinutes(mins) {
    return mins + ':00';
  }

  // ═══════════════════════════════════════════════════════════════
  // TIMEOUT HANDLING
  // ═══════════════════════════════════════════════════════════════
  function handleTimeout() {
    FB.update('rooms/' + roomCode + '/hotSeat', { phase: 'timeout' });

    // Scoring: hot seat gets +2, all non-hot-seat get -1
    var hotSeatOrder = currentMeta.hotSeatOrder || [];
    var hotIdx       = currentMeta.currentHotSeatIndex !== undefined ? currentMeta.currentHotSeatIndex : 0;
    var hotSeatPid   = hotSeatOrder[hotIdx] || '';

    var pids = Object.keys(players);
    for (var i = 0; i < pids.length; i++) {
      var pid    = pids[i];
      var player = players[pid];
      var currentScore = player.score || 0;
      if (pid === hotSeatPid) {
        FB.update('rooms/' + roomCode + '/players/' + pid, { score: currentScore + 2 });
      } else {
        FB.update('rooms/' + roomCode + '/players/' + pid, { score: currentScore - 1 });
      }
    }

    // After 3 seconds, move to next hot seat
    setTimeout(function () {
      moveToNextHotSeat();
    }, 3000);
  }

  // ═══════════════════════════════════════════════════════════════
  // QUESTION SENDING (NON-HOT-SEAT)
  // ═══════════════════════════════════════════════════════════════
  function sendQuestion() {
    var raw  = dom.questionInput.value;
    var text = Utils.sanitize(raw, 200);
    if (!text || text.trim().length === 0) return;
    text = text.trim();

    FB.push('rooms/' + roomCode + '/questions', {
      askerId:   playerId,
      askerName: playerName,
      text:      text,
      answer:    'pending',
      timestamp: FB.serverTimestamp()
    });

    dom.questionInput.value = '';
    SFX.playPop();
  }

  // ═══════════════════════════════════════════════════════════════
  // QUESTION ANSWERING (HOT SEAT)
  // ═══════════════════════════════════════════════════════════════
  function answerPendingQuestion(answer) {
    if (!pendingQuestionId) {
      findNextPendingQuestion();
    }
    if (!pendingQuestionId) return;

    // Optimistically update DOM so findNextPendingQuestion skips it
    var item = dom.questionFeed.querySelector('[data-question-id="' + pendingQuestionId + '"]');
    if (item) {
      var answerSpan = item.querySelector('.feed-item__answer');
      if (answerSpan) answerSpan.textContent = answer;
    }

    FB.update('rooms/' + roomCode + '/questions/' + pendingQuestionId, {
      answer: answer
    });

    // MAYBE: deduct 0.3 from hot seat player's score
    if (answer === 'MAYBE') {
      var hotSeatOrder = currentMeta.hotSeatOrder || [];
      var hotIdx       = currentMeta.currentHotSeatIndex !== undefined ? currentMeta.currentHotSeatIndex : 0;
      var hotSeatPid   = hotSeatOrder[hotIdx] || '';
      var hotPlayer    = players[hotSeatPid];
      if (hotPlayer) {
        var newScore = (hotPlayer.score || 0) - 0.3;
        newScore = Math.round(newScore * 10) / 10; // avoid float issues
        FB.update('rooms/' + roomCode + '/players/' + hotSeatPid, { score: newScore });
        showScorePopup(-0.3, window.innerWidth / 2, window.innerHeight / 2);
      }
    }

    SFX.playPop();

    // Find next pending question in feed
    pendingQuestionId = null;
    findNextPendingQuestion();
    updateAnswerButtonsState();
  }

  function findNextPendingQuestion() {
    // Look through feed items for any still pending
    var items = dom.questionFeed.querySelectorAll('[data-question-id]');
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      var answerEl = item.querySelector('.feed-item__answer');
      if (answerEl && answerEl.textContent === 'pending') {
        pendingQuestionId = item.getAttribute('data-question-id');
        highlightPendingQuestion(pendingQuestionId);
        updateAnswerButtonsState();
        return;
      }
    }
    updateAnswerButtonsState();
  }

  function updateAnswerButtonsState() {
    if (!dom.btnYes) return;

    var hasPending = !!pendingQuestionId;
    dom.btnYes.disabled = !hasPending;
    dom.btnNo.disabled = !hasPending;
    dom.btnMaybe.disabled = !hasPending;

    if (dom.answerBarStatus) {
      if (hasPending) {
        dom.answerBarStatus.textContent = 'Answer the active question (highlighted in green):';
        dom.answerBarStatus.classList.remove('text-muted');
        dom.answerBarStatus.classList.add('text-accent-green');
      } else {
        dom.answerBarStatus.textContent = 'Waiting for players to ask questions...';
        dom.answerBarStatus.classList.remove('text-accent-green');
        dom.answerBarStatus.classList.add('text-muted');
      }
    }
  }

  function highlightPendingQuestion(qid) {
    // Remove highlight from all
    var items = dom.questionFeed.querySelectorAll('[data-question-id]');
    for (var i = 0; i < items.length; i++) {
      items[i].classList.remove('flash-green');
    }
    // Add highlight to pending
    var target = dom.questionFeed.querySelector('[data-question-id="' + qid + '"]');
    if (target) {
      target.classList.add('flash-green');
      target.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // GUESS FLOW (NON-HOT-SEAT)
  // ═══════════════════════════════════════════════════════════════
  function openGuessModal() {
    var me = players[playerId];
    var chancesLeft = me ? (me.guessChancesLeft !== undefined ? me.guessChancesLeft : 3) : 3;

    if (chancesLeft <= 0) {
      showBanner('No guess chances left this round!', 'error');
      setTimeout(function () { hideBanner(); }, 2000);
      return;
    }

    // Render guess chances dots
    renderGuessChances(chancesLeft);

    dom.guessInput.value = '';
    dom.guessModal.classList.remove('hidden');
    dom.guessInput.focus();

    if (chancesLeft === 1) {
      showBanner('⚠ Last guess chance!', 'warning');
      setTimeout(function () { hideBanner(); }, 2000);
    }
  }

  function renderGuessChances(chancesLeft) {
    var html = '';
    for (var i = 0; i < 3; i++) {
      if (i < chancesLeft) {
        html += '<span class="guess-chance"></span>';
      } else {
        html += '<span class="guess-chance guess-chance--used"></span>';
      }
    }
    dom.guessChancesDisplay.innerHTML = html;
  }

  function submitGuess() {
    var raw   = dom.guessInput.value;
    var guess = Utils.sanitize(raw, 60);
    if (!guess || guess.trim().length === 0) return;
    guess = guess.trim();

    FB.push('rooms/' + roomCode + '/guesses', {
      guesserId:   playerId,
      guesserName: playerName,
      guess:       guess,
      isCorrect:   null,
      timestamp:   FB.serverTimestamp()
    });

    dom.guessModal.classList.add('hidden');
    SFX.playPop();
  }

  // ═══════════════════════════════════════════════════════════════
  // GUESS VERIFICATION (HOT SEAT)
  // ═══════════════════════════════════════════════════════════════
  function processGuessVerifyQueue() {
    if (isVerifyingGuess) return;
    if (guessVerifyQueue.length === 0) return;

    isVerifyingGuess = true;
    var item = guessVerifyQueue.shift();
    showGuessVerifyModal(item.key, item.data);
  }

  function showGuessVerifyModal(guessKey, guessData) {
    dom.guessVerifyTitle.textContent = guessData.guesserName + ' guesses:';
    dom.guessVerifyText.textContent  = guessData.guess;
    dom.guessVerifyModal.classList.remove('hidden');

    // Store current guess key for verification
    dom.guessVerifyModal.setAttribute('data-guess-key', guessKey);
    dom.guessVerifyModal.setAttribute('data-guesser-id', guessData.guesserId);
  }

  function verifyGuess(isCorrectClick) {
    var guessKey  = dom.guessVerifyModal.getAttribute('data-guess-key');
    var guesserId = dom.guessVerifyModal.getAttribute('data-guesser-id');

    if (!guessKey) return;

    dom.guessVerifyModal.classList.add('hidden');

    if (isCorrectClick) {
      // ─── CORRECT GUESS ───
      FB.update('rooms/' + roomCode + '/guesses/' + guessKey, { isCorrect: true });
      FB.update('rooms/' + roomCode + '/hotSeat', { phase: 'guessed' });

      // Calculate scores
      var guesser = players[guesserId];
      var guesserStreak   = guesser ? (guesser.streak || 0) : 0;
      var guesserScore    = guesser ? (guesser.score || 0) : 0;
      var pointsAwarded   = guesserStreak >= 2 ? 5 : 3;

      // Award guesser
      FB.update('rooms/' + roomCode + '/players/' + guesserId, {
        score:  guesserScore + pointsAwarded,
        streak: guesserStreak + 1
      });

      // Award hot seat +1
      var hotSeatOrder = currentMeta.hotSeatOrder || [];
      var hotIdx       = currentMeta.currentHotSeatIndex !== undefined ? currentMeta.currentHotSeatIndex : 0;
      var hotSeatPid   = hotSeatOrder[hotIdx] || '';
      var hotPlayer    = players[hotSeatPid];
      if (hotPlayer) {
        FB.update('rooms/' + roomCode + '/players/' + hotSeatPid, {
          score: (hotPlayer.score || 0) + 1
        });
      }

      // Reset other players' streaks
      var pids = Object.keys(players);
      for (var i = 0; i < pids.length; i++) {
        if (pids[i] !== guesserId) {
          FB.update('rooms/' + roomCode + '/players/' + pids[i], { streak: 0 });
        }
      }

      SFX.playCorrect();
      Utils.confetti(2000);
      flashScreen('green');
      showScorePopup('+' + pointsAwarded, window.innerWidth / 2, window.innerHeight / 3);

      // After 3 seconds, move to next
      if (isHost) {
        setTimeout(function () {
          moveToNextHotSeat();
        }, 3000);
      }
    } else {
      // ─── WRONG GUESS ───
      FB.update('rooms/' + roomCode + '/guesses/' + guessKey, { isCorrect: false });

      // Deduct guesser's chance
      var guesserWrong       = players[guesserId];
      var chancesLeft        = guesserWrong ? (guesserWrong.guessChancesLeft !== undefined ? guesserWrong.guessChancesLeft : 3) : 3;
      var newChances         = Math.max(0, chancesLeft - 1);
      FB.update('rooms/' + roomCode + '/players/' + guesserId, { guessChancesLeft: newChances });

      SFX.playWrong();
      flashScreen('red');

      // Shake animation on guesser's scoreboard item
      var guesserEl = dom.playerScoreboard.querySelector('[data-player-id="' + guesserId + '"]');
      if (guesserEl) {
        guesserEl.classList.add('shake');
        setTimeout(function () {
          guesserEl.classList.remove('shake');
        }, 600);
      }
    }

    // Process next in queue
    isVerifyingGuess = false;
    processGuessVerifyQueue();
  }

  // ═══════════════════════════════════════════════════════════════
  // MOVE TO NEXT HOT SEAT
  // ═══════════════════════════════════════════════════════════════
  function moveToNextHotSeat() {
    if (!isHost || !currentMeta) return;

    var hotSeatOrder = currentMeta.hotSeatOrder || [];
    var hotIdx       = currentMeta.currentHotSeatIndex !== undefined ? currentMeta.currentHotSeatIndex : 0;
    var curRound     = currentMeta.currentRound !== undefined ? currentMeta.currentRound : 1;
    var totalRounds  = currentMeta.rounds || 3;

    var nextIdx = hotIdx + 1;
    var turnsPerRound = Math.ceil(hotSeatOrder.length / totalRounds) || 3;
    var isRoundComplete = (nextIdx % turnsPerRound === 0);

    if (isRoundComplete || nextIdx >= hotSeatOrder.length) {
      if (curRound < totalRounds) {
        // Move to chat phase between rounds
        FB.update('rooms/' + roomCode + '/meta', {
          status: 'chat',
          currentHotSeatIndex: nextIdx
        });
      } else {
        // Game over
        FB.update('rooms/' + roomCode + '/meta', { status: 'ended' });
      }
    } else {
      // Next player in hot seat
      FB.update('rooms/' + roomCode + '/hotSeat', { phase: 'waiting' });
      Promise.all([
        FB.remove('rooms/' + roomCode + '/questions'),
        FB.remove('rooms/' + roomCode + '/guesses')
      ]).then(function () {
        FB.update('rooms/' + roomCode + '/meta', {
          currentHotSeatIndex: nextIdx
        });
      });
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // FEED RENDERING
  // ═══════════════════════════════════════════════════════════════
  function addQuestionToFeed(qid, data) {
    var item = document.createElement('div');
    item.className = 'feed-item';
    item.setAttribute('data-question-id', qid);

    // Apply answer class
    if (data.answer && data.answer !== 'pending') {
      item.classList.add('feed-item--answered-' + data.answer.toLowerCase());
    }

    var askerSpan = document.createElement('span');
    askerSpan.className = 'feed-item__asker';
    askerSpan.textContent = data.askerName;

    var textSpan = document.createElement('span');
    textSpan.className = 'feed-item__text';
    textSpan.textContent = data.text;

    var answerSpan = document.createElement('span');
    answerSpan.className = 'feed-item__answer';
    answerSpan.textContent = data.answer === 'pending' ? 'pending' : data.answer;

    item.appendChild(askerSpan);
    item.appendChild(textSpan);
    item.appendChild(answerSpan);

    dom.questionFeed.appendChild(item);
    feedItemCount++;

    // Cap feed items
    trimFeed();
    autoScrollFeed();
  }

  function updateQuestionInFeed(qid, data) {
    var item = dom.questionFeed.querySelector('[data-question-id="' + qid + '"]');
    if (!item) return;

    // Remove old answer classes
    item.classList.remove('feed-item--answered-yes', 'feed-item--answered-no', 'feed-item--answered-maybe');

    if (data.answer && data.answer !== 'pending') {
      item.classList.add('feed-item--answered-' + data.answer.toLowerCase());
    }

    var answerSpan = item.querySelector('.feed-item__answer');
    if (answerSpan) {
      answerSpan.textContent = data.answer;
    }
  }

  function addGuessToFeed(gid, data) {
    var item = document.createElement('div');
    item.className = 'feed-item feed-item--guess';
    item.setAttribute('data-guess-id', gid);

    if (data.isCorrect === true) {
      item.classList.add('feed-item--guess-correct');
    }

    var askerSpan = document.createElement('span');
    askerSpan.className = 'feed-item__asker';
    askerSpan.textContent = data.guesserName;

    var textSpan = document.createElement('span');
    textSpan.className = 'feed-item__text';
    textSpan.textContent = 'guesses: ' + data.guess;

    var resultSpan = document.createElement('span');
    resultSpan.className = 'feed-item__answer';
    if (data.isCorrect === true) {
      resultSpan.textContent = '✓ CORRECT!';
    } else if (data.isCorrect === false) {
      resultSpan.textContent = '✗ Wrong';
    } else {
      resultSpan.textContent = '...';
    }

    item.appendChild(askerSpan);
    item.appendChild(textSpan);
    item.appendChild(resultSpan);

    dom.questionFeed.appendChild(item);
    feedItemCount++;

    trimFeed();
    autoScrollFeed();
  }

  function trimFeed() {
    while (dom.questionFeed.children.length > MAX_FEED_ITEMS) {
      dom.questionFeed.removeChild(dom.questionFeed.firstChild);
      feedItemCount--;
    }
  }

  function autoScrollFeed() {
    dom.questionFeed.scrollTop = dom.questionFeed.scrollHeight;
  }

  // ═══════════════════════════════════════════════════════════════
  // SCOREBOARD RENDERING
  // ═══════════════════════════════════════════════════════════════
  function renderScoreboard() {
    var hotSeatOrder = currentMeta ? (currentMeta.hotSeatOrder || []) : [];
    var hotIdx       = currentMeta ? (currentMeta.currentHotSeatIndex !== undefined ? currentMeta.currentHotSeatIndex : 0) : 0;
    var hotSeatPid   = hotSeatOrder[hotIdx] || '';

    var html = '';
    var pids = Object.keys(players);

    for (var i = 0; i < pids.length; i++) {
      var pid    = pids[i];
      var player = players[pid];
      var name   = player.name || 'Unknown';
      var score  = player.score !== undefined ? player.score : 0;
      var streak = player.streak || 0;
      var chancesLeft = player.guessChancesLeft !== undefined ? player.guessChancesLeft : 3;

      var classes = 'player-item';
      if (pid === hotSeatPid) classes += ' player-item--hot-seat';
      if (pid === playerId)   classes += ' player-item--you';

      // Truncate name
      var displayName = name.length > 12 ? name.substring(0, 12) + '…' : name;

      html += '<div class="' + classes + '" data-player-id="' + pid + '">';
      html += '<span class="player-name">' + Utils.sanitize(displayName, 15) + '</span>';
      html += '<span class="player-score">' + score + '</span>';

      // Streak fire emoji
      if (streak >= 2) {
        html += '<span class="player-streak">🔥</span>';
      }

      // Guess chances dots (only for non-hot-seat players)
      if (pid !== hotSeatPid) {
        html += '<span class="guess-chances">';
        for (var c = 0; c < 3; c++) {
          if (c < chancesLeft) {
            html += '<span class="guess-chance"></span>';
          } else {
            html += '<span class="guess-chance guess-chance--used"></span>';
          }
        }
        html += '</span>';
      }

      html += '</div>';
    }

    dom.playerScoreboard.innerHTML = html;
  }

  // ═══════════════════════════════════════════════════════════════
  // SCORE POPUP ANIMATION
  // ═══════════════════════════════════════════════════════════════
  function showScorePopup(amount, x, y) {
    var popup = document.createElement('div');
    popup.className = 'score-popup';

    var numVal = parseFloat(amount);
    if (numVal > 0) {
      popup.classList.add('score-popup--positive');
      var strVal = String(amount);
      popup.textContent = strVal.startsWith('+') ? strVal : '+' + strVal;
    } else {
      popup.classList.add('score-popup--negative');
      popup.textContent = String(amount);
    }

    popup.style.left = x + 'px';
    popup.style.top  = y + 'px';
    document.body.appendChild(popup);

    setTimeout(function () {
      if (popup.parentNode) {
        popup.parentNode.removeChild(popup);
      }
    }, 1000);
  }

  // ═══════════════════════════════════════════════════════════════
  // SCREEN FLASH
  // ═══════════════════════════════════════════════════════════════
  function flashScreen(color) {
    var cls = color === 'green' ? 'flash-green' : 'flash-red';
    document.body.classList.add(cls);
    setTimeout(function () {
      document.body.classList.remove(cls);
    }, 600);
  }

  // ═══════════════════════════════════════════════════════════════
  // BANNER
  // ═══════════════════════════════════════════════════════════════
  function showBanner(message, type) {
    dom.statusBanner.textContent = message;
    dom.statusBanner.className   = 'banner';
    if (type === 'warning') dom.statusBanner.classList.add('banner--warning');
    if (type === 'error')   dom.statusBanner.classList.add('banner--error');
    // Remove hidden class
    dom.statusBanner.classList.remove('banner--hidden');
  }

  function hideBanner() {
    dom.statusBanner.classList.add('banner--hidden');
  }

  // ═══════════════════════════════════════════════════════════════
  // HIDE ALL BOTTOM BARS
  // ═══════════════════════════════════════════════════════════════
  function hideAllBars() {
    dom.answerBar.classList.add('hidden');
    dom.questionBar.classList.add('hidden');
  }

  // ═══════════════════════════════════════════════════════════════
  // HOT SEAT DISCONNECT MONITORING
  // ═══════════════════════════════════════════════════════════════
  function monitorHotSeatDisconnect(hotSeatPid) {
    // Clear any existing timeout
    if (hotSeatDisconnectTimeout) {
      clearTimeout(hotSeatDisconnectTimeout);
      hotSeatDisconnectTimeout = null;
    }

    if (!isHost) return;

    FB.onValue('rooms/' + roomCode + '/players/' + hotSeatPid + '/isOnline', function (online) {
      if (online === false) {
        // Start 15 second countdown
        hotSeatDisconnectTimeout = setTimeout(function () {
          // Re-check if still offline
          FB.get('rooms/' + roomCode + '/players/' + hotSeatPid + '/isOnline').then(function (stillOnline) {
            if (!stillOnline) {
              showBanner('Hot seat player disconnected. Skipping turn...', 'warning');
              setTimeout(function () {
                moveToNextHotSeat();
              }, 2000);
            }
          });
        }, 15000);
      } else {
        // Player came back online, clear timeout
        if (hotSeatDisconnectTimeout) {
          clearTimeout(hotSeatDisconnectTimeout);
          hotSeatDisconnectTimeout = null;
        }
      }
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // HELPER: Get hot seat player name
  // ═══════════════════════════════════════════════════════════════
  function getHotSeatPlayerName() {
    if (!currentMeta) return 'Player';
    var hotSeatOrder = currentMeta.hotSeatOrder || [];
    var hotIdx       = currentMeta.currentHotSeatIndex !== undefined ? currentMeta.currentHotSeatIndex : 0;
    var hotSeatPid   = hotSeatOrder[hotIdx] || '';
    return getHotSeatPlayerNameById(hotSeatPid);
  }

  function getHotSeatPlayerNameById(pid) {
    if (players[pid] && players[pid].name) {
      return players[pid].name;
    }
    return 'Player';
  }

  // ═══════════════════════════════════════════════════════════════
  // CLEANUP ON PAGE EXIT
  // ═══════════════════════════════════════════════════════════════
  function cleanup() {
    stopTimer();
    hideCountdown();
    if (hotSeatDisconnectTimeout) {
      clearTimeout(hotSeatDisconnectTimeout);
      hotSeatDisconnectTimeout = null;
    }
    FB.detachAll();
  }

  window.addEventListener('beforeunload', function () {
    cleanup();
  });

  window.addEventListener('pagehide', function () {
    cleanup();
  });

});
