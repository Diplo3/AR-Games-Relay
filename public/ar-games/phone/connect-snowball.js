(function(root,factory){if(typeof module==='object')module.exports=factory();else root.ARConnect=factory();})(globalThis,()=>{
 const cacheKey='ar-connect:manifest:v1';
 const defaultConfigUrl='https://raw.githubusercontent.com/Diplo3/AR-Games-Relay/main/relay-config.json';
 function chooseEndpoint(manifest,mode='internet'){
  if(!manifest||manifest.schemaVersion!==1||!manifest.endpoints)throw new Error('Unsupported relay config');
  const candidates=Array.isArray(manifest.endpoints[mode])?manifest.endpoints[mode]:[manifest.endpoints[mode]];
  for(const value of candidates){if(!value)continue;let u;try{u=new URL(value);}catch{continue;}
   if(mode==='internet'&&u.protocol==='wss:')return u.href;
   if(mode==='lan'&&['ws:','wss:'].includes(u.protocol))return u.href;
  }
  throw new Error(`No valid ${mode} endpoint in relay config`);
 }
 async function loadRelayConfig({configUrl,mode='internet',fetch:fetchImpl=globalThis.fetch,storage,timeoutMs=5000}){
  const urls=Array.isArray(configUrl)?configUrl:[configUrl];let lastError;
  for(const address of urls.filter(Boolean))try{
   const u=new URL(address);u.searchParams.set('_relay_config',String(Date.now()));
   const response=await fetchImpl(u.href,{cache:'no-store',signal:AbortSignal.timeout(timeoutMs)});
   if(!response.ok)throw new Error(`Config HTTP ${response.status}`);
   const manifest=await response.json();const endpoint=chooseEndpoint(manifest,mode);
   try{storage?.setItem(cacheKey,JSON.stringify(manifest));}catch{}return{manifest,endpoint,source:u.href};
  }catch(error){lastError=error;}
  try{const manifest=JSON.parse(storage?.getItem(cacheKey)||'null');const endpoint=chooseEndpoint(manifest,mode);return{manifest,endpoint,source:'cache',stale:true};}
  catch{throw lastError||new Error('Relay config unavailable');}
 }
 class Client {
  constructor(options){
   Object.assign(this,{WebSocket:globalThis.WebSocket,storage:globalThis.localStorage,onEvent:()=>{},onState:()=>{},onStats:()=>{},onCommand:()=>{},onSensor:()=>{},onGameState:()=>{},gameId:'ar-games-test',...options});
   if(!this.url&&this.configUrl===undefined)this.configUrl=defaultConfigUrl;
   this.mode=this.mode||'internet';this.configFetch=this.fetch||globalThis.fetch;this.endpoint=this.url||null;this.configFlight=null;
   this.key=`ar-v3:${this.room}:${this.role}:${this.clientId}`;
   let saved;try{saved=JSON.parse(this.storage?.getItem(this.key)||'null');}catch{}
   const requestedTeam=Number(this.team??saved?.team??1);this.team=Number.isSafeInteger(requestedTeam)&&requestedTeam>=1&&requestedTeam<=50?requestedTeam:1;const teamChanged=this.role==='player'&&saved?.team!==undefined&&Number(saved.team)!==this.team;this.sessionId=teamChanged?globalThis.crypto.randomUUID():(saved?.sessionId||globalThis.crypto.randomUUID());this.seq=teamChanged?0:(saved?.seq||0);this.queue=teamChanged?[]:(saved?.queue||[]);this.seen=new Map(saved?.seen||[]);
   this.stats=saved?.stats||{sent:0,received:0,lost:0,duplicates:0,reconnects:0,rttCount:0,rttTotal:0,rttMin:null,rttMax:null,rtt:null};if(teamChanged&&Array.isArray(saved?.queue))this.stats.lost+=saved.queue.length;this.gameRevisions=new Map();this.publishedStates=new Map();this.stateFingerprints=new Map();this.pendingStates=new Map();this.relayEpoch=saved?.relayEpoch||null;
   this.running=false;this.ready=false;this.attempt=0;this.everJoined=false;this.sensorSeq=0;
  }
  persist(immediate=false){
   if(!immediate){if(!this.persistTimer)this.persistTimer=setTimeout(()=>{this.persistTimer=null;this.persist(true);},250);return;}
   clearTimeout(this.persistTimer);this.persistTimer=null;
   try{this.storage?.setItem(this.key,JSON.stringify({sessionId:this.sessionId,seq:this.seq,team:this.team,queue:this.queue,seen:[...this.seen],stats:this.stats,relayEpoch:this.relayEpoch}));}catch{}
   this.onStats({...this.stats,pending:this.queue.length,accepted:this.queue.filter(e=>e.accepted).length});
  }
  start(){if(this.running)return;this.running=true;if(this.configUrl){this.refreshConfig();this.configTimer=setInterval(()=>this.refreshConfig(),this.configRefreshMs||60000);}else this.connect();this.tick=setInterval(()=>this.flush(),250);}
  stop(){this.running=false;this.ready=false;clearTimeout(this.reconnect);this.reconnect=null;clearTimeout(this.connectTimeout);clearInterval(this.tick);clearInterval(this.configTimer);const ws=this.ws;this.ws=null;ws?.close();this.persist(true);}
  async refreshConfig(){
   if(!this.configUrl||this.configFlight)return this.configFlight;
   this.configFlight=loadRelayConfig({configUrl:this.configUrl,mode:this.mode,fetch:this.configFetch,storage:this.storage}).then(result=>{
    if(!this.running)return result;
    const changed=this.url!==result.endpoint;this.url=result.endpoint;this.manifest=result.manifest;
    this.onEvent({type:'relay_config',mode:this.mode,endpoint:this.url,revision:result.manifest.revision,source:result.source,stale:!!result.stale});
    const refreshSeconds=Number(result.manifest.refreshSeconds);
    if(Number.isFinite(refreshSeconds)&&refreshSeconds>=15&&refreshSeconds<=3600&&refreshSeconds*1000!==(this.configRefreshMs||60000)){
     clearInterval(this.configTimer);this.configRefreshMs=refreshSeconds*1000;this.configTimer=setInterval(()=>this.refreshConfig(),this.configRefreshMs);
    }
    if(changed){clearTimeout(this.reconnect);const old=this.ws;this.ws=null;this.ready=false;old?.close(4000,'relay_config_changed');this.reconnect=setTimeout(()=>this.connect(),150);}
    else if((!this.ws||this.ws.readyState>=2)&&!this.reconnect)this.connect();
    return result;
   }).catch(error=>{this.onState(`Настройки соединения недоступны: ${error.message}`);return null;}).finally(()=>{this.configFlight=null;});
   return this.configFlight;
  }
  connect(){
   if(!this.running||!this.url||this.ws?.readyState===0||this.ws?.readyState===1)return;clearTimeout(this.reconnect);this.reconnect=null;this.onState('Подключение…');const ws=this.ws=new this.WebSocket(this.url);
   const connectTimeout=this.connectTimeout=setTimeout(()=>{if(this.ws===ws&&!this.ready)ws.close();},10000);
   ws.onopen=()=>{if(this.ws!==ws)return;this.send({type:'join',protocol:3,room:this.room,role:this.role,clientId:this.clientId,sessionId:this.sessionId,team:this.team,gameId:this.gameId,capabilities:this.capabilities||[]});};
   ws.onmessage=e=>{if(this.ws!==ws)return;let m;try{m=JSON.parse(e.data);}catch{return this.onState('Некорректный ответ сервера');}if(!m||typeof m!=='object'||Array.isArray(m))return;if(m.type==='joined')clearTimeout(connectTimeout);this.message(m);};
   ws.onerror=()=>{};
   ws.onclose=e=>{clearTimeout(connectTimeout);if(this.ws!==ws)return;this.ws=null;this.ready=false;if(e.code===4001){this.stop();return this.onState('Это устройство подключено в другой вкладке');}this.onState('Нет связи — переподключение…');if(this.running){this.reconnect=setTimeout(()=>this.connect(),Math.min(10000,500*2**Math.min(this.attempt++,5))+Math.random()*300);if(this.configUrl)this.refreshConfig();}};
  }
  send(m){if(this.ws?.readyState!==1||(this.ws.bufferedAmount||0)>65536)return false;try{this.ws.send(JSON.stringify(m));return true;}catch{return false;}}
  message(m){
   if(m.type==='joined'){const newEpoch=!!m.epoch&&this.relayEpoch!==m.epoch;if(newEpoch)this.gameRevisions.clear();this.relayEpoch=m.epoch||this.relayEpoch;if(this.everJoined)this.stats.reconnects++;this.everJoined=true;this.attempt=0;this.ping=null;this.ready=true;this.onState('Подключено');this.persist();if(this.role==='host')for(const [key,snapshot] of this.publishedStates)this.pendingStates.set(key,snapshot);this.flush();}
   if(['button','command'].includes(m.type)&&this.role==='host'){
    if(!m.eventId){try{this.onCommand(m);this.stats.received++;this.persist();}catch(error){this.onState(`Ошибка обработки команды: ${error?.message||error}`);}}
    else this.hostCommandChain=(this.hostCommandChain||Promise.resolve()).then(async()=>{
     if(!this.seen.has(m.eventId)){await this.onCommand(m);this.seen.set(m.eventId,Date.now());this.stats.received++;this.persist();}
     else{this.stats.duplicates++;this.persist();}
     this.send({type:'host_ack',eventId:m.eventId});
    }).catch(error=>{this.onState(`Ошибка обработки команды: ${error?.message||error}`);});
   }
   if(m.type==='sensor'&&this.role==='host')this.onSensor(m);
   if(m.type==='game_state'&&this.role==='player'&&m.gameId===this.gameId){const scope=m.clientId?`client:${m.clientId}`:m.team??'*',key=`${m.gameId}:${scope}`,previous=this.gameRevisions.get(key)||0;if(Number.isSafeInteger(m.revision)&&m.revision>previous){this.gameRevisions.set(key,m.revision);this.onGameState(m);}}
   if(m.type==='ack'&&m.sessionId===this.sessionId){const q=this.queue.find(q=>q.seq===m.seq);if(q){q.accepted=true;if(m.duplicate)this.stats.duplicates++;this.persist();}}
   if((m.type==='delivered'||m.type==='ack'&&m.delivered)&&m.sessionId===this.sessionId){
    const i=this.queue.findIndex(q=>q.seq===m.seq);if(i>=0){this.queue.splice(i,1);this.stats.received++;this.persist();}
   }
   if(m.type==='pong_app'&&this.ping&&m.id===this.ping.id){const ms=Date.now()-this.ping.time;if(Number.isFinite(m.serverTs)&&ms>=0)this.clockOffset=m.serverTs-(this.ping.time+ms/2);Object.assign(this.stats,{rtt:ms,rttCount:this.stats.rttCount+1,rttTotal:this.stats.rttTotal+ms,rttMin:this.stats.rttMin===null?ms:Math.min(ms,this.stats.rttMin),rttMax:this.stats.rttMax===null?ms:Math.max(ms,this.stats.rttMax)});this.ping=null;this.persist();}
   if(m.type==='error'){
    if(['command_expired','invalid_command','sequence_conflict','session_mismatch','command_capacity'].includes(m.message)){const i=this.queue.findIndex(q=>q.seq===m.seq);if(i>=0){this.queue.splice(i,1);this.stats.lost++;this.persist();}}
    if(['room_required','host_already_connected','device_capacity','room_capacity'].includes(m.message))this.stop();
    this.onState(`Ошибка: ${m.message}`);
   }
   this.onEvent(m);
  }
  press(button){return this.sendCommand('button.press',{button});}
  sendCommand(action,payload={}){
   if(this.role!=='player')return false;
   const capacity=this.gameId==='snezhnaya-bitva'?128:5000;
   if(typeof action!=='string'||!/^[A-Za-z0-9_.:-]{1,64}$/.test(action)||this.queue.length>=capacity){this.onState(this.queue.length>=capacity?'Очередь заполнена':'Некорректное действие');return false;}
   let encoded;try{encoded=JSON.stringify(payload??{});}catch{this.onState('Данные команды не сериализуются');return false;}
   if(typeof encoded!=='string'||encoded.length>8000){this.onState('Команда слишком большая или не сериализуется');return false;}
   this.queue.push({type:'command',gameId:this.gameId,action,payload:payload??{},seq:++this.seq,sessionId:this.sessionId,clientTs:Date.now()});
   this.stats.sent++;this.persist(true);this.flush();return true;
  }
  sendSensor(channel,sample){
   if(this.role!=='player'||!this.ready||typeof channel!=='string'||!/^[a-z][a-z0-9_.-]{0,47}$/.test(channel))return false;
   let encoded;try{encoded=JSON.stringify(sample);}catch{return false;}
   if(typeof encoded!=='string'||encoded.length>512)return false;
   return this.send({type:'sensor',gameId:this.gameId,channel,seq:++this.sensorSeq,sample,clientTs:Date.now()});
  }
  publishState(state,{team=null,clientId=null}={}){
   if(this.role!=='host'||team!==null&&(!Number.isSafeInteger(team)||team<1||team>50)||clientId!==null&&(typeof clientId!=='string'||clientId.length<1||clientId.length>64)||team!==null&&clientId!==null||!state||typeof state!=='object'||Array.isArray(state))return false;
   let encoded;try{encoded=JSON.stringify(state);}catch{return false;}
   if(typeof encoded!=='string'||encoded.length>8000)return false;
   const scope=clientId?`client:${clientId}`:team??'*',key=`${this.gameId}:${scope}`,snapshot={gameId:this.gameId,team,clientId,state};if(!this.publishedStates.has(key)&&this.publishedStates.size>=151)return false;
   if(this.stateFingerprints.get(key)===encoded)return true;
   this.stateFingerprints.set(key,encoded);this.publishedStates.set(key,snapshot);this.pendingStates.set(key,snapshot);this.flushStates();return true;
  }
  flushStates(){if(!this.ready)return;for(const[key,snapshot]of this.pendingStates){if(!this.send({type:'game_state_update',...snapshot}))break;this.pendingStates.delete(key);}}
  flush(){
   const now=Date.now();const valid=q=>now-q.clientTs<=(q.gameId==='snezhnaya-bitva'?(['snowball.join','snowball.leave','snowball.roll'].includes(q.action)?15000:5000):1800000);const expired=this.queue.filter(q=>!valid(q));if(expired.length){this.stats.lost+=expired.length;this.queue=this.queue.filter(valid);this.persist();}
   for(const[id,ts]of this.seen)if(now-ts>(this.gameId==='snezhnaya-bitva'?60000:1860000))this.seen.delete(id);
   if(!this.ready)return;
   if(this.ping&&now-this.ping.time>10000){this.ws.close();return;}
   if(!this.ping&&(!this.lastPing||now-this.lastPing>=5000)){const ping={id:globalThis.crypto.randomUUID(),time:now};if(this.send({type:'ping_app',id:ping.id,clientTs:now})){this.ping=ping;this.lastPing=now;}}
   if(this.role==='player'&&(!this.lastMetrics||now-this.lastMetrics>=5000)){if(this.send({type:'metrics',sent:this.stats.sent,lost:this.stats.lost,pending:this.queue.length,rtt:this.stats.rtt,rttMin:this.stats.rttMin,rttMax:this.stats.rttMax,rttAvg:this.stats.rttCount?Math.round(this.stats.rttTotal/this.stats.rttCount):null}))this.lastMetrics=now;}
   for(const q of this.queue)if(!q.lastAttempt||now-q.lastAttempt>3000){if(!this.send(q))break;q.lastAttempt=now;}
   this.flushStates();
  }
 }
 return{Client,chooseEndpoint,loadRelayConfig,defaultConfigUrl};
});

