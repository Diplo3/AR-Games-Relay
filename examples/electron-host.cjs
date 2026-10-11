// Run in Electron main process. Keep your existing LAN transport alongside this adapter.
const {Client,defaultConfigUrl}=require('../public/connect');
const {WebSocket}=require('ws');
function startHost({mode='internet',configUrl=defaultConfigUrl,gameId,room,clientId,storage,onCommand,onSensor=()=>{},onState=()=>{}}){
 if(!['internet','lan'].includes(mode))throw new Error('Unknown connection mode');
 if(!storage)throw new Error('Provide persistent host storage');
 const client=new Client({configUrl,mode,gameId,room,clientId,role:'host',storage,WebSocket,onState,onCommand,onSensor});
 client.start();return client;
}
function startPlayer({mode='internet',configUrl=defaultConfigUrl,gameId,room,clientId,team,storage,onEvent,onState=()=>{},onStats=()=>{}}){
 const client=new Client({configUrl,mode,gameId,room,clientId,team,role:'player',storage,WebSocket,onEvent,onState,onStats});
 client.start();return{client,press:button=>client.press(button),sendCommand:(action,payload)=>client.sendCommand(action,payload),sendSensor:(channel,sample)=>client.sendSensor(channel,sample),stop:()=>client.stop()};
}
module.exports={startHost,startPlayer};
