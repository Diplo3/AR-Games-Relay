const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const phone=fs.readFileSync(path.join(__dirname,'../public/ar-games/phone/snowball.html'),'utf8');
function observe(previous,next){
 const code=phone.slice(phone.indexOf('function observeAutoThrow('),phone.indexOf('function requiredProgress(){'));
 const events=[],context={throwing:false,localProgress:9,pending:2,gesture:{kind:'roll'},throwTimer:0,zone:{classList:{remove(){}}},haptic:kind=>events.push(kind),clearTimeout(){},setTimeout(fn,ms){assert.equal(ms,720);return 1},render(){},previous,next};vm.createContext(context);vm.runInContext(code+';observeAutoThrow(previous,next);',context);return{context,events};
}
test('acknowledged molding automatically animates launch without an extra action',()=>{const f=observe({round:3,player:{throwsUsed:0}},{autoThrow:true,round:3,player:{throwsUsed:1}});assert.equal(f.context.throwing,true);assert.equal(f.context.localProgress,0);assert.equal(f.context.gesture,null);assert.deepEqual(f.events,['throw']);});
test('duplicate snapshots do not replay the automatic launch',()=>{const f=observe({round:3,player:{throwsUsed:1}},{autoThrow:true,round:3,player:{throwsUsed:1}});assert.equal(f.context.throwing,false);assert.deepEqual(f.events,[]);});
test('new round, initial snapshot, and legacy host do not cause a false launch',()=>{for(const [prev,next]of [[null,{autoThrow:true,round:3,player:{throwsUsed:1}}],[{round:2,player:{throwsUsed:0}},{autoThrow:true,round:3,player:{throwsUsed:1}}],[{round:3,player:{throwsUsed:0}},{autoThrow:false,round:3,player:{throwsUsed:1}}]]){assert.equal(observe(prev,next).context.throwing,false);}});
