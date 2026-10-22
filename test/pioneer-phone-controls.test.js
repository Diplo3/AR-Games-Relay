const fs=require('fs'),vm=require('vm'),assert=require('assert/strict');
const root=require('path').resolve(__dirname,'..');
const elements=new Map(),sent=[],commands=[];let sensor,connection,stops=0,starts=0,allowed=false;
function el(id){if(!elements.has(id))elements.set(id,{style:{},hidden:false,textContent:'',events:{},addEventListener(k,f){this.events[k]=f},getBoundingClientRect(){return {left:0,width:200}},setPointerCapture(){}});return elements.get(id)}
class Sensors{constructor(o){sensor=o}start(){starts++;return Promise.resolve(allowed)}stop(){stops++}calibrate(){}}
class Client{constructor(o){connection=o}start(){}stop(){}sendSensor(c,s){sent.push(s)}sendCommand(a,p){commands.push({a,p})}}
const context={document:{getElementById:el,querySelector:el},location:{search:'?room=QATEST',protocol:'https:',host:'example.test'},URLSearchParams,localStorage:{getItem:()=> 'qa',setItem(){}},crypto:require('crypto').webcrypto,ARGameSensors:{SensorController:Sensors},ARConnect:{Client,defaultConfigUrl:''},window:{screen:{orientation:{angle:90,lock:()=>Promise.reject(Error('unsupported'))}},addEventListener(){}},setInterval,clearInterval};
vm.runInNewContext(fs.readFileSync(root+'/public/ar-games/phone/pioneer.js','utf8'),context);
(async()=>{await el('join-one').onclick();assert.equal(el('enable-sensor').hidden,false);connection.onGameState({state:{phoneSession:'a',phase:'race',activePlayer:1}});
 const panel=el('.steer-panel');panel.events.pointerdown({preventDefault(){},pointerId:1,clientX:180});panel.events.pointerup();assert.equal(commands.at(-2).a,'steer.touch');assert.equal(commands.at(-2).p.value,.8);assert.equal(commands.at(-1).p.value,0);
 allowed=true;el('enable-sensor').onclick();await new Promise(r=>setImmediate(r));assert.equal(el('enable-sensor').hidden,true);
 sensor.onSample('orientation',{alpha:0,beta:13,gamma:8});assert.equal(sent.at(-1).relative.beta,13);context.window.screen.orientation.angle=0;sensor.onSample('orientation',{alpha:0,beta:13,gamma:8});assert.equal(sent.at(-1).relative.beta,8);context.window.screen.orientation.angle=270;sensor.onSample('orientation',{alpha:0,beta:13,gamma:8});assert.equal(sent.at(-1).relative.beta,-13);
 connection.onGameState({state:{phoneSession:'b',phase:'waiting',activePlayer:1}});assert.equal(el('enable-sensor').hidden,false);assert(stops>=3);
 const html=fs.readFileSync(root+'/public/ar-games/phone/pioneer.html','utf8');assert(!/id="(left|right|race-info|wait-team|rotate)"/.test(html));
 const result={deniedPermissionTouchFallback:true,retryPermission:true,newGameResetsSensor:true,portraitTilt:true,reverseLandscape:true,touchReleaseNeutral:true,removedRequestedElements:true,starts,stops};console.log(result);
})().catch(e=>{console.error(e);process.exitCode=1});

