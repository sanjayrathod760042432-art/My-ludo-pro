const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
app.use(express.static('public'));

const COLORS = ['red','green','yellow','blue'];
const STARTS = [0,13,26,39];
const SAFE = new Set([0,8,13,21,26,34,39,47]);
const rooms = new Map();
const queue = [];

function newPieces(){ return COLORS.map(()=>[-1,-1,-1,-1]); }
function makeRoom(code){
  return { code, players: [], pieces:newPieces(), current:0, dice:0, over:false };
}
function publicState(r){
  return { roomCode:r.code, pieces:r.pieces, current:r.current, dice:r.dice, over:r.over,
           status:`Player ${r.current+1} की बारी` };
}
function roomForSocket(id){
  for(const r of rooms.values()) if(r.players.some(p=>p.id===id)) return r;
  return null;
}
function emitState(r){ io.to(r.code).emit('game:state', publicState(r)); }

app.get('/api/health', (req,res)=>res.json({ok:true, rooms:rooms.size}));

io.on('connection', socket=>{
  socket.on('room:create', ()=>{
    const code=crypto.randomBytes(3).toString('hex').toUpperCase();
    const r=makeRoom(code); r.players.push({id:socket.id,color:0});
    rooms.set(code,r); socket.join(code);
    socket.emit('room:created', publicState(r));
  });

  socket.on('room:join', code=>{
    const r=rooms.get(String(code||'').toUpperCase());
    if(!r) return socket.emit('room:error','Room नहीं मिला.');
    if(r.players.length>=4) return socket.emit('room:error','Room full है.');
    const color=r.players.length; r.players.push({id:socket.id,color});
    socket.join(r.code); socket.emit('room:joined', publicState(r)); emitState(r);
  });

  socket.on('match:quick', ()=>{
    let r=queue.map(code=>rooms.get(code)).find(x=>x && x.players.length<4);
    if(!r){
      const code=crypto.randomBytes(3).toString('hex').toUpperCase();
      r=makeRoom(code); rooms.set(code,r); queue.push(code);
    }
    r.players.push({id:socket.id,color:r.players.length});
    socket.join(r.code);
    socket.emit('room:joined', publicState(r));
    emitState(r);
    if(r.players.length>=2){
      const i=queue.indexOf(r.code); if(i>=0) queue.splice(i,1);
    }
  });

  socket.on('game:roll', ({roomCode})=>{
    const r=rooms.get(roomCode); if(!r || r.over) return;
    const p=r.players[r.current]; if(!p || p.id!==socket.id) return;
    if(r.dice) return;
    r.dice=1+Math.floor(Math.random()*6);
    io.to(r.code).emit('game:dice',{dice:r.dice,status:`Player ${r.current+1}: गोटी चुनें (${r.dice})`});
    emitState(r);
  });

  socket.on('game:move', ({roomCode,color,piece})=>{
    const r=rooms.get(roomCode); if(!r || r.over || !r.dice) return;
    const player=r.players[r.current];
    if(!player || player.id!==socket.id || player.color!==color) return;
    if(piece<0 || piece>3) return;
    let pos=r.pieces[color][piece];
    if(pos===57) return;
    if(pos===-1 && r.dice!==6) return;
    if(pos>=0 && pos<57 && pos+r.dice>57) return;

    const old=pos;
    pos=(pos===-1?0:pos+r.dice);
    let captured=false;
    if(pos<52){
      const abs=(STARTS[color]+pos)%52;
      for(let c=0;c<4;c++){
        if(c===color) continue;
        for(let j=0;j<4;j++){
          const op=r.pieces[c][j];
          if(op>=0 && op<52 && (STARTS[c]+op)%52===abs && !SAFE.has(abs)){
            r.pieces[c][j]=-1; captured=true;
          }
        }
      }
    }
    r.pieces[color][piece]=pos;
    const won=r.pieces[color].every(x=>x===57);
    const extra=(r.dice===6 || captured || pos===57);
    r.dice=0;
    if(won){
      r.over=true; io.to(r.code).emit('game:over',{winner:`Player ${color+1}`}); emitState(r); return;
    }
    if(!extra) r.current=(r.current+1)%Math.max(1,r.players.length);
    emitState(r);
  });

  socket.on('disconnect',()=>{
    for(const [code,r] of rooms){
      const before=r.players.length;
      r.players=r.players.filter(p=>p.id!==socket.id);
      if(r.players.length!==before){
        if(r.players.length===0){ rooms.delete(code); }
        else { r.current=Math.min(r.current,r.players.length-1); emitState(r); }
      }
    }
  });
});

const PORT=process.env.PORT||3000;
server.listen(PORT,()=>console.log(`My Ludo backend running on port ${PORT}`));
