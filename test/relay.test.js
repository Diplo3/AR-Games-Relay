const {test}=require('node:test');
const assert=require('node:assert/strict');
const {WebSocket}=require('ws');
const {createRelay}=require('../server');
const {Client,chooseEndpoint,loadRelayConfig,defaultConfigUrl}=require('../public/connect');
const {SensorHub}=require('../public/motion');
const wait=async(predicate,ms=15000)=>{const end=Date.now()+ms;while(!predicate()){if(Date.now()>end)throw new Error('timeout');await new Promise(r=>setTimeout(r,20));}};
const memory=()=>{const m=new Map();return{getItem:k=>m.get(k),setItem:(k,v)=>m.set(k,v)};};
async function fixture(t){const r=createRelay();await new Promise(resolve=>r.server.listen(0,'127.0.0.1',resolve));t.after(()=>r.close());return{r,url:`ws://127.0.0.1:${r.server.address().port}`};}
async function raw(url,join){const ws=new WebSocket(url);const messages=[];ws.on('message',b=>messages.push(JSON.parse(b)));await new Promise(r=>ws.on('open',r));ws.send(JSON.stringify({type:'join',room:'TEST01',clientId:'raw',role:'player',...join}));await wait(()=>messages.some(m=>m.type==='joined'));return{ws,messages};}
function sdk(t,url,opts){const c=new Client({url,room:'TEST01',clientId:crypto.randomUUID(),storage:memory(),WebSocket,...opts});t.after(()=>c.stop());c.start();return c;}
test('v0.2 contract: 100 commands, 100 broadcasts and acknowledgements',async t=>{
 const {url}=await fixture(t);const h=await raw(url,{role:'host',clientId:'host'}),p=await raw(url,{});
 for(let seq=1;seq<=100;seq++)p.ws.send(JSON.stringify({type:'button',button:'JMI1',seq,clientTs:Date.now()}));
 await wait(()=>h.messages.filter(m=>m.type==='button').length===100&&p.messages.filter(m=>m.type==='ack').length===100);
 assert.deepEqual(h.messages.filter(m=>m.type==='button').map(m=>m.seq),Array.from({length:100},(_,i)=>i+1));h.ws.close();p.ws.close();
});
test('50 phones / two teams: 5000 commands and 1000 sensor samples reach HOST',async t=>{
 const {url}=await fixture(t);const commands=[],sensors=[];const h=sdk(t,url,{role:'host',onCommand:m=>commands.push(m),onSensor:m=>sensors.push(m)});await wait(()=>h.ready);
 const phones=Array.from({length:50},(_,i)=>sdk(t,url,{role:'player',team:i%2+1,gameId:'arcade.future'}));await wait(()=>phones.every(p=>p.ready));
 for(const p of phones)for(let i=0;i<100;i++)p.press(i%2?'JMI2':'JMI1');
 await wait(()=>phones.every(p=>p.stats.received===100),60000);
 assert.equal(commands.length,5000);assert.equal(new Set(commands.map(m=>m.eventId)).size,5000);
 assert.equal(commands.filter(m=>m.team===1).length,2500);assert.equal(commands.filter(m=>m.team===2).length,2500);
 assert.ok(commands.every(m=>m.type==='command'&&m.gameId==='arcade.future'&&m.action==='button.press'));
 assert.equal(commands.filter(m=>m.payload.button==='JMI1').length,2500);assert.equal(commands.filter(m=>m.payload.button==='JMI2').length,2500);
 for(const p of phones){assert.equal(p.queue.length,0);assert.equal(p.stats.lost,0);}
 for(const p of phones)for(let i=0;i<20;i++)assert.equal(p.sendSensor('gyroscope',{x:i/100,y:p.team,z:0.3}),true);
 await wait(()=>sensors.length===1000);assert.equal(new Set(sensors.map(m=>`${m.clientId}:${m.seq}`)).size,1000);
 assert.equal(sensors.filter(m=>m.team===1).length,500);assert.ok(sensors.every(m=>m.channel==='gyroscope'&&m.gameId==='arcade.future'));
});
test('player reconnect, offline queue, preserved team/session and reload',async t=>{
 const {url}=await fixture(t),commands=[];const h=sdk(t,url,{role:'host',onCommand:m=>commands.push(m)});const storage=memory();
 const p=sdk(t,url,{role:'player',team:2,clientId:'phone',storage});await wait(()=>h.ready&&p.ready);p.press('JMI1');await wait(()=>p.stats.received===1);
 const session=p.sessionId;p.ws.terminate();await wait(()=>!p.ready);p.press('JMI2');await wait(()=>p.stats.received===2);
 assert.ok(p.stats.reconnects>=1);assert.equal(p.team,2);assert.equal(p.sessionId,session);
 p.stop();const replacement=sdk(t,url,{role:'player',team:1,clientId:'phone',storage});await wait(()=>replacement.ready);replacement.press('JMI1');await wait(()=>replacement.stats.received===3);
 assert.equal(replacement.team,2);assert.equal(replacement.seq,3);assert.equal(commands.length,3);
});
test('HOST outage, ACK loss and persisted deduplication',async t=>{
 const {url}=await fixture(t),commands=[],storage=memory();let h=sdk(t,url,{role:'host',clientId:'host',storage,onCommand:m=>commands.push(m)});const p=sdk(t,url,{role:'player'});await wait(()=>h.ready&&p.ready);
 const original=h.send.bind(h);h.send=m=>{if(m.type!=='host_ack')original(m);};p.press('JMI1');await wait(()=>commands.length===1);
 h.stop();await new Promise(r=>setTimeout(r,50));p.press('JMI2');assert.equal(p.stats.received,0);
 h=sdk(t,url,{role:'host',clientId:'host',storage,onCommand:m=>commands.push(m)});await wait(()=>p.stats.received===2);
 assert.equal(commands.length,2);assert.ok(h.stats.duplicates>=1);assert.equal(p.queue.length,0);
});
test('room isolation, unauthorized ACK, malformed messages, expired commands',async t=>{
 const {url}=await fixture(t);const h=await raw(url,{role:'host',clientId:'host',room:'OTHER1'});const p=await raw(url,{protocol:3,sessionId:'s',team:2});
 p.ws.send('null');p.ws.send(JSON.stringify({type:'host_ack',eventId:'fake'}));
 p.ws.send(JSON.stringify({type:'button',button:'JMI1',seq:1,sessionId:'s',clientTs:Date.now()-1800001}));
 await wait(()=>p.messages.filter(m=>m.type==='error').length===3);assert.equal(h.messages.filter(m=>m.type==='button').length,0);p.ws.close();h.ws.close();
});
test('relay restart: pending command replayed without a second HOST action',async t=>{
 let r=createRelay();await new Promise(resolve=>r.server.listen(0,'127.0.0.1',resolve));const port=r.server.address().port;
 t.after(()=>r.close());const url=`ws://127.0.0.1:${port}`,commands=[];
 const h=sdk(t,url,{role:'host',onCommand:m=>commands.push(m)}),p=sdk(t,url,{role:'player',team:2});await wait(()=>h.ready&&p.ready);
 const send=h.send.bind(h);h.send=m=>{if(m.type!=='host_ack')send(m);};p.press('JMI1');await wait(()=>commands.length===1);
 await r.close();h.send=send;r=createRelay();await new Promise(resolve=>r.server.listen(port,'127.0.0.1',resolve));
 await wait(()=>p.stats.received===1);assert.equal(commands.length,1);assert.equal(p.queue.length,0);assert.equal(p.team,2);
});
test('expired local queue counts loss; live pending commands are not lost',async t=>{
 const p=new Client({url:'ws://unused',room:'TEST01',role:'player',clientId:'phone',storage:memory()});p.press('JMI1');assert.equal(p.stats.lost,0);assert.equal(p.queue.length,1);p.queue[0].clientTs=Date.now()-1800001;p.flush();assert.equal(p.stats.lost,1);assert.equal(p.queue.length,0);
});
test('remote config switches endpoint without game-code changes and uses cache offline',async()=>{
 const data=new Map(),storage={getItem:k=>data.get(k),setItem:(k,v)=>data.set(k,v)};
 const manifest={schemaVersion:1,revision:4,endpoints:{internet:'wss://new.example.test',lan:'ws://192.168.1.2:3000'}};
 const fetch=async()=>({ok:true,json:async()=>manifest});
 assert.equal((await loadRelayConfig({configUrl:defaultConfigUrl,fetch,storage})).endpoint,'wss://new.example.test/');
 assert.equal(chooseEndpoint(manifest,'lan'),'ws://192.168.1.2:3000/');
 const offline=await loadRelayConfig({configUrl:defaultConfigUrl,fetch:async()=>{throw Error('offline');},storage});
 assert.equal(offline.endpoint,'wss://new.example.test/');assert.equal(offline.stale,true);
 assert.throws(()=>chooseEndpoint({schemaVersion:1,endpoints:{internet:'ws://insecure.example.test'}},'internet'),/No valid internet endpoint/);
});
test('health reports default 50 phone capacity and config manifest is served',async t=>{
 const {r}=await fixture(t);const base=`http://127.0.0.1:${r.server.address().port}`;
 const health=await fetch(base+'/health').then(x=>x.json());assert.equal(health.maxPhones,50);assert.equal(health.version,'0.4.0');
 const config=await fetch(base+'/relay-config.json').then(x=>x.json());assert.equal(config.limits.maxPhonesPerRoom,50);
});
test('future game actions carry game id and structured payload through the stable protocol',async t=>{
 const {url}=await fixture(t),actions=[];const h=sdk(t,url,{role:'host',gameId:'racing.next',onCommand:m=>actions.push(m)});
 const p=sdk(t,url,{role:'player',gameId:'racing.next'});await wait(()=>h.ready&&p.ready);
 assert.equal(p.sendCommand('race.lap.finished',{lap:3,elapsedMs:60421,checkpoint:'C7'}),true);
 await wait(()=>actions.length===1&&p.stats.received===1);
 assert.deepEqual({gameId:actions[0].gameId,action:actions[0].action,payload:actions[0].payload,team:actions[0].team},{gameId:'racing.next',action:'race.lap.finished',payload:{lap:3,elapsedMs:60421,checkpoint:'C7'},team:1});
});
test('client switches relay endpoints from the remote manifest and keeps session',async t=>{
 class FakeSocket{
  static instances=[];
  constructor(url){this.url=url;this.readyState=0;this.sent=[];FakeSocket.instances.push(this);}
  open(){this.readyState=1;this.onopen?.();}
  send(raw){this.sent.push(JSON.parse(raw));}
  receive(message){this.onmessage?.({data:JSON.stringify(message)});}
  close(code=1000,reason=''){this.readyState=3;this.onclose?.({code,reason});}
 }
 let endpoint='wss://relay-a.example',manifest={schemaVersion:1,revision:1,endpoints:{internet:endpoint}};
 const storage=memory(),client=new Client({configUrl:defaultConfigUrl,fetch:async()=>({ok:true,json:async()=>manifest}),room:'TEST01',role:'player',team:2,clientId:'stable-phone',storage,WebSocket:FakeSocket});
 t.after(()=>client.stop());client.start();await wait(()=>FakeSocket.instances.length===1);const first=FakeSocket.instances[0];first.open();
 assert.equal(first.sent[0].type,'join');first.receive({type:'joined'});await wait(()=>client.ready);
 const session=client.sessionId;endpoint='wss://relay-b.example';manifest={schemaVersion:1,revision:2,endpoints:{internet:endpoint}};await client.refreshConfig();
 await wait(()=>FakeSocket.instances.length===2);const second=FakeSocket.instances[1];assert.equal(second.url,'wss://relay-b.example/');second.open();
 assert.equal(second.sent[0].clientId,'stable-phone');assert.equal(second.sent[0].team,2);assert.equal(second.sent[0].sessionId,session);
});
test('generic sensor channels reach HOST without entering the reliable command queue',async t=>{
 const {url}=await fixture(t),samples=[];const h=sdk(t,url,{role:'host',gameId:'ar.sensor.game',onSensor:m=>samples.push(m)});
 const p=sdk(t,url,{role:'player',gameId:'ar.sensor.game'});await wait(()=>h.ready&&p.ready);
 assert.equal(p.sendSensor('gyroscope',{x:0.1,y:-0.2,z:0.3}),true);
 assert.equal(p.sendSensor('geolocation',{latitude:55.75,longitude:37.61,accuracy:12}),true);
 await wait(()=>samples.length===2);
 assert.deepEqual(samples.map(({channel,sample,team,gameId})=>({channel,sample,team,gameId})),[
  {channel:'gyroscope',sample:{x:0.1,y:-0.2,z:0.3},team:1,gameId:'ar.sensor.game'},
  {channel:'geolocation',sample:{latitude:55.75,longitude:37.61,accuracy:12},team:1,gameId:'ar.sensor.game'}
 ]);
 assert.equal(p.queue.length,0);assert.equal(p.stats.sent,0);
});
test('sensor hub requests access from start gesture, throttles samples and supports custom sources',async()=>{
 const listeners=new Map(),removed=[];let permissionCalls=0,samples=[];
 const win={isSecureContext:true,location:{hostname:'example.test'},DeviceOrientationEvent:{requestPermission:async()=>{permissionCalls++;return'granted';}},addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:name=>{removed.push(name);listeners.delete(name);}};
 const hub=new SensorHub({windowRef:win,navigatorRef:{},maxHz:20,onSample:(...x)=>samples.push(x)});
 assert.ok(hub.available().includes('orientation'));assert.equal(await hub.start('orientation'),true);assert.equal(permissionCalls,1);
 const event={alpha:180,beta:20,gamma:-10,absolute:true};listeners.get('deviceorientation')(event);listeners.get('deviceorientation')(event);assert.equal(samples.length,0);
 await new Promise(r=>setTimeout(r,60));assert.equal(samples.length,1);listeners.get('deviceorientation')(event);await new Promise(r=>setTimeout(r,60));assert.equal(samples.length,2);hub.stop('orientation');assert.deepEqual(removed,['deviceorientation']);
 hub.register('custom.temperature',({emit})=>{emit({celsius:21.5});return()=>{};});assert.ok(hub.available().includes('custom.temperature'));assert.equal(await hub.start('custom.temperature'),true);await new Promise(r=>setTimeout(r,60));assert.deepEqual(samples.at(-1).slice(0,2),['custom.temperature',{celsius:21.5}]);hub.stop();
});
test('sensor hub handles denied permission and insecure web origins',async()=>{
 const base={location:{hostname:'game.test'},addEventListener(){},removeEventListener(){}};
 const denied=new SensorHub({windowRef:{...base,isSecureContext:true,DeviceOrientationEvent:{requestPermission:async()=>'denied'}},navigatorRef:{}});
 assert.equal(await denied.start('orientation'),false);
 const insecure=new SensorHub({windowRef:{...base,isSecureContext:false,DeviceOrientationEvent:{}},navigatorRef:{}});
 assert.equal(await insecure.start('orientation'),false);
});
