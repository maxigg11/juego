/* ── GameMain ── */
const GameMain = (() => {
  // Canvas
  const canvas = document.getElementById('game-canvas');
  const ctx    = canvas.getContext('2d');
  const mmCanvas = document.getElementById('minimap');
  const mmCtx    = mmCanvas.getContext('2d');

  // Constants
  const TILE = 32;
  const MAP_W = 60, MAP_H = 40;

  // Tile colors [base, detail]
  const TILE_COLORS = {
    1: ['#2e5e22','#264f1c'],   // grass
    2: ['#6b4c1a','#5a3e14'],   // dirt path
    3: ['#555555','#444444'],   // stone
    4: ['#1a3d7a','#163060'],   // water
    5: ['#1d3e1a','#163215'],   // tree base
    6: ['#2a2030','#1e1828'],   // rock
    7: ['#12111f','#0e0d1a'],   // dungeon
  };
  const MINIMAP_COLORS = {1:'#3a7a30',2:'#8b6914',3:'#666',4:'#234da0',5:'#1a3318',6:'#333',7:'#1a1828'};
  const CLASS_COLORS   = { warrior:'#e74c3c', mage:'#9b59b6', archer:'#27ae60' };
  const ENEMY_COLORS   = { goblin:'#2ecc71', orc:'#c0392b', skeleton:'#bdc3c7' };

  // State
  let map = null;
  let localId = null;
  let players = {};
  let enemies = {};
  let floatingTexts = [];
  let particles = [];
  let waterAnim = 0;
  let localPlayer = null;

  // Input
  const keys = {};
  let lastMoveX = 0, lastMoveY = 0;

  // Camera
  const cam = { x: 0, y: 0 };

  // Expose for ui.js
  const pub = { chatFocused: false, players, get localId(){ return localId; }, joystickVector: { x: 0, y: 0 } };

  /* ─── NETWORK HANDLERS ─── */
  function setupNetwork() {
    GameNetwork.on('init', msg => {
      localId = msg.playerId;
      GameNetwork.setPlayerId(localId);
      map = msg.map;
      players = {};
      msg.players.forEach(p => players[p.id] = p);
      msg.enemies.forEach(e => enemies[e.id] = e);
      localPlayer = players[localId];
      GameUI.updateHUD(localPlayer);
      GameUI.addChat('Sistema', `Bienvenido a Realm of Shadows, ${localPlayer.name}!`, 'sys');
      GameUI.addChat('Sistema', 'Muévete con WASD • Ataca haciendo clic en enemigos', 'sys');
    });

    GameNetwork.on('player_join', msg => {
      players[msg.player.id] = msg.player;
      GameUI.addChat('Sistema', `${msg.player.name} entró al mundo`, 'sys');
    });

    GameNetwork.on('player_leave', msg => {
      const p = players[msg.playerId];
      if (p) { GameUI.addChat('Sistema', `${p.name} salió del juego`, 'sys'); delete players[msg.playerId]; }
    });

    GameNetwork.on('state', msg => {
      msg.players.forEach(upd => {
        if (!players[upd.id]) {
          players[upd.id] = upd;
        } else {
          if (upd.id === localId) {
            // Do not overwrite local movement prediction
            const { x, y, dir, moving, ...rest } = upd;
            Object.assign(players[upd.id], rest);
          } else {
            Object.assign(players[upd.id], upd);
          }
        }
      });
      // Replace enemy list
      msg.enemies.forEach(upd => {
        if (!enemies[upd.id]) enemies[upd.id] = upd;
        else Object.assign(enemies[upd.id], upd);
      });
      localPlayer = players[localId];
      if (localPlayer) GameUI.updateHUD(localPlayer);
    });

    GameNetwork.on('damage', msg => {
      const isLocal = msg.targetId === localId;
      spawnFloatingText(getDamagePos(msg.targetId), '-' + msg.damage, isLocal ? '#ff4444' : '#ff8844', isLocal ? 1.3 : 1.0);
      spawnHitParticles(getDamagePos(msg.targetId));
    });

    GameNetwork.on('player_died', msg => {
      if (msg.playerId === localId) {
        GameUI.setDead(true, 5000);
        GameUI.addChat('Sistema', '💀 Moriste! Reaparecerás en 5 segundos...', 'kill');
      }
      const killer = isEnemy(msg.killedBy) ? (enemies[msg.killedBy]?.type || 'enemigo') : (players[msg.killedBy]?.name || 'alguien');
      const victim = players[msg.playerId]?.name || 'alguien';
      if (msg.playerId !== localId) GameUI.addChat('Sistema', `💀 ${victim} fue eliminado por ${killer}`, 'kill');
    });

    GameNetwork.on('player_respawn', msg => {
      if (players[msg.playerId]) Object.assign(players[msg.playerId], { x: msg.x, y: msg.y, hp: msg.hp, dead: false });
      if (msg.playerId === localId) {
        GameUI.setDead(false);
        GameUI.showNotif('✨ Reapareciste!', '#27ae60');
      }
    });

    GameNetwork.on('enemy_death', msg => {
      if (enemies[msg.enemyId]) enemies[msg.enemyId].dead = true;
    });

    GameNetwork.on('enemy_spawn', msg => {
      enemies[msg.enemy.id] = msg.enemy;
    });

    GameNetwork.on('exp_gain', msg => {
      spawnFloatingText(localPlayer ? { x: localPlayer.x, y: localPlayer.y } : { x: 0, y: 0 }, `+${msg.exp} XP`, '#f5c842', 1.1);
    });

    GameNetwork.on('level_up', msg => {
      if (players[msg.playerId]) Object.assign(players[msg.playerId], { level: msg.level, maxHp: msg.maxHp });
      if (msg.playerId === localId) {
        GameUI.showNotif(`⬆ NIVEL ${msg.level}! ¡Subiste de nivel!`, '#f5c842');
        GameUI.addChat('Sistema', `⭐ ¡Subiste al nivel ${msg.level}!`, 'lvl');
        spawnLevelUpEffect(localPlayer);
      }
    });

    GameNetwork.on('chat', msg => {
      GameUI.addChatFull(msg.name, msg.class, msg.message);
    });
  }

  function isEnemy(id) { return id && id[0] === 'e'; }

  function getDamagePos(targetId) {
    if (players[targetId]) return { x: players[targetId].x, y: players[targetId].y };
    if (enemies[targetId]) return { x: enemies[targetId].x, y: enemies[targetId].y };
    return localPlayer || { x: 0, y: 0 };
  }

  /* ─── INPUT ─── */
  function setupInput() {
    window.addEventListener('keydown', e => {
      if (pub.chatFocused) return;
      keys[e.key.toLowerCase()] = true;
    });
    window.addEventListener('keyup', e => {
      keys[e.key.toLowerCase()] = false;
    });

    canvas.addEventListener('click', e => {
      if (!localPlayer || localPlayer.dead) return;
      const wx = e.clientX + cam.x;
      const wy = e.clientY + cam.y;

      // Check click on enemy
      for (const [id, en] of Object.entries(enemies)) {
        if (en.dead) continue;
        if (Math.hypot(wx - en.x, wy - en.y) < 20) {
          GameNetwork.sendAttack(id);
          return;
        }
      }
      // Click on player (PvP)
      for (const [id, pl] of Object.entries(players)) {
        if (id === localId || pl.dead) continue;
        if (Math.hypot(wx - pl.x, wy - pl.y) < 16) {
          GameNetwork.sendAttack(id);
          return;
        }
      }
    });
  }

  /* ─── PARTICLES ─── */
  function spawnFloatingText(pos, text, color, scale = 1) {
    floatingTexts.push({ x: pos.x, y: pos.y, vy: -60, text, color, scale, alpha: 1, life: 1.2 });
  }

  function spawnHitParticles(pos) {
    for (let i = 0; i < 6; i++) {
      const angle = Math.random() * Math.PI * 2;
      const spd = 40 + Math.random() * 60;
      particles.push({ x: pos.x, y: pos.y, vx: Math.cos(angle)*spd, vy: Math.sin(angle)*spd, alpha: 1, life: .5, color: '#ff4444' });
    }
  }

  function spawnLevelUpEffect(player) {
    if (!player) return;
    for (let i = 0; i < 20; i++) {
      const angle = (i / 20) * Math.PI * 2;
      const spd = 80 + Math.random() * 40;
      particles.push({ x: player.x, y: player.y, vx: Math.cos(angle)*spd, vy: Math.sin(angle)*spd, alpha: 1, life: 1.0, color: '#f5c842' });
    }
  }

  /* ─── MOVEMENT ─── */
  const MOVE_RATE = 1000 / 30; // send 30 times/sec
  let lastMoveSend = 0;

  function processInput(dt) {
    if (!localPlayer || localPlayer.dead || pub.chatFocused) return;
    let dx = 0, dy = 0;
    if (keys['w'] || keys['arrowup'])    dy -= 1;
    if (keys['s'] || keys['arrowdown'])  dy += 1;
    if (keys['a'] || keys['arrowleft'])  dx -= 1;
    if (keys['d'] || keys['arrowright']) dx += 1;

    if (dx !== 0 && dy !== 0) {
      const len = Math.hypot(dx, dy);
      dx /= len;
      dy /= len;
    }

    if (pub.joystickVector && (pub.joystickVector.x !== 0 || pub.joystickVector.y !== 0)) {
      dx = pub.joystickVector.x;
      dy = pub.joystickVector.y;
    }

    const moving = dx !== 0 || dy !== 0;
    if (moving) {
      const spd = localPlayer.spd || 100;
      const nx = localPlayer.x + dx * spd * dt;
      const ny = localPlayer.y + dy * spd * dt;
      // Client-side prediction
      if (canMoveTo(nx, ny)) { localPlayer.x = nx; localPlayer.y = ny; }
      else if (canMoveTo(nx, localPlayer.y)) { localPlayer.x = nx; }
      else if (canMoveTo(localPlayer.x, ny)) { localPlayer.y = ny; }

      // Direction
      if      (dy < 0) localPlayer.dir = 0;
      else if (dx > 0) localPlayer.dir = 1;
      else if (dy > 0) localPlayer.dir = 2;
      else if (dx < 0) localPlayer.dir = 3;
    }

    localPlayer.moving = moving;
    // Send to server throttled
    const now = Date.now();
    if (now - lastMoveSend > MOVE_RATE) {
      lastMoveSend = now;
      GameNetwork.sendMove(localPlayer.x, localPlayer.y, localPlayer.dir, moving);
    }
  }

  function canMoveTo(x, y, r = 13) {
    if (!map) return false;
    for (const [cx, cy] of [[x-r,y-r],[x+r,y-r],[x-r,y+r],[x+r,y+r],[x,y-r],[x,y+r],[x-r,y],[x+r,y]]) {
      const tx = Math.floor(cx / TILE), ty = Math.floor(cy / TILE);
      if (tx < 0 || ty < 0 || tx >= MAP_W || ty >= MAP_H) return false;
      const t = map[ty][tx];
      if (!(t === 1 || t === 2 || t === 3 || t === 7)) return false;
    }
    return true;
  }

  /* ─── DRAWING ─── */
  function resizeCanvas() {
    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;
  }

  function updateCamera() {
    if (!localPlayer) return;
    cam.x = localPlayer.x - canvas.width  / 2;
    cam.y = localPlayer.y - canvas.height / 2;
    cam.x = Math.max(0, Math.min(cam.x, MAP_W * TILE - canvas.width));
    cam.y = Math.max(0, Math.min(cam.y, MAP_H * TILE - canvas.height));
  }

  function drawMap() {
    if (!map) return;
    const t0 = Date.now() / 1000;
    const tx0 = Math.max(0, Math.floor(cam.x / TILE));
    const ty0 = Math.max(0, Math.floor(cam.y / TILE));
    const tx1 = Math.min(MAP_W - 1, Math.ceil((cam.x + canvas.width)  / TILE));
    const ty1 = Math.min(MAP_H - 1, Math.ceil((cam.y + canvas.height) / TILE));

    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        const tile = map[ty][tx];
        const sx   = tx * TILE - cam.x;
        const sy   = ty * TILE - cam.y;
        const col  = TILE_COLORS[tile] || TILE_COLORS[1];
        ctx.fillStyle = col[0];
        ctx.fillRect(sx, sy, TILE, TILE);

        // Tile decorations
        if (tile === 1) { // grass variation
          if ((tx + ty) % 3 === 0) {
            ctx.fillStyle = col[1];
            ctx.fillRect(sx + 4, sy + 6, 3, 3);
            ctx.fillRect(sx + 14, sy + 20, 2, 2);
          }
        } else if (tile === 2) { // dirt path tracks
          ctx.fillStyle = col[1];
          ctx.fillRect(sx, sy + 6, TILE, 2);
          ctx.fillRect(sx, sy + 22, TILE, 2);
        } else if (tile === 3) { // stone grid
          ctx.strokeStyle = col[1];
          ctx.lineWidth = 0.5;
          ctx.strokeRect(sx, sy, TILE, TILE);
        } else if (tile === 4) { // water shimmer
          const shimmer = Math.sin(t0 * 2 + tx * 0.8 + ty * 0.6) * 0.08 + 0.92;
          ctx.fillStyle = `rgba(40,100,200,${shimmer * 0.3})`;
          ctx.fillRect(sx, sy, TILE, TILE);
          // Wave line
          ctx.fillStyle = `rgba(100,160,255,0.15)`;
          ctx.fillRect(sx, sy + 8 + Math.sin(t0 + tx) * 3, TILE, 3);
        } else if (tile === 5) { // tree
          // Trunk
          ctx.fillStyle = '#4a2e0a';
          ctx.fillRect(sx + 12, sy + 18, 8, 14);
          // Canopy layers
          ctx.fillStyle = '#1a5c14';
          ctx.beginPath(); ctx.ellipse(sx + 16, sy + 18, 13, 10, 0, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = '#228b1a';
          ctx.beginPath(); ctx.ellipse(sx + 16, sy + 10, 10, 8, 0, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = '#2caa20';
          ctx.beginPath(); ctx.ellipse(sx + 16, sy + 4,  7, 6, 0, 0, Math.PI * 2); ctx.fill();
        } else if (tile === 6) { // rock
          ctx.fillStyle = '#3a3344';
          ctx.beginPath();
          ctx.moveTo(sx + 4, sy + TILE - 4);
          ctx.lineTo(sx + 8, sy + 6);
          ctx.lineTo(sx + 22, sy + 4);
          ctx.lineTo(sx + TILE - 4, sy + 10);
          ctx.lineTo(sx + TILE - 6, sy + TILE - 4);
          ctx.closePath(); ctx.fill();
          ctx.fillStyle = '#4a4358';
          ctx.fillRect(sx + 10, sy + 8, 4, 3);
        } else if (tile === 7) { // dungeon
          ctx.strokeStyle = 'rgba(80,60,120,0.3)';
          ctx.lineWidth = 0.8;
          ctx.strokeRect(sx, sy, TILE, TILE);
        }
      }
    }
  }

  function drawPlayer(p, isLocal) {
    if (p.dead) return;
    const sx = p.x - cam.x;
    const sy = p.y - cam.y;
    const bob = p.moving ? Math.sin(Date.now() / 180) * 2 : 0;
    const cls = p.class || 'warrior';
    const col = CLASS_COLORS[cls] || '#aaa';

    ctx.save();
    ctx.translate(sx, sy + bob);

    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath(); ctx.ellipse(0, 14, 12, 5, 0, 0, Math.PI*2); ctx.fill();

    if (cls === 'warrior') {
      // Legs
      ctx.fillStyle = '#555';
      ctx.fillRect(-5, 8, 4, 10); ctx.fillRect(1, 8, 4, 10);
      // Body armor
      ctx.fillStyle = '#888';
      ctx.fillRect(-7, -4, 14, 14);
      ctx.fillStyle = col;
      ctx.fillRect(-6, -4, 12, 10);
      // Pauldrons
      ctx.fillStyle = '#aaa';
      ctx.fillRect(-10, -5, 5, 6); ctx.fillRect(5, -5, 5, 6);
      // Head
      ctx.fillStyle = '#d4a574';
      ctx.fillRect(-5, -16, 10, 10);
      // Helmet
      ctx.fillStyle = '#888';
      ctx.fillRect(-6, -17, 12, 6);
      // Sword (right side)
      ctx.fillStyle = '#ddd';
      ctx.fillRect(8, -12, 3, 18);
      ctx.fillStyle = '#c9952a';
      ctx.fillRect(6, -8, 7, 3);
    } else if (cls === 'mage') {
      // Robe
      ctx.fillStyle = '#2a1a4a';
      ctx.beginPath();
      ctx.moveTo(-7, 18); ctx.lineTo(-9, 0); ctx.lineTo(0, -2); ctx.lineTo(9, 0); ctx.lineTo(7, 18);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = col;
      ctx.fillRect(-6, -2, 12, 10);
      // Hood
      ctx.fillStyle = '#3a2064';
      ctx.beginPath(); ctx.arc(0, -10, 8, Math.PI, 0); ctx.rect(-8, -10, 16, 8); ctx.fill();
      // Face
      ctx.fillStyle = '#d4a574';
      ctx.fillRect(-4, -15, 8, 8);
      // Staff
      ctx.strokeStyle = '#8b6914';
      ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(10, 16); ctx.lineTo(10, -20); ctx.stroke();
      ctx.fillStyle = '#9b59b6';
      ctx.beginPath(); ctx.arc(10, -22, 5, 0, Math.PI*2); ctx.fill();
      ctx.fillStyle = 'rgba(155,89,182,0.4)';
      ctx.beginPath(); ctx.arc(10, -22, 8, 0, Math.PI*2); ctx.fill();
    } else { // archer
      // Legs
      ctx.fillStyle = '#3a5e2a';
      ctx.fillRect(-4, 8, 4, 10); ctx.fillRect(1, 8, 4, 10);
      // Body
      ctx.fillStyle = '#4a7a35';
      ctx.fillRect(-6, -3, 12, 12);
      ctx.fillStyle = col;
      ctx.fillRect(-5, -3, 10, 8);
      // Hood
      ctx.fillStyle = '#3a5e2a';
      ctx.beginPath(); ctx.arc(0, -12, 7, Math.PI, 0); ctx.rect(-7, -12, 14, 7); ctx.fill();
      // Face
      ctx.fillStyle = '#d4a574';
      ctx.fillRect(-4, -16, 8, 8);
      // Bow
      ctx.strokeStyle = '#8b6914';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(-10, 0, 12, -Math.PI/2, Math.PI/2); ctx.stroke();
      ctx.strokeStyle = '#ddd'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(-10, -12); ctx.lineTo(-10, 12); ctx.stroke();
    }

    // Direction indicator
    const dirs = [[0,-1],[1,0],[0,1],[-1,0]];
    const d = dirs[p.dir || 2];
    ctx.fillStyle = 'rgba(255,255,255,0.15)';
    ctx.beginPath(); ctx.arc(d[0]*8, d[1]*8 + bob, 3, 0, Math.PI*2); ctx.fill();

    ctx.restore();

    // Name tag
    ctx.save();
    ctx.font = 'bold 11px Outfit, sans-serif';
    ctx.textAlign = 'center';
    const nameW = ctx.measureText(p.name).width + 10;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(sx - nameW/2, sy - 36 + bob - 10, nameW, 14);
    ctx.fillStyle = isLocal ? '#f5c842' : '#fff';
    ctx.fillText(p.name, sx, sy - 36 + bob);
    // Level badge
    ctx.fillStyle = col;
    ctx.font = 'bold 9px Outfit, sans-serif';
    ctx.fillText(`Lv.${p.level||1}`, sx, sy - 24 + bob);
    ctx.restore();

    // HP bar
    const hpPct = Math.max(0, p.hp / p.maxHp);
    const bw = 36, bh = 4;
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(sx - bw/2, sy - 20 + bob, bw, bh);
    const hpcol = hpPct > 0.5 ? '#2ecc71' : hpPct > 0.25 ? '#f39c12' : '#e74c3c';
    ctx.fillStyle = hpcol;
    ctx.fillRect(sx - bw/2, sy - 20 + bob, bw * hpPct, bh);
    ctx.restore();
  }

  function drawEnemy(e) {
    if (e.dead) return;
    const sx = e.x - cam.x;
    const sy = e.y - cam.y;
    const col = ENEMY_COLORS[e.type] || '#f00';

    ctx.save();
    ctx.translate(sx, sy);

    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath(); ctx.ellipse(0, 14, 10, 4, 0, 0, Math.PI*2); ctx.fill();

    if (e.type === 'goblin') {
      // Legs
      ctx.fillStyle = '#226622';
      ctx.fillRect(-4, 6, 3, 8); ctx.fillRect(2, 6, 3, 8);
      // Body
      ctx.fillStyle = col;
      ctx.fillRect(-6, -4, 12, 12);
      // Head - larger with ears
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.arc(0, -10, 7, 0, Math.PI*2); ctx.fill();
      // Ears
      ctx.beginPath(); ctx.moveTo(-7,-12); ctx.lineTo(-12,-18); ctx.lineTo(-5,-8); ctx.fill();
      ctx.beginPath(); ctx.moveTo(7,-12); ctx.lineTo(12,-18); ctx.lineTo(5,-8); ctx.fill();
      // Eyes
      ctx.fillStyle = '#ff0';
      ctx.beginPath(); ctx.arc(-3,-11,2,0,Math.PI*2); ctx.fill();
      ctx.beginPath(); ctx.arc(3,-11,2,0,Math.PI*2); ctx.fill();
      ctx.fillStyle = '#000';
      ctx.beginPath(); ctx.arc(-3,-11,1,0,Math.PI*2); ctx.fill();
      ctx.beginPath(); ctx.arc(3,-11,1,0,Math.PI*2); ctx.fill();
      // Weapon
      ctx.fillStyle = '#888';
      ctx.fillRect(7, -8, 3, 16);
    } else if (e.type === 'orc') {
      // Bigger enemy
      ctx.scale(1.3, 1.3);
      ctx.fillStyle = '#7a2010';
      ctx.fillRect(-6, 6, 5, 10); ctx.fillRect(2, 6, 5, 10);
      ctx.fillStyle = col;
      ctx.fillRect(-9, -6, 18, 16);
      ctx.fillStyle = '#c0392b';
      ctx.beginPath(); ctx.arc(0, -12, 9, 0, Math.PI*2); ctx.fill();
      ctx.fillStyle = '#ff0';
      ctx.beginPath(); ctx.arc(-3,-13,2.5,0,Math.PI*2); ctx.fill();
      ctx.beginPath(); ctx.arc(3,-13,2.5,0,Math.PI*2); ctx.fill();
      ctx.fillStyle = '#000';
      ctx.beginPath(); ctx.arc(-3,-13,1.2,0,Math.PI*2); ctx.fill();
      ctx.beginPath(); ctx.arc(3,-13,1.2,0,Math.PI*2); ctx.fill();
      // Tusks
      ctx.fillStyle = '#fff';
      ctx.fillRect(-3, -6, 2, 5); ctx.fillRect(2, -6, 2, 5);
      // Axe
      ctx.fillStyle = '#888';
      ctx.fillRect(9, -14, 4, 22);
      ctx.fillStyle = '#aaa';
      ctx.beginPath(); ctx.moveTo(13,-14); ctx.lineTo(20,-10); ctx.lineTo(13,0); ctx.closePath(); ctx.fill();
    } else { // skeleton
      // Bones
      ctx.fillStyle = col;
      // Spine
      ctx.fillRect(-1, -4, 2, 18);
      // Ribs
      for (let i = 0; i < 3; i++) {
        ctx.fillRect(-7, -2 + i*4, 14, 2);
      }
      // Hip
      ctx.fillRect(-5, 10, 10, 3);
      // Legs
      ctx.fillRect(-4, 13, 2, 8); ctx.fillRect(2, 13, 2, 8);
      // Head skull
      ctx.beginPath(); ctx.arc(0, -12, 7, 0, Math.PI*2); ctx.fill();
      // Eye sockets (dark)
      ctx.fillStyle = '#111';
      ctx.beginPath(); ctx.arc(-3,-13,2,0,Math.PI*2); ctx.fill();
      ctx.beginPath(); ctx.arc(3,-13,2,0,Math.PI*2); ctx.fill();
      // Glowing eyes
      ctx.fillStyle = '#00ffcc';
      ctx.beginPath(); ctx.arc(-3,-13,1,0,Math.PI*2); ctx.fill();
      ctx.beginPath(); ctx.arc(3,-13,1,0,Math.PI*2); ctx.fill();
      // Scythe
      ctx.strokeStyle = '#888'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(8,16); ctx.lineTo(8,-20); ctx.stroke();
      ctx.strokeStyle = '#aaa';
      ctx.beginPath(); ctx.arc(8,-18,10,-Math.PI*0.8,0); ctx.stroke();
    }
    ctx.restore();

    // Enemy name + HP bar
    const hpPct = Math.max(0, e.hp / e.maxHp);
    const nameMap = { goblin:'Goblin', orc:'Orco', skeleton:'Esqueleto' };
    const bw = 40, bh = 5;

    ctx.save();
    ctx.font = '10px Outfit, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(255,80,80,0.9)';
    ctx.fillText(nameMap[e.type] || e.type, sx, sy - 26);
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(sx - bw/2, sy - 22, bw, bh);
    ctx.fillStyle = hpPct > 0.5 ? '#e74c3c' : hpPct > 0.25 ? '#e67e22' : '#c0392b';
    ctx.fillRect(sx - bw/2, sy - 22, bw * hpPct, bh);
    ctx.restore();
  }

  function updateAndDrawFX(dt) {
    // Floating texts
    floatingTexts = floatingTexts.filter(t => t.life > 0);
    floatingTexts.forEach(t => {
      t.y  += t.vy * dt;
      t.vy *= 0.95;
      t.life -= dt;
      t.alpha = Math.min(1, t.life / 0.5);
      ctx.save();
      ctx.globalAlpha = t.alpha;
      ctx.font = `bold ${Math.round(14 * t.scale)}px Cinzel, serif`;
      ctx.textAlign = 'center';
      ctx.fillStyle = t.color;
      ctx.shadowColor = t.color;
      ctx.shadowBlur = 8;
      ctx.fillText(t.text, t.x - cam.x, t.y - cam.y);
      ctx.restore();
    });

    // Particles
    particles = particles.filter(p => p.life > 0);
    particles.forEach(p => {
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.vx *= 0.92; p.vy *= 0.92;
      p.life -= dt;
      p.alpha = p.life / 0.5;
      ctx.save();
      ctx.globalAlpha = Math.max(0, p.alpha);
      ctx.fillStyle = p.color;
      ctx.beginPath(); ctx.arc(p.x - cam.x, p.y - cam.y, 3, 0, Math.PI*2); ctx.fill();
      ctx.restore();
    });
  }

  function drawMinimap() {
    if (!map) return;
    const mmW = mmCanvas.width, mmH = mmCanvas.height;
    mmCtx.fillStyle = '#050810';
    mmCtx.fillRect(0, 0, mmW, mmH);

    const tw = mmW / MAP_W, th = mmH / MAP_H;
    for (let ty = 0; ty < MAP_H; ty++) {
      for (let tx = 0; tx < MAP_W; tx++) {
        const t = map[ty][tx];
        mmCtx.fillStyle = MINIMAP_COLORS[t] || '#3a7a30';
        mmCtx.fillRect(tx * tw, ty * th, Math.ceil(tw), Math.ceil(th));
      }
    }
    // Other players
    for (const [id, p] of Object.entries(players)) {
      if (p.dead) continue;
      const px = (p.x / (MAP_W * 32)) * mmW;
      const py = (p.y / (MAP_H * 32)) * mmH;
      mmCtx.fillStyle = id === localId ? '#f5c842' : CLASS_COLORS[p.class] || '#fff';
      mmCtx.beginPath();
      mmCtx.arc(px, py, id === localId ? 3 : 2, 0, Math.PI*2);
      mmCtx.fill();
    }
    // Enemies
    for (const e of Object.values(enemies)) {
      if (e.dead) continue;
      const px = (e.x / (MAP_W * 32)) * mmW;
      const py = (e.y / (MAP_H * 32)) * mmH;
      mmCtx.fillStyle = 'rgba(255,80,80,0.8)';
      mmCtx.fillRect(px - 1, py - 1, 2, 2);
    }
  }

  /* ─── GAME LOOP ─── */
  let lastTime = 0;

  function loop(ts) {
    const dt = Math.min(0.05, (ts - lastTime) / 1000);
    lastTime = ts;

    processInput(dt);
    updateCamera();

    // Clear
    ctx.fillStyle = '#050810';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (map) {
      drawMap();
      // Draw all entities sorted by Y for depth
      const allEntities = [
        ...Object.values(enemies).filter(e => !e.dead).map(e => ({ ...e, _type:'enemy' })),
        ...Object.values(players).filter(p => !p.dead).map(p => ({ ...p, _type:'player' })),
      ].sort((a, b) => a.y - b.y);

      for (const ent of allEntities) {
        if (ent._type === 'enemy') drawEnemy(ent);
        else drawPlayer(ent, ent.id === localId);
      }

      updateAndDrawFX(dt);
      drawMinimap();
    } else {
      // Loading screen
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.font = '20px Outfit, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Conectando al servidor...', canvas.width/2, canvas.height/2);
    }

    requestAnimationFrame(loop);
  }

  function start() {
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
    setupNetwork();
    setupInput();
    requestAnimationFrame(loop);
  }

  return { start, chatFocused: false, get players() { return players; }, get localId() { return localId; }, get joystickVector() { return pub.joystickVector; } };
})();
