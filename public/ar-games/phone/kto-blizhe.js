/* Internet transport: shared results supplement private team state. */
(() => {
 const room=new URLSearchParams(location.search).get('room'),key='kto-blizhe:'+room;
 let client,connected=false,hostOnline=false,personal=null,common=null;
 const ui=new KtoPhoneUI({key,join:teamId=>command('kto-blizhe.join',{teamId}),send:payload=>command('kto-blizhe.answer',payload)});
 function command(name,payload){if(!connected||!hostOnline||!client.sendCommand(name,payload))throw Error('Нет связи с ведущим.');}
 function show(){if(personal)ui.accept(common?.kind==='results'&&common.sessionId===personal.sessionId?{...personal,ranking:common.ranking}:personal);else if(common)ui.accept(common);}
 if(!room){ui.error('Откройте QR-код ведущего.');return;}
 const clientId=localStorage.getItem(key+':client')||crypto.randomUUID();localStorage.setItem(key+':client',clientId);
 client=new ARConnect.Client({room,role:'player',clientId,team:1,gameId:'ar-games-kto-blizhe',onState:status=>{connected=status==='Подключено';ui.connection(connected,hostOnline);},onEvent:event=>{if(event.type==='room_stats'){hostOnline=!!event.hostOnline;ui.connection(connected,hostOnline);}},onGameState:event=>{const state=event.state;if(!state)return;if(event.clientId){personal=state.kind==='game'?state:null;if(!personal)common=state;}else common=state;show();}});
 client.start();window.addEventListener('beforeunload',()=>client.stop());
})();

