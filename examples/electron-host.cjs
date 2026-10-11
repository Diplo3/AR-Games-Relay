// Run in Electron main process. Keep your existing LAN transport alongside this adapter.
const {Client}=require('../public/connect');
const {WebSocket}=require('ws');
function startHost({mode='internet',endpoints,room,clientId,storage,onCommand,onState=()=>{}}){
 if(!['internet','lan'].includes(mode))throw new Error('Unknown connection mode');
 if(!endpoints?.[mode])throw new Error('Missing endpoint');
 if(!storage)throw new Error('Provide persistent host storage');
 const client=new Client({url:endpoints[mode],room,clientId,role:'host',storage,WebSocket,onState,onCommand});
 client.start();return client;
}
module.exports={startHost};
