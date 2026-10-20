(()=>{'use strict';
const $=id=>document.getElementById(id),params=new URLSearchParams(location.search),room=params.get('room')||'',gameId='ar.pioneer.sled';
let teams=['Синие','Красные'];try{const names=JSON.parse(params.get('teams')||'null');if(Array.isArray(names)&&names.length===2)teams=names.map(v=>String(v).slice(0,24));}catch{}
let player=0,client=null,game={},sensorActive=false,latest=0;
const identityKey='pioneer-phone-id';let id=localStorage.getItem(identityKey);if(!id){id=crypto.randomUUID?.()||`p-${Date.now()}-${Math.random().toString(36).slice(2)}`;localStorage.setItem(identityKey,id);}
function labels(){for(const [i,key] of ['one','two'].entries()){$('join-'+key).textContent=teams[i].toLocaleUpperCase('ru');$('result-'+key+'-name').textContent=teams[i].toLocaleUpperCase('ru');}}
labels();function screen(name){for(const key of ['join','wait','race','result'])$(key+'-screen').hidden=key!==name;}
function indicate(v){const value=Math.max(-1,Math.min(1,v));$('needle').style.left=`${(value+1)*50}%`;$('direction').textContent=value<-.12?'← ПОВОРАЧИВАЕШЬ ВЛЕВО':value>.12?'ПОВОРАЧИВАЕШЬ ВПРАВО →':'↑ ДВИЖЕШЬСЯ ПРЯМО';}
const hub=new ARGameSensors.SensorController({maxHz:20,onSample:(channel,sample)=>{if(channel!=='orientation')return;const angle=screenAngle(),sign=angle===270||angle===-90?-1:1;latest=(sample.relative?.beta??sample.beta??0)*sign;indicate(latest/27);if(game.phase==='race'&&game.activePlayer===player)client?.sendSensor('orientation',{alpha:sample.alpha,beta:sample.beta,gamma:sample.gamma,relative:{beta:latest}});},onState:(_channel,message)=>{$('sensor-status').textContent=message;}});
function screenAngle(){return window.screen.orientation?.angle??window.orientation??90;}
function update(s){game=s||{};if(Array.isArray(game.teams)&&game.teams.length===2){teams=game.teams.map(v=>String(v).slice(0,24));labels();}if(!player)return;
if(game.phase==='finished'){screen('result');$('title').textContent='Итоги заезда';$('result-one').textContent=game.scores?.[0]||0;$('result-two').textContent=game.scores?.[1]||0;}
else if(game.phase==='race'&&game.activePlayer===player){screen('race');$('title').textContent='Управляй наклоном телефона';$('race-info').textContent=`${teams[player-1]} · ${game.points||0} очков · ${Math.ceil(game.seconds||0)} сек`;}
else{screen('wait');$('title').textContent=game.phase==='paused'?'Пауза':'Ожидание заезда';$('wait-caption').textContent=game.phase==='countdown'?'СТАРТ ЧЕРЕЗ':game.activePlayer&&game.activePlayer!==player?'ЕДЕТ ДРУГАЯ КОМАНДА':'ЖДЁМ СТАРТА';$('countdown').textContent=game.phase==='countdown'?game.countdown||3:'❄';$('wait-team').textContent=teams[player-1]+' · держи телефон горизонтально';}}
async function join(team){if(player)return;player=team;screen('wait');$('title').textContent='Ожидание заезда';$('wait-team').textContent=teams[team-1];try{window.screen.orientation?.lock?.('landscape')?.catch(()=>{});}catch{}
// Called directly from the team-button gesture for iOS sensor permission.
const sensorPromise=hub.start('orientation');
const mode=params.get('mode')==='lan'?'lan':'internet';const connection=mode==='lan'?{mode,url:params.get('relay')||`${location.protocol==='https:'?'wss':'ws'}://${location.host}`}:{mode,configUrl:params.get('config')||ARConnect.defaultConfigUrl};
client=new ARConnect.Client({...connection,room,gameId,role:'player',team,clientId:id,capabilities:['orientation'],onState:message=>{$('connection').textContent=message;},onGameState:m=>update(m.state),onEvent:m=>{if(m.type==='joined')client.sendCommand('player.join',{name:teams[player-1]});}});client.start();
try{sensorActive=await sensorPromise;}catch{}$('sensor-status').textContent=sensorActive?'Наклон включён · держи телефон ровно и нажми «По центру»':'Датчик недоступен — используй стрелки. Для гироскопа подключись через интернет (HTTPS).';}
$('join-one').onclick=()=>join(1);$('join-two').onclick=()=>join(2);
$('calibrate').onclick=()=>{hub.calibrate();latest=0;indicate(0);$('sensor-status').textContent='Центр установлен';};
for(const [key,direction]of [['left',-1],['right',1]]){let timer;const stop=()=>{clearInterval(timer);timer=null;indicate(0);};$(key).addEventListener('pointerdown',e=>{e.preventDefault();$(key).setPointerCapture?.(e.pointerId);stop();const send=()=>{if(game.phase==='race'&&game.activePlayer===player)client?.sendCommand(direction<0?'steer.left':'steer.right',{});indicate(direction);};send();timer=setInterval(send,120);});for(const event of ['pointerup','pointercancel','lostpointercapture'])$(key).addEventListener(event,stop);}
if(!/^[A-Z0-9]{4,8}$/.test(room)){$('sensor-status').textContent='Открой QR-код на экране ведущего';$('join-one').disabled=$('join-two').disabled=true;}
window.addEventListener('pagehide',()=>{hub.stop();client?.stop();});
})();
