(function() {
  'use strict';
  const { $, element, identity, GAME_ID, readStored, showError } = ARQuizUI;
  const params = new URLSearchParams(location.search);
  const profileKey = 'ar-controller:' + GAME_ID + ':' + identity('player');
  const saved = readStored(profileKey, {});
  $('room').value = params.get('room') || saved.room || '';
  $('name').value = saved.name || '';
  for (let team = 1; team <= 50; team++) $('team').append(new Option('Команда ' + team, String(team)));
  $('team').value = String(saved.team || 1);
  let client, buttons;
  try { buttons = JSON.parse(params.get('buttons') || 'null'); } catch {}
  if (!Array.isArray(buttons)) buttons = [{ label: 'ЖМИ 1', action: 'button.one' }, { label: 'ЖМИ 2', action: 'button.two' }];
  const requiredSensors = (params.get('sensors') || '').split(',').filter(name => /^[a-z][a-z0-9_.-]{0,47}$/.test(name)).slice(0, 16);
  const labels = { orientation: 'Наклон', motion: 'Движение', gyroscope: 'Гироскоп', accelerometer: 'Ускорение', geolocation: 'Геолокация', gamepad: 'Геймпад', magnetometer: 'Компас', light: 'Освещённость', proximity: 'Приближение' };
  const hub = new ARGameSensors.SensorController({ maxHz: 20,
    onSample: (channel, sample) => {
      client?.sendSensor(channel, sample);
      if (channel === 'orientation') $('calibrate').classList.remove('hidden');
    },
    onState: (channel, message) => { $('sensor-state').textContent = (labels[channel] || channel) + ': ' + message; }
  });
  for (const descriptor of buttons.slice(0, 8)) {
    if (typeof descriptor?.label !== 'string' || !/^[A-Za-z0-9_.:-]{1,64}$/.test(descriptor.action || '')) continue;
    const button = element('button', descriptor.label.slice(0, 60));
    button.type = 'button';
    button.onclick = () => { if (client) client.sendCommand(descriptor.action, {}); };
    $('buttons').append(button);
  }
  for (const channel of requiredSensors) {
    const button = element('button', 'Включить: ' + (labels[channel] || channel), 'secondary');
    button.type = 'button';
    if (!hub.available().includes(channel)) { button.disabled = true; button.textContent = (labels[channel] || channel) + ' — недоступно'; }
    button.onclick = async () => {
      if (hub.active.has(channel)) { hub.stop(channel); button.textContent = 'Включить: ' + (labels[channel] || channel); }
      else if (await hub.start(channel)) button.textContent = 'Выключить: ' + (labels[channel] || channel);
    };
    $('sensor-buttons').append(button);
  }
  $('calibrate').onclick = () => { $('sensor-state').textContent = hub.calibrate() ? 'Текущее положение стало нейтральным.' : 'Сначала включите датчик наклона.'; };
  $('join-form').onsubmit = event => {
    event.preventDefault();
    const room = $('room').value.trim().toUpperCase();
    const name = $('name').value.trim();
    if (!/^[A-Z0-9]{4,8}$/.test(room) || !name) return showError('Введите имя и код комнаты из 4–8 букв или цифр.');
    const mode = params.get('mode') === 'lan' ? 'lan' : 'internet';
    let connection;
    if (mode === 'lan') {
      const address = params.get('relay') || (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host;
      if (!/^wss?:\/\//.test(address)) return showError('Некорректный адрес подключения');
      connection = { mode, url: address };
    } else connection = { mode, configUrl: [params.get('config') || ARConnect.defaultConfigUrl, location.origin + '/relay-config.json'] };
    client?.stop();
    client = new ARConnect.Client({ ...connection, room, role: 'player', clientId: identity('player'), gameId: GAME_ID, team: Number($('team').value), capabilities: hub.available(),
      onState: message => { $('connection').textContent = message; $('connection').classList.toggle('online', client.ready); },
      onStats: stats => { $('delivery').textContent = 'Доставлено: ' + stats.received + ' · в очереди: ' + stats.pending; },
      onGameState: message => { $('game-message').textContent = typeof message.state?.message === 'string' ? message.state.message : 'Игра обновлена'; },
      onEvent: message => { if (message.type === 'joined') client.sendCommand('player.join', { name }); }
    });
    localStorage.setItem(profileKey, JSON.stringify({ name, room, team: Number($('team').value) }));
    $('name').disabled = $('room').disabled = $('team').disabled = $('join').disabled = true;
    $('controls').classList.remove('hidden');
    showError('');
    client.start();
  };
  window.addEventListener('beforeunload', () => { hub.stop(); client?.stop(); });
})();
