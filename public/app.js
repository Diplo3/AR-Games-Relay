const $=id=>document.getElementById(id);
const params=new URLSearchParams(location.search);for(const id of ['room','role','team'])if(params.has(id))$(id).value=params.get(id);
const clientId=sessionStorage.arV3Device||(sessionStorage.arV3Device=crypto.randomUUID());
let client,testTimer,players=0,hostOnline=false,lastTestTotal=0,roomDevices=[];
const labels={sent:'Отправлено',received:'Получено HOST',lost:'Потеряно',duplicates:'Дубли',pending:'Ожидает',reconnects:'Reconnect',players:'Телефонов',rtt:'RTT сейчас',rttMin:'RTT min',rttAvg:'RTT avg',rttMax:'RTT max'};
function stats(s={}){if(lastTestTotal&&!testTimer)$('testStatus').textContent=`Тест: создано ${lastTestTotal}; ожидает подтверждения: ${s.pending??0}`;const values={...s,players,rttAvg:s.rttCount?Math.round(s.rttTotal/s.rttCount):null};if(client?.role==='host'){values.sent=roomDevices.reduce((n,d)=>n+(d.sent??d.accepted),0);values.lost=roomDevices.reduce((n,d)=>n+(d.lost??0),0);values.pending=roomDevices.reduce((n,d)=>n+(d.clientPending??d.pending),0);} $('stats').replaceChildren(...Object.entries(labels).map(([k,label])=>{const div=document.createElement('div');div.className='stat';div.textContent=label;const n=document.createElement('div');n.className='num';n.textContent=values[k]??'—';if(k.startsWith('rtt')&&values[k]!=null)n.textContent+=' мс';div.append(n);return div;}));}
function log(text){$('log').textContent=(new Date().toLocaleTimeString()+' '+text+'\n'+$('log').textContent).slice(0,16000);}
function stop(){clearInterval(testTimer);testTimer=null;}
function burst(n){if(!client||client.role!=='player'||testTimer)return;let sent=0;lastTestTotal=0;const interval=Math.max(5,Math.min(10000,Number($('interval').value)||20));n=Math.max(1,Math.min(5000,Math.floor(n)||100));testTimer=setInterval(()=>{if(!client.ready||!hostOnline){$('testStatus').textContent=`Пауза: нет связи с HOST. ${sent}/${n}`;return;}if(!client.press(sent%2?'JMI2':'JMI1')){stop();return;}sent++;lastTestTotal=sent;$('testStatus').textContent=`Создано ${sent}/${n}; ожидает подтверждения: ${client.queue.length}`;if(sent===n)stop();},interval);}
$('connect').onclick=()=>{
 stop();client?.stop();const room=$('room').value.toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,8);if(room.length<4){$('status').textContent='Введите комнату: 4–8 букв или цифр';return;}
 client=new ARConnect.Client({url:(location.protocol==='https:'?'wss:':'ws:')+'//'+location.host,room,role:$('role').value,team:Number($('team').value),clientId,
 onState:s=>$('status').textContent=s,onStats:stats,onCommand:m=>log(`← TEAM ${m.team}: ${m.button} #${m.seq} от ${m.clientId.slice(0,8)}`),onEvent:m=>{
 if(m.type==='room_stats'){players=m.players;hostOnline=m.hostOnline;roomDevices=m.devices||[];stats({...client.stats,pending:client.queue.length});$('devices').replaceChildren(...(m.devices||[]).map(d=>{const row=document.createElement('tr');for(const value of [d.clientId.slice(0,8),d.team,d.online?'Онлайн':'Отключён',d.sent??'—',d.accepted,d.received,d.lost??0,d.clientPending??d.pending,d.duplicates,d.reconnects,[d.rttMin??'—',d.rttAvg??'—',d.rttMax??'—'].join(' / ')]){const cell=document.createElement('td');cell.textContent=value;row.append(cell);}return row;}));}
 if(m.type==='error')log(m.message);
 }});
 $('team').value=String(client.team);$('identity').textContent=`ID: ${clientId} · TEAM ${client.team}`;
 for(const id of ['room','role','team'])$(id).disabled=true;$('connect').disabled=true;
 for(const id of ['jmi1','jmi2','burst','custom'])$(id).disabled=client.role!=='player';
 $('links').replaceChildren(...[1,2].map(team=>{const a=document.createElement('a');const u=new URL(location.href);u.search=new URLSearchParams({room,role:'player',team});a.href=u;a.textContent=`TEAM ${team} — открыть на телефоне `;return a;}));client.start();
};
$('jmi1').onclick=()=>client?.press('JMI1');$('jmi2').onclick=()=>client?.press('JMI2');$('burst').onclick=()=>burst(100);$('custom').onclick=()=>burst(Number($('count').value));$('stop').onclick=stop;stats();
for(const id of ['jmi1','jmi2','burst','custom'])$(id).disabled=true;
if(params.get('role')==='player')$('connect').click();
