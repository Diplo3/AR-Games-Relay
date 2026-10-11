const express = require('express');
const http = require('http');
const path = require('path');
const { randomUUID } = require('crypto');
const { WebSocketServer, WebSocket } = require('ws');

function createRelay() {
 const app = express(), server = http.createServer(app);
 const wss = new WebSocketServer({ server, maxPayload: 16384 });
 const rooms = new Map(), epoch = randomUUID(), retentionMs = 1800000;
 const send = (w,m) => { if(w?.readyState === WebSocket.OPEN) w.send(JSON.stringify(m)); };
 const broadcast = (r,m,except) => { for(const w of r.sockets) if(w !== except) send(w,m); };
 const host = r => [...r.sockets].find(w => w.role === 'host');
 function presence(r) {
  if(r.presenceTimer)return;
  r.presenceTimer=setTimeout(()=>{
   r.presenceTimer=null;
   broadcast(r,{type:'room_stats',players:[...r.devices.values()].filter(d=>d.online).length,clients:r.sockets.size,
    hostOnline:!!host(r),epoch,serverTs:Date.now(),devices:[...r.devices.values()].map(d=>({...d}))});
  },100);
 }
 function cleanup(w) {
  const r=rooms.get(w.room); if(!r)return;
  r.sockets.delete(w);r.touched=Date.now();const d=r.devices.get(w.clientId);
  if(d && ![...r.sockets].some(s=>s.role==='player'&&s.clientId===w.clientId))d.online=false;
  presence(r);w.room=null;
 }
 function deliver(r,e) { const h=host(r);if(h){e.lastAttempt=Date.now();send(h,e.event);} }
 wss.on('connection',w=>{
  w.isAlive=true;w.on('pong',()=>w.isAlive=true);w.on('error',()=>{});
  w.on('message',raw=>{
   let m;try{m=JSON.parse(raw);}catch{return send(w,{type:'error',message:'invalid_json'});}
   if(!m||typeof m!=='object'||Array.isArray(m))return send(w,{type:'error',message:'invalid_message'});
   const error=message=>send(w,{type:'error',message,seq:m.seq});
   if(m.type==='join'){
    const code=String(m.room||'').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,8);
    if(code.length<4)return error('room_required');
    const role=m.role==='host'?'host':'player';let r=rooms.get(code);
    if(!r){if(rooms.size>=100)return error('room_capacity');rooms.set(code,r={sockets:new Set(),devices:new Map(),events:new Map(),touched:Date.now()});}
    if(role==='host'&&host(r)&&host(r)!==w)return error('host_already_connected');
    const id=String(m.clientId||'').slice(0,64)||randomUUID();
    if(role==='player'&&!r.devices.has(id)&&r.devices.size>=100)return error('device_capacity');
    cleanup(w);Object.assign(w,{room:code,role,clientId:id,relayProtocol:m.protocol===3?3:2,sessionId:String(m.sessionId||'legacy').slice(0,64),team:m.team===2?2:1});
    if(role==='player'){
     for(const old of [...r.sockets])if(old.role==='player'&&old.clientId===id){cleanup(old);old.close(4001,'replaced');}
     let d=r.devices.get(id);if(!d)r.devices.set(id,d={clientId:id,accepted:0,received:0,duplicates:0,reconnects:0,pending:0});else d.reconnects++;
     Object.assign(d,{team:w.team,online:true,lastSeen:Date.now()});
    }
    r.sockets.add(w);r.touched=Date.now();send(w,{type:'joined',room:code,role,clientId:id,team:w.team,epoch,protocol:3,retentionMs,serverTs:Date.now()});presence(r);
    if(role==='host')for(const e of r.events.values())if(!e.delivered)deliver(r,e);return;
   }
   const r=rooms.get(w.room);if(!r)return error('join_first');r.touched=Date.now();
   if(m.type==='ping_app')return send(w,{type:'pong_app',id:m.id,clientTs:m.clientTs,serverTs:Date.now()});
   if(m.type==='metrics'&&w.role==='player'){
    const d=r.devices.get(w.clientId);for(const k of ['sent','lost','pending','rtt','rttMin','rttMax','rttAvg'])if(Number.isFinite(m[k])&&m[k]>=0&&m[k]<=Number.MAX_SAFE_INTEGER)d[k==='pending'?'clientPending':k]=m[k];d.lastSeen=Date.now();return presence(r);
   }
   if(m.type==='host_ack'){
    if(w.role!=='host'||w.relayProtocol!==3)return error('host_required');const e=r.events.get(m.eventId);if(!e)return;
    if(!e.delivered){e.delivered=true;const d=r.devices.get(e.event.clientId);d.received++;d.pending=Math.max(0,d.pending-1);}
    for(const s of r.sockets)if(s.role==='player'&&s.clientId===e.event.clientId)send(s,{type:'delivered',eventId:m.eventId,seq:e.event.seq,sessionId:e.event.sessionId});
    return presence(r);
   }
   if(m.type!=='button')return error('unknown_type');
   // Preserve the verified v0.2 broadcast and acknowledgement contract.
   if(w.relayProtocol!==3){const e={type:'button',button:String(m.button||'').slice(0,30),seq:Number(m.seq)||0,clientId:w.clientId,clientTs:Number(m.clientTs)||0,serverTs:Date.now(),role:w.role,team:w.team};broadcast(r,e,w);return send(w,{type:'ack',seq:e.seq,clientTs:e.clientTs,serverTs:e.serverTs});}
   if(w.role!=='player')return error('player_required');
   if(!Number.isSafeInteger(m.seq)||m.seq<1||!['JMI1','JMI2'].includes(m.button))return error('invalid_command');
   if(m.sessionId!==w.sessionId)return error('session_mismatch');
   if(!Number.isFinite(m.clientTs)||Date.now()-m.clientTs>retentionMs||m.clientTs>Date.now()+60000)return error('command_expired');
   const eventId=JSON.stringify([w.clientId,w.sessionId,m.seq]),d=r.devices.get(w.clientId);d.lastSeen=Date.now();
   let e=r.events.get(eventId),duplicate=!!e;
   if(e){if(e.event.button!==m.button||e.event.team!==w.team)return error('sequence_conflict');d.duplicates++;}
   else{if(r.events.size>=20000)return error('command_capacity');e={event:{type:'button',eventId,clientId:w.clientId,sessionId:w.sessionId,seq:m.seq,team:w.team,button:m.button,clientTs:m.clientTs,serverTs:Date.now(),role:'player'},delivered:false,lastAttempt:0};r.events.set(eventId,e);d.accepted++;d.pending++;}
   send(w,{type:'ack',seq:m.seq,sessionId:w.sessionId,eventId,clientTs:m.clientTs,serverTs:Date.now(),duplicate,delivered:e.delivered});
   if(e.delivered)send(w,{type:'delivered',eventId,seq:m.seq,sessionId:w.sessionId});else deliver(r,e);presence(r);
  });w.on('close',()=>cleanup(w));
 });
 const retry=setInterval(()=>{const now=Date.now();for(const [code,r]of rooms){for(const [id,e]of r.events){if(now-e.event.clientTs>retentionMs){if(!e.delivered){const d=r.devices.get(e.event.clientId);if(d)d.pending=Math.max(0,d.pending-1);}r.events.delete(id);}else if(!e.delivered&&now-e.lastAttempt>2000)deliver(r,e);}if(!r.sockets.size&&now-r.touched>retentionMs){clearTimeout(r.presenceTimer);rooms.delete(code);}}},1000);
 const heartbeat=setInterval(()=>{for(const w of wss.clients){if(!w.isAlive)w.terminate();else{w.isAlive=false;w.ping();}}},25000);
 app.use(express.static(path.join(__dirname,'public')));
 app.get('/health',(_q,res)=>res.json({ok:true,service:'AR Games Relay',version:'0.3.0',clients:wss.clients.size,epoch}));
 return{server,wss,rooms,close:()=>new Promise(resolve=>{clearInterval(retry);clearInterval(heartbeat);for(const w of wss.clients)w.terminate();wss.close();server.close(resolve);})};
}
if(require.main===module)createRelay().server.listen(process.env.PORT||3000,'0.0.0.0',()=>console.log('AR Games Relay v0.3 listening'));
module.exports={createRelay};
