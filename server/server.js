'use strict';
const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const HTDOCS = path.join(__dirname, '..');

const server = http.createServer((req, res) => {
  let relativePath = req.url.split('?')[0];
  let filepath = path.join(HTDOCS, relativePath === '/' ? 'index.html' : relativePath);
  
  if (!filepath.startsWith(HTDOCS)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  
  const ext = path.extname(filepath);
  let mime = 'text/html';
  if (ext === '.css') mime = 'text/css';
  else if (ext === '.js') mime = 'application/javascript';
  else if (ext === '.png') mime = 'image/png';

  fs.readFile(filepath, (err, data) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404);
        return res.end('404 Not Found');
      }
      res.writeHead(500);
      return res.end('Server Error');
    }
    res.writeHead(200, { 'Content-Type': mime });
    res.end(data);
  });
});

const wss = new WebSocket.Server({ server });
server.listen(PORT, () => {
  console.log(`🎮 MMORPG & HTTP Server -> port ${PORT}`);
  console.log(`🌐 Localmente abre http://localhost:${PORT}`);
});

const TICK_MS = 50;
const MAP_W = 60, MAP_H = 40, TILE = 32;
const SPAWN_X = 30 * TILE, SPAWN_Y = 20 * TILE;

const CLASS_DEF = {
  warrior: { maxHp:150, atk:15, spd:95,  atkRange:45,  atkCD:800  },
  mage:    { maxHp:80,  atk:30, spd:115, atkRange:130, atkCD:1200 },
  archer:  { maxHp:100, atk:20, spd:135, atkRange:200, atkCD:900  },
};
const ENEMY_DEF = {
  goblin:   { maxHp:40,  atk:8,  spd:80,  atkRange:28, atkCD:1000, exp:15, aggro:160 },
  orc:      { maxHp:120, atk:20, spd:55,  atkRange:35, atkCD:2000, exp:40, aggro:130 },
  skeleton: { maxHp:60,  atk:12, spd:70,  atkRange:32, atkCD:1500, exp:25, aggro:180 },
};

/* ─── MAP GENERATION ─── */
function genMap() {
  const m = Array.from({length:MAP_H}, ()=>Array(MAP_W).fill(1));
  const set=(x,y,t)=>{if(x>0&&y>0&&x<MAP_W-1&&y<MAP_H-1)m[y][x]=t;};
  const fill=(x0,y0,x1,y1,t)=>{for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++)set(x,y,t);};

  // Border trees
  for(let i=0;i<MAP_W;i++){m[0][i]=5;m[MAP_H-1][i]=5;}
  for(let i=0;i<MAP_H;i++){m[i][0]=5;m[i][MAP_W-1]=5;}

  // Town center (stone)
  fill(26,17,33,22,3);
  // Main cross paths (3-wide dirt)
  for(let x=1;x<MAP_W-1;x++){set(x,19,2);set(x,20,2);set(x,21,2);}
  for(let y=1;y<MAP_H-1;y++){set(29,y,2);set(30,y,2);set(31,y,2);}
  // Restore town stone over paths
  fill(26,19,33,21,3);

  // Water lake top-left
  fill(3,3,17,13,4);
  // Path through lake
  for(let x=3;x<=17;x++){set(x,19,2);set(x,20,2);set(x,21,2);}

  // Dungeon zone bottom-right
  fill(43,28,58,38,7);
  for(let y=28;y<=38;y++){set(43,y,6);set(58,y,6);}
  for(let x=43;x<=58;x++){set(x,28,6);set(x,38,6);}
  // Dungeon entrance
  set(50,28,7);set(51,28,7);set(52,28,7);

  // Tree clusters
  [[20,5],[21,5],[22,5],[20,6],[22,6],[21,7],
   [40,3],[41,3],[42,3],[40,4],[42,4],
   [5,27],[6,27],[5,28],[5,29],[6,29],
   [18,34],[19,34],[20,34],[19,35],
   [55,19],[56,19],[55,20],[55,21],[56,21],
   [45,24],[46,24],[47,24],[46,25]].forEach(([x,y])=>set(x,y,5));

  // Rock clusters
  [[8,24],[9,24],[8,25],[38,14],[39,14],[38,15],[22,28],[23,28]]
    .forEach(([x,y])=>set(x,y,6));
  return m;
}
const MAP = genMap();

const isWalkable = t => t===1||t===2||t===3||t===7;
function canMoveTo(x,y,r=13){
  for(const[cx,cy]of[[x-r,y-r],[x+r,y-r],[x-r,y+r],[x+r,y+r],[x,y-r],[x,y+r],[x-r,y],[x+r,y]]){
    const tx=Math.floor(cx/TILE),ty=Math.floor(cy/TILE);
    if(tx<0||ty<0||tx>=MAP_W||ty>=MAP_H||!isWalkable(MAP[ty][tx]))return false;
  }
  return true;
}
const dist=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const expNeeded = lv => 100*lv*(lv+1)/2;

/* ─── STATE ─── */
const players=new Map(), enemies=new Map();
let eid=1, pid=1;

function spawnEnemy(type,sx,sy){
  const id=`e${eid++}`,d=ENEMY_DEF[type];
  enemies.set(id,{id,type,x:sx,y:sy,spawnX:sx,spawnY:sy,
    hp:d.maxHp,maxHp:d.maxHp,atk:d.atk,spd:d.spd,
    atkRange:d.atkRange,atkCD:d.atkCD,exp:d.exp,aggro:d.aggro,
    target:null,lastAtk:0,dead:false,respawnTimer:0});
}
[['goblin',8,15],['goblin',12,15],['goblin',6,17],['goblin',10,18],['goblin',5,16],
 ['skeleton',45,10],['skeleton',48,12],['skeleton',50,8],['skeleton',52,11],
 ['orc',48,32],['orc',52,35],['orc',50,30],['orc',55,33],
 ['goblin',15,30],['goblin',18,33],['goblin',20,31],
 ['skeleton',38,28],['skeleton',35,32],['skeleton',40,30],
].forEach(([t,x,y])=>spawnEnemy(t,x*TILE,y*TILE));

/* ─── UTILS ─── */
function broadcast(msg,excludeId=null){
  const s=JSON.stringify(msg);
  for(const c of wss.clients)if(c.readyState===WebSocket.OPEN&&c.playerId!==excludeId)c.send(s);
}
function sendTo(id,msg){
  for(const c of wss.clients)if(c.playerId===id&&c.readyState===WebSocket.OPEN)c.send(JSON.stringify(msg));
}
function checkLevelUp(p){
  while(p.exp>=p.expToNext){
    p.exp-=p.expToNext; p.level++;
    p.expToNext=expNeeded(p.level);
    const b=CLASS_DEF[p.class];
    p.maxHp=Math.floor(b.maxHp*(1+(p.level-1)*0.15));
    p.hp=p.maxHp;
    p.atk=Math.floor(b.atk*(1+(p.level-1)*0.10));
    broadcast({type:'level_up',playerId:p.id,level:p.level,maxHp:p.maxHp,atk:p.atk});
  }
}

/* ─── CONNECTION ─── */
wss.on('connection', ws=>{
  let myId=null;
  ws.on('message', raw=>{
    let msg; try{msg=JSON.parse(raw);}catch{return;}
    switch(msg.type){
      case 'join':{
        myId=`p${pid++}`; ws.playerId=myId;
        const cls=CLASS_DEF[msg.class]||CLASS_DEF.warrior;
        const p={id:myId,name:String(msg.name||'Hero').slice(0,16),
          class:msg.class in CLASS_DEF?msg.class:'warrior',
          x:SPAWN_X+(Math.random()-.5)*96, y:SPAWN_Y+(Math.random()-.5)*96,
          hp:cls.maxHp,maxHp:cls.maxHp,atk:cls.atk,spd:cls.spd,
          atkRange:cls.atkRange,atkCD:cls.atkCD,
          exp:0,expToNext:expNeeded(1),level:1,
          dir:2,moving:false,dead:false,respawnTimer:0,lastAtk:0};
        players.set(myId,p);
        ws.send(JSON.stringify({type:'init',playerId:myId,player:p,
          players:[...players.values()],
          enemies:[...enemies.values()].filter(e=>!e.dead),map:MAP}));
        broadcast({type:'player_join',player:p},myId);
        console.log(`[JOIN] ${p.name} (${p.class}) → ${myId}`);
        break;
      }
      case 'move':{
        const p=players.get(myId); if(!p||p.dead)return;
        if(msg.x!==undefined&&msg.y!==undefined){
          if(canMoveTo(msg.x,msg.y))p.x=msg.x,p.y=msg.y;
          if(msg.dir!==undefined)p.dir=msg.dir;
          p.moving=!!msg.moving;
        }
        break;
      }
      case 'attack':{
        const p=players.get(myId); if(!p||p.dead)return;
        const now=Date.now(); if(now-p.lastAtk<p.atkCD)return;
        p.lastAtk=now;
        const tid=msg.targetId;
        if(tid&&tid[0]==='e'){
          const e=enemies.get(tid);
          if(e&&!e.dead&&dist(p,e)<=p.atkRange+20){
            const dmg=Math.max(1,Math.floor(p.atk*(0.8+Math.random()*0.4)));
            e.hp-=dmg;
            broadcast({type:'damage',targetId:tid,damage:dmg,attackerId:myId});
            if(e.hp<=0){
              e.dead=true; e.respawnTimer=15000;
              broadcast({type:'enemy_death',enemyId:tid,killedBy:myId});
              p.exp+=e.exp;
              sendTo(myId,{type:'exp_gain',exp:e.exp,total:p.exp,next:p.expToNext});
              checkLevelUp(p);
            }
          }
        } else if(tid&&tid[0]==='p'){
          const t=players.get(tid);
          if(t&&!t.dead&&dist(p,t)<=p.atkRange+16){
            const dmg=Math.max(1,Math.floor(p.atk*(0.8+Math.random()*0.4)));
            t.hp-=dmg;
            broadcast({type:'damage',targetId:tid,damage:dmg,attackerId:myId});
            if(t.hp<=0){
              t.dead=true; t.respawnTimer=5000;
              broadcast({type:'player_died',playerId:tid,killedBy:myId});
              p.exp+=50;
              sendTo(myId,{type:'exp_gain',exp:50,total:p.exp,next:p.expToNext});
              checkLevelUp(p);
            }
          }
        }
        break;
      }
      case 'chat':{
        const p=players.get(myId); if(!p)return;
        const text=String(msg.message||'').trim().slice(0,200);
        if(text)broadcast({type:'chat',playerId:myId,name:p.name,class:p.class,message:text});
        break;
      }
    }
  });
  ws.on('close',()=>{
    if(!myId)return;
    const p=players.get(myId);
    if(p){broadcast({type:'player_leave',playerId:myId});players.delete(myId);}
    console.log(`[LEAVE] ${myId}`);
  });
  ws.on('error',err=>console.error('[WS ERROR]',err.message));
});

/* ─── GAME LOOP ─── */
let lastTick=Date.now();
setInterval(()=>{
  const now=Date.now(), dt=(now-lastTick)/1000;
  lastTick=now;

  for(const[,e] of enemies){
    if(e.dead){
      e.respawnTimer-=dt*1000;
      if(e.respawnTimer<=0){
        e.dead=false; e.hp=e.maxHp;
        e.x=e.spawnX; e.y=e.spawnY; e.target=null;
        broadcast({type:'enemy_spawn',enemy:{id:e.id,type:e.type,x:e.x,y:e.y,hp:e.hp,maxHp:e.maxHp}});
      }
      continue;
    }
    // Find nearest player
    let nearest=null, nearDist=e.aggro;
    for(const[,p] of players){
      if(p.dead)continue;
      const d=dist(e,p);
      if(d<nearDist){nearDist=d;nearest=p;}
    }
    if(nearest){
      e.target=nearest.id;
      if(nearDist>e.atkRange){
        const angle=Math.atan2(nearest.y-e.y,nearest.x-e.x);
        const nx=e.x+Math.cos(angle)*e.spd*dt;
        const ny=e.y+Math.sin(angle)*e.spd*dt;
        if(canMoveTo(nx,ny,12))e.x=nx,e.y=ny;
      }
      if(nearDist<=e.atkRange&&now-e.lastAtk>=e.atkCD){
        e.lastAtk=now;
        const dmg=Math.max(1,Math.floor(e.atk*(0.8+Math.random()*0.4)));
        nearest.hp=Math.max(0,nearest.hp-dmg);
        broadcast({type:'damage',targetId:nearest.id,damage:dmg,attackerId:e.id});
        if(nearest.hp<=0){
          nearest.dead=true; nearest.respawnTimer=5000;
          broadcast({type:'player_died',playerId:nearest.id,killedBy:e.id});
        }
      }
    } else {
      e.target=null;
      const d=dist(e,{x:e.spawnX,y:e.spawnY});
      if(d>8){
        const angle=Math.atan2(e.spawnY-e.y,e.spawnX-e.x);
        const nx=e.x+Math.cos(angle)*e.spd*0.4*dt;
        const ny=e.y+Math.sin(angle)*e.spd*0.4*dt;
        if(canMoveTo(nx,ny,12))e.x=nx,e.y=ny;
      }
    }
  }

  for(const[,p] of players){
    if(p.dead){
      p.respawnTimer-=dt*1000;
      if(p.respawnTimer<=0){
        p.dead=false; p.hp=p.maxHp;
        p.x=SPAWN_X+(Math.random()-.5)*96; p.y=SPAWN_Y+(Math.random()-.5)*96;
        broadcast({type:'player_respawn',playerId:p.id,x:p.x,y:p.y,hp:p.hp});
      }
    }
  }

  if(players.size>0){
    const pUpd=[...players.values()].map(p=>({id:p.id,x:p.x,y:p.y,hp:p.hp,maxHp:p.maxHp,dir:p.dir,moving:p.moving,dead:p.dead,level:p.level}));
    const eUpd=[...enemies.values()].filter(e=>!e.dead).map(e=>({id:e.id,x:e.x,y:e.y,hp:e.hp,maxHp:e.maxHp,type:e.type}));
    broadcast({type:'state',players:pUpd,enemies:eUpd});
  }
},TICK_MS);


