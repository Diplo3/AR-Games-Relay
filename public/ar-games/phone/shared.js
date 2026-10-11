(function(root) {
  'use strict';

  // HTTP LAN pages still have getRandomValues, but often do not expose randomUUID.
  if (!crypto.randomUUID) crypto.randomUUID = function() {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = bytes[6] & 15 | 64;
    bytes[8] = bytes[8] & 63 | 128;
    const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
    return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join('-');
  };

  const $ = id => document.getElementById(id);
  const element = (tag, text, className) => {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  };
  const requestedGameId = new URLSearchParams(location.search).get('game');
  const GAME_ID = requestedGameId && /^[A-Za-z0-9_.-]{1,64}$/.test(requestedGameId) ? requestedGameId : 'ar-games-quiz-demo';
  const phases = { lobby: 'Ожидание игроков', question: 'Вопрос открыт', paused: 'Пауза', locked: 'Ответы приняты', complete: 'Квиз завершён' };
  const labels = { 'single-choice': 'Выберите один вариант', 'multi-select': 'Выберите несколько вариантов', text: 'Введите ответ', numeric: 'Введите число', sequence: 'Расположите по порядку', matching: 'Сопоставьте пары', hotspot: 'Отметьте точку', poll: 'Поделитесь мнением', wager: 'Сделайте ставку и выберите ответ' };

  function identity(role) {
    const device = new URLSearchParams(location.search).get('device') || 'default';
    const key = 'ar-quiz:id:' + GAME_ID + ':' + role + ':' + device.slice(0, 40);
    let id = localStorage.getItem(key);
    if (!id) localStorage.setItem(key, id = crypto.randomUUID());
    return id;
  }

  function readStored(key, fallback = null) {
    try { return JSON.parse(localStorage.getItem(key)) || fallback; } catch { return fallback; }
  }

  function showError(message) {
    $('error').textContent = message || '';
    $('error').classList.toggle('hidden', !message);
  }

  function safeMediaUrl(value) {
    if (typeof value !== 'string') return null;
    try {
      const url = new URL(value, location.href);
      return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
    } catch { return null; }
  }

  function renderMedia(container, question, host = false) {
    for (const media of question.media || []) {
      if (!host && media.playback === 'venue') continue;
      const url = safeMediaUrl(media.url);
      if (!url) continue;
      if (media.kind === 'image') {
        const img = element('img', undefined, 'media');
        img.src = url;
        img.alt = 'Иллюстрация к вопросу';
        img.addEventListener('error', () => img.replaceWith(element('p', 'Изображение недоступно', 'muted')));
        container.append(img);
      } else if (['audio', 'video'].includes(media.kind)) {
        const player = element(media.kind, undefined, 'media');
        player.src = url;
        player.controls = true;
        player.preload = 'metadata';
        if (media.poster && safeMediaUrl(media.poster)) player.poster = safeMediaUrl(media.poster);
        player.addEventListener('loadedmetadata', () => { player.currentTime = (media.startMs || 0) / 1000; });
        player.addEventListener('timeupdate', () => {
          if (media.endMs !== undefined && player.currentTime >= media.endMs / 1000) player.pause();
        });
        container.append(player);
      }
    }
  }

  function renderQuestion(container, question, { host = false, revealedAnswer } = {}) {
    container.replaceChildren();
    if (!question) {
      container.append(element('p', 'Ведущий скоро откроет вопрос. Оставьте эту страницу открытой.', 'muted'));
      return;
    }
    container.append(element('h2', question.prompt, 'question'));
    if (question.type === 'hotspot' && (host || revealedAnswer !== undefined)) {
      const area = element('div', undefined, 'hotspot');
      area.style.maxWidth = '340px';
      const img = element('img');
      img.src = safeMediaUrl(question.media?.find(media => media.kind === 'image')?.url) || 'target.svg';
      img.alt = 'Иллюстрация для выбора точки';
      area.append(img);
      if (Array.isArray(revealedAnswer)) {
        const ns = 'http://www.w3.org/2000/svg';
        const overlay = document.createElementNS(ns, 'svg');
        overlay.setAttribute('viewBox', '0 0 1 1');
        overlay.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none';
        for (const region of revealedAnswer) {
          const shape = document.createElementNS(ns, region.shape === 'rect' ? 'rect' : region.shape === 'circle' ? 'circle' : 'polygon');
          const attrs = region.shape === 'rect' ? { x: region.x, y: region.y, width: region.width, height: region.height }
            : region.shape === 'circle' ? { cx: region.x, cy: region.y, r: region.radius }
              : { points: region.points.map(point => point.x + ',' + point.y).join(' ') };
          for (const [name, value] of Object.entries(attrs)) shape.setAttribute(name, String(value));
          shape.setAttribute('fill', '#72e0b360');
          shape.setAttribute('stroke', '#72e0b3');
          shape.setAttribute('stroke-width', '.01');
          overlay.append(shape);
        }
        area.append(overlay);
      }
      container.append(area);
    } else if (question.type !== 'hotspot') renderMedia(container, question, host);
    container.append(element('p', labels[question.type] || 'Ответьте на вопрос', 'muted'));
    if ((host || revealedAnswer !== undefined) && question.options) {
      const grid = element('div', undefined, 'choices');
      for (const [index, option] of question.options.entries()) {
        const correct = option.id === revealedAnswer || Array.isArray(revealedAnswer) && revealedAnswer.includes(option.id);
        const choice = element('div', undefined, 'choice' + (correct ? ' correct' : ''));
        choice.append(element('span', String.fromCharCode(65 + index), 'letter'), element('span', option.text || option.id));
        grid.append(choice);
      }
      container.append(grid);
    }
    if (revealedAnswer !== undefined && !question.options) {
      const formatChoice = id => (question.items || question.right || []).find(item => item.id === id)?.text || id;
      let text;
      if (question.type === 'matching') text = Object.entries(revealedAnswer).map(([id, right]) => (question.left.find(item => item.id === id)?.text || id) + ' → ' + formatChoice(right)).join('; ');
      else if (question.type === 'hotspot') text = 'Правильная область выделена зелёным.';
      else text = Array.isArray(revealedAnswer) ? revealedAnswer.map(formatChoice).join(' → ') : String(revealedAnswer);
      container.append(element('div', 'Ответ: ' + text, 'notice good'));
    }
  }

  function buildAnswer(container, question, { draft, balance = 0 } = {}) {
    container.replaceChildren();
    const type = question.type;
    const mode = question.mode;
    let read;
    const required = (condition, message) => { if (!condition) throw new Error(message); };
    const notify = () => container.dispatchEvent(new Event('change', { bubbles: true }));

    if (['single-choice', 'multi-select', 'wager'].includes(type) || type === 'poll' && ['single-choice', 'multiple', undefined].includes(mode)) {
      const multi = type === 'multi-select' || mode === 'multiple';
      const grid = element('div', undefined, 'choices');
      for (const [index, option] of question.options.entries()) {
        const label = element('label', undefined, 'choice');
        const input = element('input');
        input.type = multi ? 'checkbox' : 'radio';
        input.name = 'option';
        input.value = option.id;
        input.checked = multi ? (draft?.optionIds || []).includes(option.id) : draft?.optionId === option.id;
        label.append(input, element('span', String.fromCharCode(65 + index), 'letter'), element('span', option.text || option.id));
        if (safeMediaUrl(option.image)) {
          const img = element('img', undefined, 'media');
          img.src = safeMediaUrl(option.image);
          img.alt = option.text || 'Вариант ответа';
          label.append(img);
        }
        grid.append(label);
      }
      container.append(grid);
      let wager;
      if (type === 'wager') {
        const label = element('label', 'Ставка (доступно до ' + Math.min(balance, question.maxWager) + ' баллов)');
        wager = element('input');
        Object.assign(wager, { type: 'number', min: '0', max: String(Math.min(balance, question.maxWager)), step: '1', value: String(draft?.wager ?? 0) });
        label.append(wager);
        container.append(label);
      }
      read = (validate = true) => {
        const ids = Array.from(grid.querySelectorAll('input:checked'), input => input.value);
        if (validate) {
          required(ids.length, 'Выберите вариант ответа.');
          required(!multi || ids.length <= (question.maxSelections || question.options.length), 'Выбрано слишком много вариантов.');
        }
        const answer = multi ? { optionIds: ids } : { optionId: ids[0] };
        if (wager) {
          answer.wager = Number(wager.value);
          if (validate) required(Number.isSafeInteger(answer.wager) && answer.wager >= 0 && answer.wager <= Math.min(balance, question.maxWager), 'Проверьте размер ставки.');
        }
        return answer;
      };
    } else if (type === 'text' || type === 'poll' && ['free-text', 'word-cloud'].includes(mode)) {
      const input = element(type === 'poll' && mode === 'free-text' ? 'textarea' : 'input');
      input.maxLength = question.maxLength || (mode === 'word-cloud' ? 80 : 500);
      input.placeholder = mode === 'word-cloud' ? 'Одно слово или короткая фраза' : 'Ваш ответ';
      input.setAttribute('aria-label', 'Ваш ответ');
      input.value = draft?.text || '';
      container.append(input);
      read = (validate = true) => {
        if (validate) required(input.value.trim(), 'Введите ответ.');
        return { text: input.value.trim() };
      };
    } else if (type === 'numeric' || type === 'poll' && ['rating', 'nps'].includes(mode)) {
      const input = element('input');
      input.type = 'number';
      input.inputMode = 'decimal';
      input.step = mode === 'nps' ? '1' : String(question.step || 'any');
      const min = mode === 'nps' ? 0 : question.min ?? (mode === 'rating' ? 1 : undefined);
      const max = mode === 'nps' ? 10 : question.max ?? (mode === 'rating' ? 5 : undefined);
      if (min !== undefined) input.min = String(min);
      if (max !== undefined) input.max = String(max);
      input.value = draft?.value === undefined ? '' : String(draft.value);
      input.setAttribute('aria-label', 'Числовой ответ');
      container.append(input);
      if (min !== undefined && max !== undefined) container.append(element('p', 'От ' + min + ' до ' + max, 'muted'));
      read = (validate = true) => {
        const value = input.value === '' ? NaN : Number(input.value);
        if (validate) required(Number.isFinite(value) && input.checkValidity(), 'Введите число в указанном диапазоне.');
        return { value };
      };
    } else if (type === 'sequence' || type === 'poll' && mode === 'ranking') {
      const items = question.items || question.options;
      let order = (draft?.order || draft?.optionIds || items.map(item => item.id)).slice();
      const list = element('div');
      const redraw = () => {
        list.replaceChildren();
        order.forEach((id, index) => {
          const row = element('div', undefined, 'order-row');
          row.append(element('span', (index + 1) + '. ' + (items.find(item => item.id === id)?.text || id)));
          for (const [direction, label] of [[-1, '↑'], [1, '↓']]) {
            const button = element('button', label, 'secondary');
            button.type = 'button';
            button.setAttribute('aria-label', (direction < 0 ? 'Поднять ' : 'Опустить ') + (items.find(item => item.id === id)?.text || id));
            button.disabled = index + direction < 0 || index + direction >= order.length;
            button.onclick = () => { [order[index], order[index + direction]] = [order[index + direction], order[index]]; redraw(); notify(); };
            row.append(button);
          }
          list.append(row);
        });
      };
      redraw();
      container.append(list);
      read = () => type === 'sequence' ? { order: [...order] } : { optionIds: [...order] };
    } else if (type === 'matching') {
      const pairs = new Map();
      question.left.forEach(item => {
        const label = element('label', undefined, 'match-row');
        const select = element('select');
        select.append(new Option('Выберите пару', ''));
        question.right.forEach(right => select.append(new Option(right.text || right.id, right.id)));
        select.value = draft?.pairs?.[item.id] || '';
        label.append(element('span', item.text || item.id), select);
        pairs.set(item.id, select);
        container.append(label);
      });
      read = (validate = true) => {
        const answer = Object.fromEntries(Array.from(pairs, ([id, select]) => [id, select.value]));
        if (validate) required(Object.values(answer).every(Boolean) && new Set(Object.values(answer)).size === question.left.length, 'Для каждого пункта выберите отдельную пару.');
        return { pairs: answer };
      };
    } else if (type === 'hotspot') {
      let point = draft?.point;
      const area = element('div', undefined, 'hotspot');
      area.setAttribute('role', 'slider');
      area.setAttribute('aria-label', 'Точка на изображении. Стрелки перемещают точку.');
      area.setAttribute('aria-valuemin', '0');
      area.setAttribute('aria-valuemax', '100');
      area.tabIndex = 0;
      const img = element('img');
      img.src = safeMediaUrl(question.media?.find(media => media.kind === 'image')?.url) || 'target.svg';
      img.alt = 'Отметьте точку на изображении';
      const marker = element('span', undefined, 'marker');
      const move = value => {
        point = value;
        marker.style.left = point.x * 100 + '%';
        marker.style.top = point.y * 100 + '%';
        marker.hidden = false;
        area.setAttribute('aria-valuetext', Math.round(point.x * 100) + ', ' + Math.round(point.y * 100));
        area.setAttribute('aria-valuenow', String(Math.round(point.x * 100)));
        notify();
      };
      marker.hidden = !point;
      area.append(img, marker);
      area.onpointerdown = event => {
        const rect = area.getBoundingClientRect();
        move({ x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)), y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)) });
      };
      area.onkeydown = event => {
        const shifts = { ArrowLeft: [-.02, 0], ArrowRight: [.02, 0], ArrowUp: [0, -.02], ArrowDown: [0, .02] };
        if (!shifts[event.key]) return;
        event.preventDefault();
        const old = point || { x: .5, y: .5 };
        move({ x: Math.max(0, Math.min(1, old.x + shifts[event.key][0])), y: Math.max(0, Math.min(1, old.y + shifts[event.key][1])) });
      };
      container.append(area);
      if (point) move(point);
      read = (validate = true) => { if (validate) required(point, 'Отметьте точку на изображении.'); return { point }; };
    } else {
      container.append(element('p', 'Этот тип вопроса пока не поддерживается экраном телефона.', 'notice'));
      read = () => { throw new Error('Тип вопроса не поддерживается'); };
    }
    return read;
  }

  function renderLeaderboard(container, scores) {
    container.replaceChildren();
    if (!scores?.length) return container.append(element('p', 'Рейтинг появится после раскрытия ответов.', 'muted'));
    const list = element('ol', undefined, 'leaderboard');
    for (const row of scores) {
      const item = element('li');
      item.append(element('span', row.rank, 'rank'), element('span', row.name || row.id, 'name'), element('span', row.score + ' б.', 'score'));
      list.append(item);
    }
    container.append(list);
  }

  function renderPoll(container, poll, question) {
    container.replaceChildren();
    if (!poll) return;
    container.append(element('h3', 'Мнение аудитории · ответов: ' + poll.total));
    if (poll.average !== undefined) container.append(element('p', 'Средняя оценка: ' + poll.average.toFixed(1)));
    if (poll.nps !== undefined) container.append(element('p', 'Индекс NPS: ' + poll.nps));
    if (poll.npsGroups) container.append(element('p', 'Критики: ' + poll.npsGroups.detractors + ' · Нейтральные: ' + poll.npsGroups.passives + ' · Сторонники: ' + poll.npsGroups.promoters, 'muted'));
    if (question?.mode === 'word-cloud') {
      const cloud = element('div');
      cloud.style.cssText = 'display:flex;flex-wrap:wrap;gap:18px;align-items:center;justify-content:center;padding:20px';
      const max = Math.max(1, ...poll.results.map(row => row.count));
      for (const row of poll.results) {
        const word = element('span', row.value);
        word.style.cssText = 'color:var(--good);font-weight:700;font-size:' + (18 + 24 * row.count / max) + 'px';
        word.title = row.count + ' ответов';
        cloud.append(word);
      }
      container.append(cloud);
      return;
    }
    for (const row of poll.results) {
      const label = question?.options?.find(option => option.id === row.value)?.text || row.value;
      container.append(element('p', label + ' — ' + (row.averageRank !== undefined ? 'среднее место ' + row.averageRank.toFixed(1) : row.count + ' (' + row.percent + '%)')));
      if (row.percent !== undefined) {
        const bar = element('div', undefined, 'progress');
        const fill = element('span');
        fill.style.width = row.percent + '%';
        bar.append(fill);
        container.append(bar);
      }
    }
  }

  root.ARQuizUI = { $, element, GAME_ID, phases, identity, readStored, showError, safeMediaUrl, renderQuestion, buildAnswer, renderLeaderboard, renderPoll };
})(globalThis);
