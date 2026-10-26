/* Approved shared presentation for LAN and internet. */
(() => {
let state={}, available=[], callbacks, connected=false, hostOnline=false, pending=false, errorText='', draftKey='', fingerprint='';
const view={screen:'connecting',team:'',selectedId:'',page:0,answer:'',option:'',resultsPage:0};
function distance(a,b){try{const parse=v=>{const s=String(v).replace(',','.');if(!/^[+-]?\d+(?:\.\d+)?$/.test(s))throw Error();const[n,f='']=s.split('.');return[BigInt(n+f),f.length];};const[x,p]=parse(a),[y,q]=parse(b),n=Math.max(p,q);let d=x*10n**BigInt(n-p)-y*10n**BigInt(n-q);if(d<0)d=-d;const s=d.toString().padStart(n+1,'0');return n?(s.slice(0,-n)+'.'+s.slice(-n)).replace(/\.?0+$/,''):s;}catch{return '—';}}
function save(){try{sessionStorage.setItem(draftKey,JSON.stringify({answer:view.answer,option:view.option}));}catch{}}
function fail(text){pending=false;errorText=text;render();}
async function submit(){if(pending||!connected||!hostOnline||state.status!=='ACCEPTING')return;const q=state.question;const option=q.options?.[Number(view.option)];if(q.type==='choice'&&!option)return;pending=true;errorText='';render();try{await callbacks.send({sessionId:state.sessionId,questionId:q.id,...(q.type==='choice'?{optionId:option.id}:{answer:view.answer.trim()})});}catch(e){fail(e.message);}}
function selectScreen(){if(!state.kind)return connected?'host':'connecting';if(state.team?.active===false)return 'removed';if(state.status==='FINISHED'||state.scene==='winner')return 'finished';if(state.kind!=='game')return available.length?'teams':'no-teams';if(state.status==='PAUSED')return 'paused';if(state.status==='READY'||['intro','idle','rules','qr'].includes(state.scene))return 'ready';if(state.question?.answer!==undefined)return 'reveal';if(state.response)return 'accepted';if(state.status==='ACCEPTING'&&state.question)return state.question.type==='choice'?'choice':(!connected||!hostOnline?'reconnect':'number');return 'closed';}
const content = document.querySelector('#content');
let teams = [], ranking = [];
const esc = text => String(text ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const icons = {
  clock: '<circle cx="16" cy="16" r="11"/><path d="M16 9v7l5 3"/>',
  check: '<path d="m7 16 6 6 12-13"/>',
  users: '<path d="M4 26v-3c0-4 3-6 7-6s7 2 7 6v3M23 17c3 0 5 2 5 5v4"/><circle cx="11" cy="9" r="5"/><path d="M22 4a5 5 0 0 1 0 10"/>',
  pause: '<path d="M11 7v18M21 7v18"/>',
  signal: '<path d="M4 11a19 19 0 0 1 24 0M8 16a12 12 0 0 1 16 0M12 21a6 6 0 0 1 8 0M16 26h.01"/>',
  trophy: '<path d="M10 5h12v8a6 6 0 0 1-12 0zM10 7H5v4a6 6 0 0 0 6 6M22 7h5v4a6 6 0 0 1-6 6M16 19v7M11 27h10"/>',
  lock: '<rect x="7" y="14" width="18" height="14" rx="3"/><path d="M11 14V9a5 5 0 0 1 10 0v5M16 20v3"/>',
};
function emblem(icon, cls = '') {
  return `<div class="emblem ${cls}" aria-hidden="true"><svg viewBox="0 0 32 32">${icons[icon]}</svg></div>`;
}
function center(title, subtitle, icon = 'clock', extra = '', cls = '') {
  return `<section class="center-state">${emblem(icon, cls)}${title ? `<h1>${title}</h1>` : ""}${subtitle ? `<p class="muted">${subtitle}</p>` : ""}${extra}</section>`;
}
function summary() {
  const unjoined = !state.team || ['connecting','host','teams','no-teams','ready'].includes(view.screen);
  const footer = document.querySelector('#summary');
  footer.hidden = unjoined;
  document.querySelector('#summary').innerHTML = unjoined
    ? ''
    : `<div class="identity"><div><small>ВАША КОМАНДА</small><b>${esc(view.team || '')}</b></div></div>${['number','choice','accepted','reveal','reveal-choice','closed','reconnect'].includes(view.screen) ? `<span class="footer-context">Вопрос ${state.index} из ${state.total}</span>` : ''}`;
}
function questionHeader() {
  return '';
}
function numberQuestion(reconnect = false) {
  return `${reconnect ? '<div class="connection-banner" role="status"><strong>Восстанавливаем связь</strong>Ваш ответ сохранён на телефоне.</div>' : ''}${questionHeader()}<h1 class="question-title">${esc(state.question?.text)}</h1><form class="answer-form" id="number-form"><label for="number-answer">Ваш ответ</label><div class="number-field"><input id="number-answer" type="text" inputmode="decimal" maxlength="64" autocomplete="off" aria-label="Ваш числовой ответ" value="${esc(reconnect ? view.answer : view.answer)}"></div><p id="input-error" class="inline-error" hidden></p></form><div class="bottom-action"><button class="primary" form="number-form" type="submit" ${reconnect || pending ? 'disabled' : ''}>${reconnect ? 'Ждём соединения…' : pending ? 'Отправляем…' : 'Отправить ответ'}</button></div>`;
}
function choiceQuestion() {
  const options = (state.question?.options || []).map(o=>o.text);
  return `${questionHeader()}<h1 class="question-title">${esc(state.question?.text)}</h1><div class="options">${options.map((text, i) => `<button class="option ${view.option === String(i) ? 'selected' : ''}" data-option="${i}" aria-pressed="${view.option === String(i)}"><span class="letter">${'АБВГДЕЖЗ'[i]||i+1}</span><span>${esc(text)}</span></button>`).join('')}</div><div class="bottom-action"><button class="primary" id="send-choice" ${view.option === '' || pending || !connected || !hostOnline ? 'disabled' : ''}>Отправить ответ</button></div>`;
}
function reveal() {
  const q=state.question, own=state.response?.answer, choice=q.type==='choice';
  return `<p class="reveal-question">${esc(q.text)}</p><section class="reveal-card"><span class="caption">Правильный ответ</span><div class="correct-answer ${choice?'choice':''}">${esc(q.answer)}</div></section>${own===undefined?'':choice?`<div class="saved-answer choice"><small>Ваш ответ</small><strong>${esc(own)}</strong></div>`:`<div class="compare"><div><small>Ваш ответ</small><strong>${esc(own)}</strong></div><div><small>Разница</small><strong>${esc(distance(own,q.answer))}</strong></div></div>`}<p class="next-note">Ждём следующий вопрос.</p>`;
}
function teamSelection() {
  const perPage = innerHeight < 700 ? 4 : 6;
  const pages = Math.max(1,Math.ceil(teams.length / perPage));
  view.page = Math.min(view.page, pages - 1);
  return `<div class="section-head"><span class="caption">ВХОД В ИГРУ</span><h1>Выберите команду</h1></div><div class="team-grid">${available.slice(view.page * perPage, (view.page + 1) * perPage).map(({name,id}, i) => `<button class="team-card ${id === view.selectedId ? 'selected' : ''}" data-team="${esc(id)}" aria-pressed="${id === view.selectedId}"><small>КОМАНДА ${String(view.page * perPage + i + 1).padStart(2, '0')}${id === view.selectedId ? ' · ВЫБРАНА' : ''}</small><strong>${esc(name)}</strong></button>`).join('')}</div><div class="pager"><button id="prev-page" aria-label="Предыдущие команды" ${view.page === 0 ? 'disabled' : ''}>←</button><span>${view.page + 1} / ${pages}</span><button id="next-page" aria-label="Следующие команды" ${view.page === pages - 1 ? 'disabled' : ''}>→</button></div><div class="bottom-action"><button class="primary" id="join" ${available.some(t=>t.id===view.selectedId) && !pending && connected && hostOnline ? '' : 'disabled'}>${view.team ? `Войти за «${esc(view.team)}»` : 'Выберите команду'}</button></div>`;
}
function results() {
  const perPage = innerHeight < 700 ? 5 : 8;
  const pages = Math.max(1,Math.ceil(ranking.length / perPage));
  view.resultsPage = Math.min(view.resultsPage, pages - 1);
  return `<div class="results-head"><span class="caption">ИГРА ЗАВЕРШЕНА</span><h1>Итоги</h1></div><div class="ranking-labels"><span>Место</span><span>Команда</span><span>Баллы</span></div><ol class="ranking">${ranking.slice(view.resultsPage * perPage, (view.resultsPage + 1) * perPage).map(row => `<li class="${row.id === state.team?.id ? 'mine' : ''}"><span class="rank-place">${row.place}</span><span class="rank-name">${esc(row.name)}</span><strong>${row.score}</strong></li>`).join('')}</ol><div class="pager"><button id="results-prev" aria-label="Предыдущие результаты" ${view.resultsPage === 0 ? 'disabled' : ''}>←</button><span>${view.resultsPage + 1} / ${pages}</span><button id="results-next" aria-label="Следующие результаты" ${view.resultsPage === pages - 1 ? 'disabled' : ''}>→</button></div>`;
}
function render() {
 const focus=document.activeElement?.id, caret=document.activeElement?.selectionStart;

  document.body.dataset.screen = view.screen;
  const connection = document.querySelector('#connection');
  const warning = !connected || !hostOnline;
  connection.classList.toggle('warning', warning);
  connection.querySelector('span').textContent = !connected ? 'Подключение…' : !hostOnline ? 'Ожидание ведущего' : 'Подключено';
  let html;
  switch (view.screen) {
    case 'teams': html = teamSelection(); break;
    case 'connecting': html = center('Подключаемся', '', 'signal'); break;
    case 'host': html = center('', '', 'signal'); break;
    case 'ready': html = center('Ждём начала', '', 'clock', `<div class="team-chip">Команда «${esc(view.team || '')}»</div>`); break;
    case 'number': html = numberQuestion(); break;
    case 'choice': html = choiceQuestion(); break;
    case 'accepted': html = center('Ответ принят', 'Ждём результат.<br>Смотрите на общий экран.', 'check', `<div class="saved-answer ${state.question?.type==='choice'?'choice':''}"><small>Ваш ответ</small><strong>${esc(state.response?.answer)}</strong></div>`, 'success'); break;
    case 'reveal': html = reveal(); break;
    case 'reveal-choice': html = reveal(true); break;
    case 'closed': html = center('Ответы закрыты', '', 'lock'); break;
    case 'paused': html = center('Пауза', 'Продолжим по команде ведущего.<br>Смотрите на общий экран.', 'pause'); break;
    case 'reconnect': html = numberQuestion(true); break;
    case 'no-teams': html = center('Пока нет свободных команд', 'Попросите ведущего добавить команду<br>или освободить нужную.', 'users'); break;
    case 'removed': html = center('Команда отключена', 'Обратитесь к ведущему.<br>Этот телефон пока не участвует в игре.', 'users'); break;
    case 'finished': html = results(); break;
    default: html = center('Ждём следующий вопрос', 'Следите за общим экраном.', 'clock');
  }
  content.innerHTML = html + (errorText ? `<p class="inline-error" role="alert">${esc(errorText)}</p>` : "");
  content.scrollTop = 0;
  summary();
  content.querySelectorAll('[data-team]').forEach(button => button.onclick = () => { view.selectedId=button.dataset.team;view.team=available.find(t=>t.id===view.selectedId)?.name||''; render(); });
  content.querySelector('#prev-page')?.addEventListener('click', () => { view.page--; render(); });
  content.querySelector('#next-page')?.addEventListener('click', () => { view.page++; render(); });
  content.querySelector('#join')?.addEventListener('click', () => { pending=true;errorText='';render();Promise.resolve().then(()=>callbacks.join(view.selectedId)).catch(e=>fail(e.message)); });
  content.querySelector('#results-prev')?.addEventListener('click', () => { view.resultsPage--; render(); });
  content.querySelector('#results-next')?.addEventListener('click', () => { view.resultsPage++; render(); });
  const input = content.querySelector('#number-answer');
  input?.addEventListener('input', () => { view.answer = input.value; save(); });
  content.querySelector('#number-form')?.addEventListener('submit', event => {
    event.preventDefault();
    if (view.screen === 'reconnect') return;
    if (!/^[-+]?\d+(?:[.,]\d+)?$/.test(view.answer.trim())) {
      const error = content.querySelector('#input-error'); error.hidden = false; error.textContent = 'Введите число.'; input.focus(); return;
    }
    submit();
  });
  content.querySelectorAll('[data-option]').forEach(button => button.onclick = () => { view.option = button.dataset.option; save(); render(); });
  content.querySelector('#send-choice')?.addEventListener('click', submit);
 if(focus==='number-answer'&&input){input.focus({preventScroll:true});input.setSelectionRange(caret,caret);}
}
window.KtoPhoneUI=class {
 constructor(options){callbacks=options;render();window.addEventListener('resize',()=>render());}
 accept(next){if(!next)return;const encoded=JSON.stringify(next);if(fingerprint===encoded&&!next.error)return;fingerprint=encoded;const key=[callbacks.key,next.sessionId,next.question?.id].join(':');if(key!==draftKey){draftKey=key;view.answer='';view.option='';view.resultsPage=0;try{const draft=JSON.parse(sessionStorage.getItem(key)||'{}');view.answer=String(draft.answer||'');view.option=String(draft.option||'');}catch{}}state=next;available=state.teams||[];teams=available.map(t=>t.name);ranking=state.ranking||[];if(state.team)view.team=state.team.name;pending=false;errorText=state.error||'';view.screen=selectScreen();render();}
 connection(online,host=true){if(connected===online&&hostOnline===host)return;connected=online;hostOnline=host;if(!online)pending=false;view.screen=selectScreen();render();}
 error(text){fail(text);}
};
})();


