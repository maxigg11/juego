/* ── GameUI ── */
const GameUI = (() => {
  const notifQueue = [];
  let notifEl, chatLog, chatInput;

  function init() {
    notifEl   = document.getElementById('notif');
    chatLog   = document.getElementById('chat-log');
    chatInput = document.getElementById('chat-input');

    document.getElementById('chat-send').addEventListener('click', sendChat);
    chatInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); sendChat(); }
      e.stopPropagation(); // prevent WASD while typing
    });
    chatInput.addEventListener('focus',  () => GameMain.chatFocused = true);
    chatInput.addEventListener('blur',   () => GameMain.chatFocused = false);
  }

  function sendChat() {
    const txt = chatInput.value.trim();
    if (!txt) return;
    GameNetwork.sendChat(txt);
    chatInput.value = '';
  }

  function updateHUD(player) {
    if (!player) return;
    document.getElementById('hud-name').textContent = player.name;
    const clsEl = document.getElementById('hud-class');
    const clsName = { warrior:'GUERRERO', mage:'MAGO', archer:'ARQUERO' }[player.class] || '';
    clsEl.textContent = clsName;
    clsEl.className = 'p-class cls-' + player.class;
    document.getElementById('level-badge').textContent = player.level || 1;
    const hpPct = Math.max(0, Math.min(100, (player.hp / player.maxHp) * 100));
    document.getElementById('hp-fill').style.width = hpPct + '%';
    document.getElementById('hp-text').textContent = Math.max(0, player.hp) + '/' + player.maxHp;
    const expPct = player.expToNext > 0 ? Math.min(100,(player.exp / player.expToNext)*100) : 100;
    document.getElementById('exp-fill').style.width = expPct + '%';
    document.getElementById('exp-text').textContent = player.exp + ' XP';
  }

  function addChat(name, msg, type = '') {
    const el = document.createElement('div');
    el.className = 'chat-msg' + (type ? ' ' + type : '');
    if (type === 'lvl' || type === 'kill' || type === 'sys') {
      el.textContent = msg;
    } else {
      const nameColors = { warrior:'#e74c3c', mage:'#9b59b6', archer:'#27ae60' };
      const cls = GameMain.players?.[GameNetwork.getPlayerId()]?.class;
      el.innerHTML = `<span class="cn" style="color:${nameColors[cls]||'#aaa'}">${escHtml(name)}:</span> ${escHtml(msg)}`;
    }
    chatLog.appendChild(el);
    chatLog.scrollTop = chatLog.scrollHeight;
    // Keep last 60 messages
    while (chatLog.children.length > 60) chatLog.removeChild(chatLog.firstChild);
  }

  function addChatFull(name, cls, msg) {
    const el = document.createElement('div');
    el.className = 'chat-msg';
    const col = { warrior:'#e74c3c', mage:'#9b59b6', archer:'#27ae60' }[cls] || '#aaa';
    el.innerHTML = `<span class="cn" style="color:${col}">${escHtml(name)}:</span> ${escHtml(msg)}`;
    chatLog.appendChild(el);
    chatLog.scrollTop = chatLog.scrollHeight;
    while (chatLog.children.length > 60) chatLog.removeChild(chatLog.firstChild);
  }

  function showNotif(text, color = '#f5c842') {
    const el = document.createElement('div');
    el.className = 'notif-item';
    el.style.color = color;
    el.style.borderColor = color + '44';
    el.textContent = text;
    notifEl.appendChild(el);
    setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, 3200);
  }

  function setDead(isDead, respawnMs = 0) {
    const overlay = document.getElementById('death-overlay');
    const txt     = document.getElementById('death-text');
    const timer   = document.getElementById('respawn-timer');
    overlay.classList.toggle('active', isDead);
    txt.classList.toggle('visible', isDead);
    timer.classList.toggle('visible', isDead);
    if (isDead) {
      let remaining = Math.ceil(respawnMs / 1000);
      timer.textContent = `Reapareciendo en ${remaining}s...`;
      const iv = setInterval(() => {
        remaining--;
        if (remaining <= 0) { clearInterval(iv); return; }
        timer.textContent = `Reapareciendo en ${remaining}s...`;
      }, 1000);
    }
  }

  function escHtml(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  return { init, updateHUD, addChat, addChatFull, showNotif, setDead };
})();
