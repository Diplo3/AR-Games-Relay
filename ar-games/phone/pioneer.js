(()=>{'use strict';
const $=id=>document.getElementById(id),params=new URLSearchParams(location.search),room=params.get('room')||'',gameId='ar.pioneer.sled';
let teams=['Синие','Красные'];try{const names=JSON.parse(params.get('teams')||'null');if(Array.isArray(names)&&names.length===2)teams=names.map(v=>String(v).slice(0,24));}catch{}
let player=0,client=null,game={},sensorActive=false,latest=0,session=null,touchActive=false,sensorRequest=0;
const identityKey='pioneer-phone-id';let id=localStorage.getItem(identityKey);if(!id){id=crypto.randomUUID?.()||`p-${Date.now()}-${Math.random().toString(36).slice(2)}`;localStorage.setItem(identityKey,id);}
function labels(){for(const [i,key] of ['one','two'].entries()){$('join-'+key).textContent=teams[i].toLocaleUpperCase('ru');$('result-'+key+'-name').textContent=teams[i].toLocaleUpperCase('ru');}}
labels();function screen(name){for(const key of ['join','wait','race','result'])$(key+'-screen').hidden=key!==name;}
function indicate(v){const value=Math.max(-1,Math.min(1,v));$('needle').style.left=`${(value+1)*50}%`;$('direction').textContent=value<-.12?'← ПОВОРАЧИВАЕШЬ ВЛЕВО':value>.12?'ПОВОРАЧИВАЕШЬ ВПРАВО →':'↑ ДВИЖЕШЬСЯ ПРЯМО';}
const hub=new ARGameSensors.SensorController({maxHz:20,onSample:(channel,sample)=>{if(channel!=='orientation'||touchActive)return;const angle=screenAngle(),landscape=Math.abs(angle)%180===90,sign=angle===270||angle===-90?-1:1;latest=landscape?(sample.relative?.beta??sample.beta??0)*sign:(sample.relative?.gamma??sample.gamma??0);indicate(latest/27);if(game.phase==='race'&&game.activePlayer===player)client?.sendSensor('orientation',{alpha:sample.alpha,beta:sample.beta,gamma:sample.gamma,relative:{beta:latest}});},onState:()=>{}});
function requestLandscape(){try{const lock=()=>window.screen.orientation?.lock?.('landscape')?.catch(()=>{});if(document.documentElement?.requestFullscreen&&!document.fullscreenElement){document.documentElement.requestFullscreen().then(lock).catch(()=>{});}else lock();}catch{}}
function screenAngle(){return window.screen.orientation?.angle??window.orientation??0;}
function update(s){game=s||{};if(game.phoneSession&&session!==game.phoneSession){const changed=session!==null;session=game.phoneSession;if(changed){sensorRequest++;hub.stop();sensorActive=false;latest=0;indicate(0);$('enable-sensor').hidden=false;$('sensor-status').textContent='';}}if(Array.isArray(game.teams)&&game.teams.length===2){teams=game.teams.map(v=>String(v).slice(0,24));labels();}if(!player)return;
if(game.phase==='finished'){screen('result');$('title').textContent='Итоги заезда';$('result-one').textContent=game.scores?.[0]||0;$('result-two').textContent=game.scores?.[1]||0;}
else if(game.phase==='race'&&game.activePlayer===player){screen('race');$('title').textContent='Управляй наклоном телефона';}
else{screen('wait');$('title').textContent=game.phase==='paused'?'Пауза':'Ожидание заезда';$('wait-caption').textContent=game.phase==='countdown'?'СТАРТ ЧЕРЕЗ':game.activePlayer&&game.activePlayer!==player?'ЕДЕТ ДРУГАЯ КОМАНДА':'ЖДЁМ СТАРТА';$('countdown').textContent=game.phase==='countdown'?game.countdown||3:'❄';}}
async function join(team){if(player)return;player=team;screen('wait');$('title').textContent='Ожидание заезда';$('sensor-controls').hidden=false;requestLandscape();
// Called directly from the team-button gesture for iOS sensor permission.
const sensorPromise=enableSensor();
const mode=params.get('mode')==='lan'?'lan':'internet';const connection=mode==='lan'?{mode,url:params.get('relay')||`${location.protocol==='https:'?'wss':'ws'}://${location.host}`}:{mode,configUrl:params.get('config')||ARConnect.defaultConfigUrl};
client=new ARConnect.Client({...connection,room,gameId,role:'player',team,clientId:id,capabilities:['orientation'],onState:message=>{$('connection').textContent=message;},onGameState:m=>update(m.state),onEvent:m=>{if(m.type==='joined')client.sendCommand('player.join',{name:teams[player-1]});}});client.start();
await sensorPromise;}
$('join-one').onclick=()=>join(1);$('join-two').onclick=()=>join(2);
$('calibrate').onclick=()=>{hub.calibrate();latest=0;indicate(0);$('sensor-status').textContent='Центр установлен';};
async function enableSensor(){const request=++sensorRequest;hub.stop();let active=false;try{active=await hub.start('orientation');}catch{}if(request!==sensorRequest){hub.stop();return;}sensorActive=active;$('enable-sensor').hidden=active;$('sensor-status').textContent=active?'':'Наклон недоступен. Веди пальцем по шкале; доступ можно повторить в настройках браузера.';}
$('enable-sensor').onclick=()=>{enableSensor();requestLandscape();};
const panel=document.querySelector('.steer-panel');let touchTimer=null,touchValue=0;
function sendTouch(){if(game.phase==='race'&&game.activePlayer===player)client?.sendCommand('steer.touch',{value:touchValue});indicate(touchValue);}
function moveTouch(e){const rect=panel.getBoundingClientRect();touchValue=Math.max(-1,Math.min(1,(e.clientX-rect.left)/rect.width*2-1));sendTouch();}
panel.addEventListener('pointerdown',e=>{e.preventDefault();panel.setPointerCapture?.(e.pointerId);touchActive=true;moveTouch(e);clearInterval(touchTimer);touchTimer=setInterval(sendTouch,80);});
panel.addEventListener('pointermove',e=>{if(touchActive)moveTouch(e);});
function stopTouch(){if(!touchActive)return;clearInterval(touchTimer);touchActive=false;touchValue=0;sendTouch();}
for(const event of ['pointerup','pointercancel','lostpointercapture'])panel.addEventListener(event,stopTouch);
window.addEventListener('blur',stopTouch);
if(!/^[A-Z0-9]{4,8}$/.test(room)){$('sensor-status').textContent='Открой QR-код на экране ведущего';$('join-one').disabled=$('join-two').disabled=true;}
window.addEventListener('pagehide',()=>{stopTouch();sensorRequest++;hub.stop();client?.stop();});
})();
