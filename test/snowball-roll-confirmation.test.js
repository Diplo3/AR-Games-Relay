const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const phone=fs.readFileSync(path.join(__dirname,'../public/ar-games/phone/snowball.html'),'utf8');
function fixture({ready=true,confirmation=true,complete=true}={}){
 const code=phone.slice(phone.indexOf('function transmitRoll(){'),phone.indexOf('\nasync function send(data)'));
 const sent=[],target=Math.PI*5;
 const context={state:{networkVersion:2,rollConfirmation:confirmation,round:4,phase:'PLAYING',paused:false,ball:{id:'4:3',state:'RESERVED_ROLLING',progress:0}},relay:{ready,queue:[],sendSensor:()=>false,sendCommand(action,payload){sent.push({action,payload});this.queue.push({action,payload});return true;}},awaitingFreshState:false,localProgress:complete?target:1,requiredProgress:()=>target,lastRollSample:'',lastRollSampleAt:0,lastReliableRollAt:-Infinity,performance:{now:()=>5000}};
 vm.createContext(context);vm.runInContext(code,context);return{context,sent,run:()=>vm.runInContext('transmitRoll()',context)};
}
test('completion uses reliable cumulative command when every sensor send fails',()=>{const f=fixture();f.run();assert.equal(f.sent.length,1);assert.equal(f.sent[0].action,'snowball.roll');assert.equal(f.sent[0].payload.ballId,'4:3');assert.equal(f.sent[0].payload.round,4);assert.equal(f.sent[0].payload.total,Math.PI*5);});
test('repeated completion does not grow the reliable queue',()=>{const f=fixture();f.run();f.context.performance.now=()=>9000;f.run();assert.equal(f.sent.length,1);});
test('unfinished gestures and legacy hosts do not enqueue reliable completion',()=>{for(const options of [{complete:false},{confirmation:false},{ready:false}]){const f=fixture(options);f.run();assert.equal(f.sent.length,0);}});
test('already ready or paused snowballs never send more completion commands',()=>{for(const paused of [false,true]){const f=fixture();if(paused)f.context.state.paused=true;else f.context.state.ball.state='READY_HELD';f.run();assert.equal(f.sent.length,0);}});
