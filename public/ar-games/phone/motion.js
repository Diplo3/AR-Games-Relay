(function(root,factory){if(typeof module==='object')module.exports=factory();else root.ARSensors=factory();})(globalThis,()=>{
 const generic={accelerometer:['Accelerometer','x,y,z'],gyroscope:['Gyroscope','x,y,z'],linear_acceleration:['LinearAccelerationSensor','x,y,z'],gravity:['GravitySensor','x,y,z'],absolute_orientation:['AbsoluteOrientationSensor','quaternion'],relative_orientation:['RelativeOrientationSensor','quaternion'],magnetometer:['Magnetometer','x,y,z'],light:['AmbientLightSensor','illuminance'],proximity:['ProximitySensor','distance,near']};
 class SensorHub{
  constructor({windowRef=globalThis.window,navigatorRef=globalThis.navigator,maxHz=20,onSample=()=>{},onState=()=>{}}={}){
   this.win=windowRef;this.nav=navigatorRef;this.maxHz=Math.max(1,Math.min(25,maxHz));this.onSample=onSample;this.onState=onState;this.active=new Map();this.pending=new Map();this.custom=new Map();this.cursor=0;this.flushTimer=null;
  }
  available(){
   const w=this.win||{},n=this.nav||{},out=[];if(w.DeviceOrientationEvent)out.push('orientation');if(w.DeviceMotionEvent)out.push('motion');
   for(const[name,[ctor]]of Object.entries(generic))if(typeof w[ctor]==='function')out.push(name);
   if(n.geolocation)out.push('geolocation');if(typeof w.Gamepad==='function'||typeof n.getGamepads==='function')out.push('gamepad');
   for(const name of this.custom.keys())out.push(name);return [...new Set(out)];
  }
  register(name,factory){if(!/^[a-z][a-z0-9_.-]{0,47}$/.test(name)||typeof factory!=='function')throw new Error('Invalid custom sensor');this.custom.set(name,factory);}
  secure(){return !!this.win?.isSecureContext||['localhost','127.0.0.1'].includes(this.win?.location?.hostname);}
  emit(channel,sample,timestamp=Date.now()){this.pending.set(channel,{sample,timestamp});}
  flush(){const channels=[...this.pending.keys()];if(!channels.length)return;const channel=channels[this.cursor++%channels.length],reading=this.pending.get(channel);this.pending.delete(channel);this.onSample(channel,reading.sample,reading.timestamp);}
  async start(channel){
   if(this.active.has(channel))return true;
   if(!this.available().includes(channel))return this.fail(channel,'Датчик недоступен на этом устройстве');
   if(channel!=='gamepad'&&!this.secure())return this.fail(channel,'Для доступа к датчикам требуется HTTPS');
   try{
    let stop;
    if(channel==='orientation'||channel==='motion')stop=await this.startDeviceEvent(channel);
    else if(channel==='geolocation')stop=this.startGeolocation();
    else if(channel==='gamepad')stop=this.startGamepad();
    else if(this.custom.has(channel))stop=await this.custom.get(channel)({emit:(sample,ts)=>this.emit(channel,sample,ts),window:this.win,navigator:this.nav});
    else stop=this.startGeneric(channel);
    if(!stop)return this.fail(channel,'Не удалось запустить датчик');
    this.active.set(channel,stop);if(!this.flushTimer)this.flushTimer=setInterval(()=>this.flush(),1000/this.maxHz);this.onState(channel,'Датчик включён');return true;
   }catch(error){return this.fail(channel,error?.name==='NotAllowedError'?'Доступ к датчику не разрешён':`Ошибка датчика: ${error?.message||error}`);}
  }
  startDeviceEvent(channel){
   const w=this.win,type=channel==='orientation'?'deviceorientation':'devicemotion',EventType=channel==='orientation'?w.DeviceOrientationEvent:w.DeviceMotionEvent;
   if(!EventType)return null;
   const attach=()=>{const handler=e=>{
    if(channel==='orientation'){const{alpha,beta,gamma,absolute}=e;if(![alpha,beta,gamma].every(Number.isFinite))return;this.emit(channel,{alpha,beta,gamma,absolute:!!absolute},e.timeStamp);}
    else{const vec=v=>v&&[v.x,v.y,v.z].every(Number.isFinite)?{x:v.x,y:v.y,z:v.z}:null;const r=e.rotationRate&&[e.rotationRate.alpha,e.rotationRate.beta,e.rotationRate.gamma].every(Number.isFinite)?{alpha:e.rotationRate.alpha,beta:e.rotationRate.beta,gamma:e.rotationRate.gamma}:null;const sample={acceleration:vec(e.acceleration),accelerationIncludingGravity:vec(e.accelerationIncludingGravity),rotationRate:r,interval:Number.isFinite(e.interval)?e.interval:null};if(sample.acceleration||sample.accelerationIncludingGravity||sample.rotationRate)this.emit(channel,sample,e.timeStamp);}
   };w.addEventListener(type,handler,{passive:true});return()=>w.removeEventListener(type,handler);};
   if(typeof EventType.requestPermission==='function')return EventType.requestPermission().then(permission=>permission==='granted'?attach():Promise.reject(Object.assign(new Error('denied'),{name:'NotAllowedError'})));
   return attach();
  }
  startGeolocation(){
   const id=this.nav.geolocation.watchPosition(pos=>{const c=pos.coords;this.emit('geolocation',{latitude:c.latitude,longitude:c.longitude,accuracy:c.accuracy,altitude:c.altitude,altitudeAccuracy:c.altitudeAccuracy,heading:c.heading,speed:c.speed},pos.timestamp);},error=>this.onState('geolocation',`Геолокация: ${error.message}`),{enableHighAccuracy:true,maximumAge:1000,timeout:15000});
   return()=>this.nav.geolocation.clearWatch(id);
  }
  startGeneric(channel){
   const [ctor]=generic[channel],Sensor=this.win[ctor];if(!Sensor)return null;
   const sensor=new Sensor({frequency:this.maxHz});sensor.addEventListener('reading',()=>{
    const values={};for(const key of ['x','y','z','illuminance','distance','near'])if(Number.isFinite(sensor[key])||typeof sensor[key]==='boolean')values[key]=sensor[key];
    if(sensor.quaternion)values.quaternion=Array.from(sensor.quaternion);if(Object.keys(values).length)this.emit(channel,values,sensor.timestamp);
   });sensor.addEventListener('error',e=>this.onState(channel,`Датчик: ${e.error?.message||'ошибка'}`));sensor.start();return()=>sensor.stop();
  }
  startGamepad(){
   const w=this.win,n=this.nav;let timer;const poll=()=>{const pads=n.getGamepads?.()||[];for(const p of pads)if(p&&p.connected)this.emit('gamepad',{index:p.index,id:String(p.id).slice(0,80),mapping:p.mapping,axes:Array.from(p.axes).slice(0,16),buttons:Array.from(p.buttons).slice(0,32).map(b=>({pressed:b.pressed,value:b.value}))});};
   w.addEventListener('gamepadconnected',poll);timer=setInterval(poll,1000/this.maxHz);poll();return()=>{clearInterval(timer);w.removeEventListener('gamepadconnected',poll);};
  }
  stop(channel){if(channel){const stop=this.active.get(channel);if(!stop)return;stop();this.active.delete(channel);this.pending.delete(channel);this.onState(channel,'Датчик выключён');}else for(const name of [...this.active.keys()])this.stop(name);if(!this.active.size){clearInterval(this.flushTimer);this.flushTimer=null;this.pending.clear();}}
  fail(channel,message){this.onState(channel,message);return false;}
 }
 return{SensorHub,genericSensors:Object.keys(generic)};
});
