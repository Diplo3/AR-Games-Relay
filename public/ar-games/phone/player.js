(function() {
  'use strict';
  const { $, GAME_ID, phases, identity, readStored, showError, renderQuestion, buildAnswer, renderLeaderboard, renderPoll } = ARQuizUI;
  const params = new URLSearchParams(location.search);
  const profileKey = 'ar-quiz:profile:' + identity('player');
  const profile = readStored(profileKey, {});
  $('room').value = params.get('room') || profile.room || '';
  $('name').value = profile.name || '';
  for (let team = 1; team <= 50; team++) $('team').append(new Option('Команда ' + team, String(team)));
  $('team').value = String(profile.team || 1);
  let client, state, readAnswer, inputKey, clockOffset = 0;
  let pending = false;

  const draftKey = () => 'ar-quiz:draft:' + client.clientId + ':' + state.runId + ':' + state.question.id;

  function receive(message) {
    const incoming = message.state;
    if (incoming?.engine !== 'ar-games-interactive') return;
    if (state && state.runId !== incoming.runId && message.clientId) return;
    if (state?.runId === incoming.runId && incoming.stateVersion < state.stateVersion) return;
    const sameQuestion = state?.runId === incoming.runId && state?.question?.id === incoming.question?.id;
    const personal = !message.clientId && state?.runId === incoming.runId
      ? { balance: state.balance, ...(sameQuestion ? { answerStatus: state.answerStatus, personalResult: state.personalResult } : {}) }
      : {};
    state = { ...incoming, ...personal };
    clockOffset = incoming.hostNow - Date.now();
    if (!sameQuestion) { pending = false; showError(''); }
    if (message.clientId && state.answerStatus) pending = false;
    if (state.answerFeedback) {
      pending = false;
      const reasons = { question_changed: 'Этот ответ относился к предыдущему вопросу.', game_changed: 'Началась новая игра. Ответ из предыдущей игры пропущен.', deadline_passed: 'Время ответа уже истекло.', question_not_open: 'Ведущий уже закрыл вопрос.', already_answered: 'Ответ игрока или команды уже принят.', invalid_answer: 'Проверьте ответ и отправьте снова.', team_required: 'Необходимо выбрать команду.' };
      showError(reasons[state.answerFeedback] || 'Ответ не принят.');
    }
    render();
  }

  function render() {
    if (!state) return;
    const question = state.question;
    $('title').textContent = state.status === 'complete' ? 'Спасибо за игру!' : state.status === 'lobby' ? 'Вы в игре!' : 'Вопрос ' + state.questionNumber;
    $('phase').textContent = phases[state.status];
    $('question-count').textContent = question ? state.questionNumber + ' / ' + state.totalQuestions : '';
    $('balance').textContent = (state.balance || 0) + ' баллов';
    const key = question ? state.runId + ':' + question.id + (question.type === 'wager' ? ':' + (state.balance || 0) : '') : state.runId + ':waiting';
    if (key !== inputKey) {
      inputKey = key;
      renderQuestion($('question-area'), question);
      if (state.status === 'complete') $('question-area').textContent = 'Все задания пройдены. Итоговый рейтинг — ниже.';
      $('answer-input').replaceChildren();
      readAnswer = question ? buildAnswer($('answer-input'), question, { draft: readStored(draftKey()), balance: state.balance || 0 }) : null;
    }
    if (state.revealed && question) renderQuestion($('question-area'), question, { revealedAnswer: state.revealedAnswer });
    const notice = $('answer-status');
    let text = '';
    let good = false;
    if (state.personalResult) {
      const result = state.personalResult;
      text = result.correct === null ? 'Спасибо за ответ!' : result.correct ? 'Верно! +' + result.delta + ' баллов' : 'Ответ оценён: ' + (result.delta >= 0 ? '+' : '') + result.delta + ' баллов';
      good = result.correct === true || result.correct === null;
      $('balance').textContent = result.total + ' баллов';
    } else if (state.answerStatus === 'received') { text = 'Ответ принят ведущим. Ждём результат.'; good = true; }
    else if (pending) text = client.ready ? 'Отправляем ответ…' : 'Ответ в очереди. Доставим после восстановления связи.';
    else if (state.status === 'paused') text = 'Ведущий поставил игру на паузу.';
    else if (state.status === 'locked') text = 'Ответы закрыты. Ведущий скоро покажет результат.';
    notice.textContent = text;
    notice.className = 'notice' + (good ? ' good' : '') + (!text ? ' hidden' : '');
    const scores = state.scores;
    $('answer-form').classList.toggle('hidden', !question || state.revealed || state.status === 'complete');
    $('results-card').classList.toggle('hidden', !scores && !state.pollResults);
    renderLeaderboard($('leaderboard'), scores);
    renderPoll($('poll-results'), state.pollResults, question);
    updateTimer();
  }

  function updateTimer() {
    if (!state) return;
    const question = state.question;
    const remaining = question?.deadlineAt === null || question?.deadlineAt === undefined ? null : Math.max(0, Math.ceil((question.deadlineAt - (Date.now() + clockOffset)) / 1000));
    $('timer').textContent = state.status === 'paused' ? 'Пауза' : state.status === 'question' && remaining !== null ? remaining + ' сек.' : '';
    const open = state.status === 'question' && (remaining === null || remaining > 0);
    $('answer-input').disabled = !open || pending || !!state.answerStatus;
    $('submit').classList.toggle('hidden', !question || state.status === 'complete' || state.revealed);
    $('submit').disabled = !open || pending || !!state.answerStatus;
  }

  async function join(event) {
    event?.preventDefault();
    showError('');
    const room = $('room').value.trim().toUpperCase();
    const name = $('name').value.trim();
    if (!/^[A-Z0-9]{4,8}$/.test(room) || !name) return showError('Введите имя и код комнаты из 4–8 букв или цифр.');
    const team = Number($('team').value);
    const mode = params.get('mode') === 'lan' ? 'lan' : params.get('mode') === 'internet' ? 'internet' : location.protocol === 'https:' ? 'internet' : 'lan';
    const lanRelay = params.get('relay');
    if (lanRelay && !/^wss?:\/\//.test(lanRelay)) return showError('Некорректный адрес подключения');
    const options = mode === 'lan'
      ? { mode, url: lanRelay || (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host }
      : { mode, configUrl: [params.get('config') || ARConnect.defaultConfigUrl, location.origin + '/relay-config.json'] };
    client?.stop();
    client = new ARConnect.Client({
      ...options, role: 'player', room, team, gameId: GAME_ID, clientId: identity('player'),
      onState: text => { $('connection').textContent = text; $('connection').classList.toggle('online', client.ready); render(); },
      onGameState: receive,
      onEvent: message => {
        if (message.type === 'joined') client.sendCommand('quiz.player.profile', { name });
      }
    });
    localStorage.setItem(profileKey, JSON.stringify({ name, room, team }));
    $('identity').textContent = name + ' · команда ' + client.team;
    $('join').classList.add('hidden');
    $('game').classList.remove('hidden');
    client.start();
  }

  $('join-form').onsubmit = join;
  $('answer-input').addEventListener('input', saveDraft);
  $('answer-input').addEventListener('change', saveDraft);
  function saveDraft() {
    if (!readAnswer || !state?.question) return;
    try { localStorage.setItem(draftKey(), JSON.stringify(readAnswer(false))); } catch {}
  }
  $('answer-form').onsubmit = event => {
    event.preventDefault();
    if (!readAnswer || pending || state.answerStatus || $('submit').disabled) return;
    try {
      const answer = readAnswer();
      showError('');
      if (client.sendCommand('interactive.answer.submit', { runId: state.runId, questionId: state.question.id, answer })) {
        pending = true;
        saveDraft();
        render();
      }
    } catch (error) { showError(error.message); }
  };
  setInterval(updateTimer, 250);
  window.addEventListener('beforeunload', () => client?.stop());
  if (params.get('room') && profile.name && profile.room === params.get('room').toUpperCase()) join();
})();
