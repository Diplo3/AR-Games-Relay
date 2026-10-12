(function() {
  'use strict';
  const { $, element, identity, GAME_ID, readStored, showError } = ARQuizUI;
  const params = new URLSearchParams(location.search);
  const profileKey = 'ar-controller:' + GAME_ID + ':' + identity('player');
  const saved = readStored(profileKey, {});
  let ui = {};
  try { ui = JSON.parse(params.get('ui') || '{}'); } catch {}
  if (!ui || typeof ui !== 'object' || Array.isArray(ui)) ui = {};
  const gromkie=GAME_ID==='gromkie-gonki';if(gromkie){ui={...ui,layout:'steering',nameMode:'hidden',teamPicker:'buttons',brand:'ГРОМКИЕ ГОНКИ',brandSecondary:'',brandIcon:'gromkie-microphone',title:'ТРЯСИ ДЛЯ РАЗГОНА'};if(!Array.isArray(ui.teams)||ui.teams.length<2)ui.teams=[{id:1,label:'Команда 1'},{id:2,label:'Команда 2'}];}
  const nameMode = ['required', 'optional', 'hidden'].includes(ui.nameMode) ? ui.nameMode : 'required';
  const steeringLayout = ui.layout === 'steering';
  if (steeringLayout) document.body.classList.add('controller-steering');
  let teams = Array.isArray(ui.teams) && ui.teams.length && ui.teams.length <= 50
    ? ui.teams.filter(team => Number.isSafeInteger(team?.id) && team.id >= 1 && team.id <= 50 && typeof team.label === 'string').slice(0, 50)
    : Array.from({ length: 50 }, (_, index) => ({ id: index + 1, label: 'Команда ' + (index + 1) }));
  if (!teams.length) teams = Array.from({ length: 50 }, (_, index) => ({ id: index + 1, label: 'Команда ' + (index + 1) }));
  const teamIds = new Set(teams.map(team => team.id));
  for (const [key, variable] of [['accent', '--accent'], ['background', '--bg'], ['panel', '--panel']]) {
    if (/^#[0-9a-f]{6}$/i.test(ui.theme?.[key] || '')) document.documentElement.style.setProperty(variable, ui.theme[key]);
  }
  if (ui.brandIcon === 'canister') $('brand-mark').classList.remove('hidden');
  if (ui.brandIcon === 'gromkie-microphone') document.body.classList.add('controller-gromkie-logo');
  if (typeof ui.brand === 'string' && ui.brand.trim()) {
    $('brand-main').textContent = ui.brand.trim().slice(0, 32);
    if (typeof ui.brandSecondary === 'string' && ui.brandSecondary.trim()) $('brand-suffix').textContent = ui.brandSecondary.trim().slice(0, 32);
    else $('brand-suffix').classList.add('hidden');
  }
  if (typeof ui.title === 'string' && ui.title.trim()) {
    $('screen-title').textContent = ui.title.trim().slice(0, 64);
    document.title = ui.title.trim().slice(0, 64);
  }
  $('name-field').classList.toggle('hidden', nameMode === 'hidden');
  $('name').required = nameMode === 'required';
  $('room').value = params.get('room') || saved.room || '';
  if (/^[A-Z0-9]{4,8}$/i.test(params.get('room') || '')) $('room-field').classList.add('hidden');
  $('name').value = nameMode === 'hidden' ? '' : saved.name || '';
  const teamInput = $('team');
  const teamOptions = $('team-options');
  const buttonTeamPicker = ui.teamPicker === 'buttons';
  const teamButtons = new Map();
  const savedTeam = teamIds.has(saved.team) ? saved.team : teams[0].id;
  for (const team of teams) teamInput.append(new Option(team.label.slice(0, 32), String(team.id)));
  teamInput.value = String(savedTeam);
  teamInput.classList.toggle('hidden', buttonTeamPicker);
  teamOptions.classList.toggle('hidden', !buttonTeamPicker);
  function selectTeam(id) {
    if (!teamIds.has(id)) return;
    teamInput.value = String(id);if(gromkie){document.documentElement.style.setProperty('--accent',id===2?'#b36bff':'#2d9cff');}
    for (const [teamId, button] of teamButtons) {
      const selected = teamId === id;
      button.classList.toggle('selected', selected);
      button.setAttribute('aria-pressed', String(selected));
    }
  }
  if (buttonTeamPicker) for (const team of teams) {
    const button = element('button', team.label.slice(0, 32), 'team-option');
    button.type = 'button';
    button.onclick = () => selectTeam(team.id);
    teamOptions.append(button);
    teamButtons.set(team.id, button);
  }
  selectTeam(savedTeam);
  let client, buttons, gravityReference = null, lastShakeAt = 0;
  function updateShakeFeedback(sample) {
    const linear=sample?.acceleration, gravity=sample?.accelerationIncludingGravity, rotation=sample?.rotationRate;
    let accel=0, angular=0;
    if(linear&&[linear.x,linear.y,linear.z].every(Number.isFinite)) accel=Math.hypot(linear.x,linear.y,linear.z);
    else if(gravity&&[gravity.x,gravity.y,gravity.z].every(Number.isFinite)){
      if(!gravityReference) gravityReference={...gravity};
      const delta=Math.hypot(gravity.x-gravityReference.x,gravity.y-gravityReference.y,gravity.z-gravityReference.z);
      accel=delta; for(const axis of ['x','y','z']) gravityReference[axis]=gravityReference[axis]*.88+gravity[axis]*.12;
    }
    if(rotation&&[rotation.alpha,rotation.beta,rotation.gamma].every(Number.isFinite)) angular=Math.hypot(rotation.alpha,rotation.beta,rotation.gamma);
    const power=Math.max(Math.min(accel/14,1),Math.min(angular/480,1));
    const percent=Math.round(power*100),active=power>.16,now=performance.now();
    $('shake-progress').style.width=percent+'%';$('shake-value').textContent=percent+'%';
    $('shake-feedback').classList.toggle('active',active);
    $('shake-label').textContent=active?'ОТЛИЧНЫЙ РЫВОК!':'ВСТРЯХИВАЙТЕ ТЕЛЕФОН';
    if(active&&now-lastShakeAt>180){lastShakeAt=now;$('game-message').textContent='Разгон пошёл! Продолжайте встряхивать телефон.';}
  }
  try { buttons = JSON.parse(params.get('buttons') || 'null'); } catch {}
  if(gromkie)buttons=[];if (!Array.isArray(buttons)) buttons = [{ label: 'ЖМИ 1', action: 'button.one' }, { label: 'ЖМИ 2', action: 'button.two' }];
  const requiredSensors = (gromkie?'motion':(params.get('sensors') || '')).split(',').filter(name => /^[a-z][a-z0-9_.-]{0,47}$/.test(name)).slice(0, 16);
  const labels = { orientation: 'Наклон', motion: 'Движение', gyroscope: 'Гироскоп', accelerometer: 'Ускорение', geolocation: 'Геолокация', gamepad: 'Геймпад', magnetometer: 'Компас', light: 'Освещённость', proximity: 'Приближение' };
  const hub = new ARGameSensors.SensorController({ maxHz: 20,
    onSample: (channel, sample) => {
      client?.sendSensor(channel, sample);
      if(channel==='motion') updateShakeFeedback(sample);
      if (channel === 'orientation') $('calibrate').classList.remove('hidden');
    },
    onState: (channel, message) => { $('sensor-state').textContent = (labels[channel] || channel) + ': ' + message; if(gromkie&&channel==='motion'&&message.includes('не разрешён')){$('gromkie-tap').classList.remove('hidden');$('sensor-state').textContent='Доступ не разрешён. Повтори запрос или играй кнопкой.'} }
  });
  for (const descriptor of buttons.slice(0, 8)) {
    if (typeof descriptor?.label !== 'string' || !/^[A-Za-z0-9_.:-]{1,64}$/.test(descriptor.action || '')) continue;
    const direction = steeringLayout && descriptor.action.endsWith('.left') ? 'left'
      : steeringLayout && descriptor.action.endsWith('.right') ? 'right' : '';
    const button = direction ? element('button', '', 'steering-button') : element('button', descriptor.label.slice(0, 60));
    button.type = 'button';
    if (direction) {
      button.setAttribute('aria-label', direction === 'left' ? 'Влево' : 'Вправо');
      button.append(element('span', direction === 'left' ? '←' : '→', 'steering-arrow'));
      button.append(element('span', direction === 'left' ? 'ВЛЕВО' : 'ВПРАВО', 'steering-label'));
    }
    button.onclick = () => { if (client) client.sendCommand(descriptor.action, {}); };
    $('buttons').append(button);
  }
  const sensorButtons=new Map();
  function startMotion(){hub.stop('motion');const attempt=hub.start('motion');attempt.then(ok=>{const b=sensorButtons.get('motion');if(b)b.textContent=ok?'Выключить датчик':'Разрешить доступ к датчику движения';if(gromkie)$('gromkie-tap').classList.toggle('hidden',ok)});return attempt}
  for (const channel of requiredSensors) {
    const button = element('button', 'Включить: ' + (labels[channel] || channel), 'secondary');
    button.type = 'button';
    if (!hub.available().includes(channel)) { button.disabled = true; button.textContent = (labels[channel] || channel) + ' — недоступно'; }
    button.onclick = async () => {
      if (hub.active.has(channel)) { hub.stop(channel); button.textContent = 'Включить: ' + (labels[channel] || channel); }
      else if (await (gromkie&&channel==='motion'?startMotion():hub.start(channel))) { button.textContent = 'Выключить: ' + (labels[channel] || channel); if(channel==='motion') $('game-message').textContent='Датчик включён. Встряхивайте телефон для разгона!'; }
    };
    sensorButtons.set(channel,button);$('sensor-buttons').append(button);
  }
  $('calibrate').onclick = () => { $('sensor-state').textContent = hub.calibrate() ? 'Текущее положение стало нейтральным.' : 'Сначала включите датчик наклона.'; };
  $('join-form').onsubmit = event => {
    event.preventDefault();
    const room = $('room').value.trim().toUpperCase();
    const playerId = identity('player');
    const name = nameMode === 'hidden' ? (teams.find(t=>t.id===Number(teamInput.value))?.label||'Игрок ' + playerId.slice(-4)) : $('name').value.trim() || 'Игрок ' + playerId.slice(-4);
    if (!/^[A-Z0-9]{4,8}$/.test(room)) return showError('Введите код комнаты из 4–8 латинских букв или цифр.');
    if (nameMode === 'required' && !$('name').value.trim()) return showError('Введите имя.');
    const mode = params.get('mode') === 'lan' ? 'lan' : 'internet';
    let connection;
    if (mode === 'lan') {
      const address = params.get('relay') || (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host;
      if (!/^wss?:\/\//.test(address)) return showError('Некорректный адрес подключения');
      connection = { mode, url: address };
    } else connection = { mode, configUrl: [params.get('config') || ARConnect.defaultConfigUrl, location.origin + '/relay-config.json'] };
    client?.stop();if(gromkie)startMotion();
    client = new ARConnect.Client({ ...connection, room, role: 'player', clientId: playerId, gameId: GAME_ID, team: Number($('team').value), capabilities: hub.available(),
      onState: message => { $('connection').textContent = message; $('connection').classList.toggle('online', client.ready); },
      onGameState: message => { $('game-message').textContent = typeof message.state?.message === 'string' ? message.state.message : 'Игра обновлена'; },
      onEvent: message => { if (message.type === 'joined') client.sendCommand('player.join', { name }); }
    });
    localStorage.setItem(profileKey, JSON.stringify({ name: nameMode === 'hidden' ? '' : name, room, team: Number($('team').value) }));
    $('name').disabled = $('room').disabled = $('team').disabled = $('join').disabled = true;
    for (const button of teamButtons.values()) button.disabled = true;
    $('join-form').classList.add('hidden');
    $('controls').classList.remove('hidden');
    if (steeringLayout) {
      const chosenTeam = teams.find(team => String(team.id) === $('team').value);
      $('team-indicator').textContent = chosenTeam?.indicatorLabel || chosenTeam?.label || '';
      $('team-indicator').classList.remove('hidden');
    }
    $('sensor-note').classList.add('hidden');
    $('game-message').textContent='Подключено. Включите датчик и встряхивайте телефон для разгона.';
    document.body.classList.add('controller-active');
    showError('');
    client.start();
  };
  let lastManualTap=0;if(gromkie){$('gromkie-tap').onpointerdown=event=>{event.preventDefault();const at=performance.now();if(client?.ready&&at-lastManualTap>=90){lastManualTap=at;client.sendCommand('race.tap',{})}};$('controller-back').onclick=()=>{hub.stop();client?.stop();client=null;document.body.classList.remove('controller-active');$('controls').classList.add('hidden');$('join-form').classList.remove('hidden');$('team-indicator').classList.add('hidden');$('name').disabled=$('room').disabled=$('team').disabled=$('join').disabled=false;for(const b of teamButtons.values())b.disabled=false;$('connection').textContent='Выбери команду';$('connection').classList.remove('online')}}else $('controller-back').classList.add('hidden');
  window.addEventListener('beforeunload', () => { hub.stop(); client?.stop(); });
})();
