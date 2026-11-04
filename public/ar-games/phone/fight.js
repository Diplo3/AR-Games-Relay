(() => {
  'use strict';
  if (!crypto.randomUUID) crypto.randomUUID = function() {
    const bytes = crypto.getRandomValues(new Uint8Array(16)); bytes[6] = bytes[6] & 15 | 64; bytes[8] = bytes[8] & 63 | 128;
    const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
    return [hex.slice(0,8),hex.slice(8,12),hex.slice(12,16),hex.slice(16,20),hex.slice(20)].join('-');
  };
  const $ = id => document.getElementById(id), params = new URLSearchParams(location.search), fragment = new URLSearchParams(location.hash.slice(1));
  const room = params.get('room') || '', slot = Number(fragment.get('slot') || sessionStorage.getItem('ar-fight-slot:' + room));
  const key = fragment.get('key') || sessionStorage.getItem('ar-fight-key:' + room + ':' + slot);
  const input = new FightInput.State(), session = crypto.randomUUID ? crypto.randomUUID() : Array.from(crypto.getRandomValues(new Uint32Array(4))).join('-');
  let client, seq = 0, epoch = '', active = false, mode = 'full', timer;
  const buttons = [...document.querySelectorAll('[data-action]')];
  $('player').textContent = 'Игрок ' + slot;
  function clear() {input.clear(); for (const b of buttons) b.classList.remove('pressed');}
  function render() {
    const playing = active && !!client?.ready;
    for (const button of buttons) button.disabled = !playing;
    $('playfield').classList.toggle('arcade', mode === 'arcade');
    $('layout').textContent = mode === 'arcade' ? 'Аркада · удар и блок' : 'Полное управление';
    $('round').textContent = !client?.ready ? 'Связь потеряна. Переподключаемся…' : playing ? 'Бой идёт' : 'Ждём начала или продолжения боя';
  }
  if (!/^[A-Z0-9]{4,8}$/.test(room) || ![1, 2].includes(slot) || !/^[a-f0-9]{32}$/.test(key || '')) {
    $('error').textContent = 'Неверная ссылка. Отсканируйте QR игрока на экране ведущего.'; $('connect').disabled = true; return;
  }
  sessionStorage.setItem('ar-fight-slot:' + room, String(slot)); sessionStorage.setItem('ar-fight-key:' + room + ':' + slot, key);
  history.replaceState(null, '', location.pathname + location.search);
  function send() {if (client?.ready && epoch) client.sendSensor('fight.input', {v: 1, key, session, epoch, seq: ++seq, ...input.snapshot()});}
  for (const button of buttons) {
    button.addEventListener('pointerdown', event => {
      if (!active || !client?.ready) return; event.preventDefault();
      button.setPointerCapture(event.pointerId); input.press(event.pointerId, button.dataset.action); button.classList.add('pressed');
    });
    function release(event) {input.release(event.pointerId); if (![...input.down.values()].includes(button.dataset.action)) button.classList.remove('pressed');}
    button.addEventListener('pointerup', release); button.addEventListener('pointercancel', release); button.addEventListener('lostpointercapture', release);
  }
  const keyboard = {ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'jump', ArrowDown: 'crouch', KeyF: 'light', KeyG: 'heavy', KeyH: 'block'};
  window.addEventListener('keydown', event => {const action = keyboard[event.code] || (['Enter', 'Space'].includes(event.code) ? event.target.dataset?.action : null); if (action && active && client?.ready) {event.preventDefault(); input.press('key:' + event.code, action);}});
  window.addEventListener('keyup', event => input.release('key:' + event.code));
  window.addEventListener('blur', () => {clear(); send();});
  document.addEventListener('visibilitychange', () => {clear(); send();});
  document.addEventListener('contextmenu', event => event.preventDefault());
  $('connect').onclick = () => {
    let id = localStorage.getItem('ar-fight-device:' + slot);
    if (!id) {id = session; localStorage.setItem('ar-fight-device:' + slot, id);}
    const lan = params.get('mode') === 'lan';
    client = new ARConnect.Client({...(lan ? {url: params.get('relay'), mode: 'lan', configUrl: null} : {mode: 'internet', configUrl: params.get('config') || ARConnect.defaultConfigUrl}), role: 'player', room, gameId: 'ar-fight', clientId: id, team: slot,
      onState: text => {$('connection').textContent = text; $('connection').classList.toggle('online', !!client.ready); active = false; clear(); render();},
      onGameState: message => {
        const f = message.state?.fight;
        if (!f || typeof f.epoch !== 'string' || !['full', 'arcade', 'demo'].includes(f.mode)) return;
        if (epoch !== f.epoch) input.clear(true);
        epoch = f.epoch; active = f.active === true; mode = f.mode;
        if (!active) clear(); send(); render();
      }
    });
    $('join').hidden = true; $('controller').hidden = false; render(); client.start(); timer = setInterval(send, 50);
  };
  $('fullscreen').onclick = async () => {try {await document.documentElement.requestFullscreen?.();} catch { $('round').textContent = 'Полный экран недоступен. Пульт продолжает работать.'; }};
  window.addEventListener('pagehide', () => {clear(); send(); clearInterval(timer); client?.stop();});
})();
