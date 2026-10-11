(function(root,factory){if(typeof module==='object')module.exports=factory();else root.ARConnect=factory();})(globalThis,()=>{
 class Client {
  constructor(options){
   Object.assign(this,{WebSocket:globalThis.WebSocket,storage:globalThis.localStorage,onEvent:()=>{},onState:()=>{},onStats:()=>{},onCommand:()=>{},...options});
   this.key=`ar-v3:${this.room}:${this.role}:${this.clientId}`;
   let saved;try{saved=JSON.parse(this.storage?.getItem(this.key)||'null');}catch{}
   this.sessionId=saved?.sessionId||globalThis.crypto.randomUUID();this.seq=saved?.seq||0;
   this.team=saved?.team||this.team||1;this.queue=saved?.queue||[];this.seen=new Map(saved?.seen||[]);
   this.stats=saved?.stats||{sent:0,received:0,lost:0,duplicates:0,reconnects:0,rttCount:0,rttTotal:0,rttMin:null,rttMax:null,rtt:null};
   this.running=false;this.ready=false;this.attempt=0;this.everJoined=false;
  }
  persist(){this.storage?.setItem(this.key,JSON.stringify({sessionId:this.sessionId,seq:this.seq,team:this.team,queue:this.queue,seen:[...this.seen],stats:this.stats}));this.onStats({...this.stats,pending:this.queue.length,accepted:this.queue.filter(e=>e.accepted).length});}
  start(){if(this.running)return;this.running=true;this.connect();this.tick=setInterval(()=>this.flush(),1000);}
  stop(){this.running=false;this.ready=false;clearTimeout(this.reconnect);clearInterval(this.tick);this.ws?.close();}
  connect(){
   if(!this.running)return;this.onState('Подключение…');const ws=this.ws=new this.WebSocket(this.url);
   const connectTimeout=setTimeout(()=>{if(this.ws===ws&&!this.ready)ws.close();},10000);
   ws.onopen=()=>{clearTimeout(connectTimeout);this.send({type:'join',protocol:3,room:this.room,role:this.role,clientId:this.clientId,sessionId:this.sessionId,team:this.team});};
   ws.onmessage=e=>{if(this.ws!==ws)return;this.message(JSON.parse(e.data));};
   ws.onerror=()=>{};
   ws.onclose=e=>{clearTimeout(connectTimeout);if(this.ws!==ws)return;this.ready=false;if(e.code===4001){this.stop();return this.onState('Это устройство подключено в другой вкладке');}this.onState('Нет связи — переподключение…');if(this.running)this.reconnect=setTimeout(()=>this.connect(),Math.min(10000,500*2**Math.min(this.attempt++,5))+Math.random()*300);};
  }
  send(m){if(this.ws?.readyState===1)this.ws.send(JSON.stringify(m));}
  message(m){
   if(m.type==='joined'){if(this.everJoined)this.stats.reconnects++;this.everJoined=true;this.attempt=0;this.ping=null;this.ready=true;this.onState('Подключено');this.persist();this.flush();}
   if(m.type==='button'&&this.role==='host'){
    if(!m.eventId){this.stats.received++;this.onCommand(m);this.persist();}
    else{
     if(!this.seen.has(m.eventId)){this.onCommand(m);this.seen.set(m.eventId,Date.now());this.stats.received++;this.persist();}
     else{this.stats.duplicates++;this.persist();}
     this.send({type:'host_ack',eventId:m.eventId});
    }
   }
   if(m.type==='ack'&&m.sessionId===this.sessionId){const q=this.queue.find(q=>q.seq===m.seq);if(q){q.accepted=true;if(m.duplicate)this.stats.duplicates++;this.persist();}}
   if((m.type==='delivered'||m.type==='ack'&&m.delivered)&&m.sessionId===this.sessionId){
    const i=this.queue.findIndex(q=>q.seq===m.seq);if(i>=0){this.queue.splice(i,1);this.stats.received++;this.persist();}
   }
   if(m.type==='pong_app'&&this.ping&&m.id===this.ping.id){const ms=Date.now()-this.ping.time;Object.assign(this.stats,{rtt:ms,rttCount:this.stats.rttCount+1,rttTotal:this.stats.rttTotal+ms,rttMin:this.stats.rttMin===null?ms:Math.min(ms,this.stats.rttMin),rttMax:this.stats.rttMax===null?ms:Math.max(ms,this.stats.rttMax)});this.ping=null;this.persist();}
   if(m.type==='error'){
    if(['command_expired','invalid_command','sequence_conflict','session_mismatch'].includes(m.message)){const i=this.queue.findIndex(q=>q.seq===m.seq);if(i>=0){this.queue.splice(i,1);this.stats.lost++;this.persist();}}
    if(['room_required','host_already_connected','device_capacity','room_capacity'].includes(m.message))this.stop();
    this.onState(`Ошибка: ${m.message}`);
   }
   this.onEvent(m);
  }
  press(button){if(this.role!=='player')return false;if(this.queue.length>=5000){this.onState('Очередь заполнена');return false;}this.queue.push({type:'button',button,seq:++this.seq,sessionId:this.sessionId,clientTs:Date.now()});this.stats.sent++;this.persist();this.flush();return true;}
  flush(){
   const now=Date.now();const expired=this.queue.filter(q=>now-q.clientTs>1800000);if(expired.length){this.stats.lost+=expired.length;this.queue=this.queue.filter(q=>now-q.clientTs<=1800000);this.persist();}
   for(const[id,ts]of this.seen)if(now-ts>1860000)this.seen.delete(id);
   if(!this.ready)return;
   if(this.ping&&now-this.ping.time>10000){this.ws.close();return;}
   if(!this.ping){this.ping={id:globalThis.crypto.randomUUID(),time:now};this.send({type:'ping_app',id:this.ping.id,clientTs:now});}
   if(this.role==='player'&&(!this.lastMetrics||now-this.lastMetrics>2000)){this.lastMetrics=now;this.send({type:'metrics',sent:this.stats.sent,lost:this.stats.lost,pending:this.queue.length,rtt:this.stats.rtt,rttMin:this.stats.rttMin,rttMax:this.stats.rttMax,rttAvg:this.stats.rttCount?Math.round(this.stats.rttTotal/this.stats.rttCount):null});}
   for(const q of this.queue)if(!q.lastAttempt||now-q.lastAttempt>3000){q.lastAttempt=now;this.send(q);}
  }
 }
 return{Client};
});
