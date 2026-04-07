/* ── GameNetwork ── */
const GameNetwork = (() => {
  let ws, playerId, onReady;

  const handlers = {};
  const on = (type, fn) => handlers[type] = fn;
  const emit = (msg) => { if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg)); };

  function connect(url, name, cls, readyCb) {
    onReady = readyCb;
    ws = new WebSocket(url);
    ws.onopen = () => {
      if (onReady) onReady();
      emit({ type: 'join', name, class: cls });
    };
    ws.onmessage = (e) => {
      let msg; try { msg = JSON.parse(e.data); } catch { return; }
      if (handlers[msg.type]) handlers[msg.type](msg);
    };
    ws.onclose = () => GameUI.addChat('Sistema', 'Desconectado del servidor.', 'sys');
    ws.onerror = () => GameUI.addChat('Sistema', 'Error de conexión.', 'sys');
  }

  function sendMove(x, y, dir, moving) {
    emit({ type: 'move', x, y, dir, moving });
  }
  function sendAttack(targetId) {
    emit({ type: 'attack', targetId });
  }
  function sendChat(message) {
    emit({ type: 'chat', message });
  }
  function setPlayerId(id) { playerId = id; }
  function getPlayerId() { return playerId; }

  return { connect, on, sendMove, sendAttack, sendChat, setPlayerId, getPlayerId };
})();
