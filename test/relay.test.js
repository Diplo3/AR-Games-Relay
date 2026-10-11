const {test}=require('node:test');
const assert=require('node:assert/strict');
const {WebSocket}=require('ws');
const {createRelay}=require('../server');
const {Client}=require('../public/connect');
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
test('20 phones / two teams: 2000 unique commands processed by HOST',async t=>{
 const {url}=await fixture(t);const commands=[];const h=sdk(t,url,{role:'host',onCommand:m=>commands.push(m)});await wait(()=>h.ready);
 const phones=Array.from({length:20},(_,i)=>sdk(t,url,{role:'player',team:i%2+1}));await wait(()=>phones.every(p=>p.ready));
 for(const p of phones)for(let i=0;i<100;i++)p.press(i%2?'JMI2':'JMI1');
 await wait(()=>phones.every(p=>p.stats.received===100),30000);
 assert.equal(commands.length,2000);assert.equal(new Set(commands.map(m=>m.eventId)).size,2000);
 assert.equal(commands.filter(m=>m.team===1).length,1000);assert.equal(commands.filter(m=>m.team===2).length,1000);
 for(const p of phones){assert.equal(p.queue.length,0);assert.equal(p.stats.lost,0);}
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
