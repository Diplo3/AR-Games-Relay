const express=require("express");
const http=require("http");
const path=require("path");
const {WebSocketServer,WebSocket}=require("ws");
const app=express(), server=http.createServer(app);
const wss=new WebSocketServer({server});
app.use(express.static(path.join(__dirname,"public")));
app.get("/health",(_q,r)=>r.json({ok:true,service:"AR Games Relay",version:"0.2.0",clients:wss.clients.size}));

const rooms=new Map();
const getRoom=c=>{if(!rooms.has(c))rooms.set(c,new Set());return rooms.get(c)};
const send=(w,o)=>{if(w.readyState===WebSocket.OPEN)w.send(JSON.stringify(o))};
const broadcast=(c,o,except=null)=>{for(const w of rooms.get(c)||[])if(w!==except)send(w,o)};
const countPlayers=c=>[...(rooms.get(c)||[])].filter(w=>w.role==="player").length;
function presence(c){broadcast(c,{type:"room_stats",players:countPlayers(c),clients:(rooms.get(c)||new Set()).size,serverTs:Date.now()})}
function cleanup(w){
 if(!w.room)return; const set=rooms.get(w.room); if(!set)return;
 const c=w.room; set.delete(w); if(!set.size)rooms.delete(c); else presence(c);
}
wss.on("connection",w=>{
 w.isAlive=true; w.on("pong",()=>w.isAlive=true);
 w.on("message",raw=>{
  let m; try{m=JSON.parse(raw)}catch{return send(w,{type:"error",message:"invalid_json"})}
  if(m.type==="join"){
   cleanup(w);
   const c=String(m.room||"").toUpperCase().replace(/[^A-Z0-9]/g,"").slice(0,8);
   if(c.length<4)return send(w,{type:"error",message:"room_required"});
   w.room=c; w.role=m.role==="host"?"host":"player"; w.clientId=String(m.clientId||"").slice(0,64);
   getRoom(c).add(w); send(w,{type:"joined",room:c,role:w.role,serverTs:Date.now()}); presence(c); return;
  }
  if(!w.room)return send(w,{type:"error",message:"join_first"});
  if(m.type==="button"){
   const e={type:"button",button:String(m.button||"").slice(0,30),seq:Number(m.seq)||0,
    clientId:w.clientId,clientTs:Number(m.clientTs)||0,serverTs:Date.now(),role:w.role};
   broadcast(w.room,e,w); send(w,{type:"ack",seq:e.seq,clientTs:e.clientTs,serverTs:e.serverTs}); return;
  }
  if(m.type==="ping_app")send(w,{type:"pong_app",id:m.id,clientTs:m.clientTs,serverTs:Date.now()});
 });
 w.on("close",()=>cleanup(w));
});
setInterval(()=>{for(const w of wss.clients){if(!w.isAlive){w.terminate();continue}w.isAlive=false;w.ping()}},25000);
server.listen(process.env.PORT||3000,"0.0.0",()=>console.log("AR Games Relay v0.2 listening on "+(process.env.PORT||3000)));
