// Çalıştır: node server.js  (bağımlılık yok, sadece Node.js gerekir)
const http = require('http');
const fs = require('fs');
const path = require('path');
const Chess = require('./chess.js');

const PORT = process.env.PORT || 3000;
const STATIC = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/index.html': ['index.html', 'text/html; charset=utf-8'],
  '/chess.js': ['chess.js', 'application/javascript; charset=utf-8'],
  '/bot.js': ['bot.js', 'application/javascript; charset=utf-8'],
  '/bot-worker.js': ['bot-worker.js', 'application/javascript; charset=utf-8'],
};

const clients = new Map(); // id -> { res, game, name }

// Oyuncu ismi: 3-15 karakter, kontrol karakterleri ve < > temizlenir
function cleanName(n) {
  const s = String(n || '').replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim();
  const len = [...s].length;
  return len >= 3 && len <= 15 ? s : 'Player';
}
let waiting = null;

function send(id, event, data) {
  const c = clients.get(id);
  if (c) c.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}
function broadcastOnline() {
  for (const id of clients.keys()) send(id, 'online', { count: clients.size });
}
function releaseGame(g) {
  g.over = true;
  for (const id of [g.white, g.black]) {
    const c = clients.get(id);
    if (c && c.game === g) c.game = null;
  }
}
function endGame(g, reason, winner) {
  if (g.over) return;
  const ids = [g.white, g.black];
  releaseGame(g);
  ids.forEach(id => send(id, 'over', { reason, winner }));
}

function find(id, name) {
  const c = clients.get(id);
  if (!c) return;
  c.name = cleanName(name);
  // Oyuncu menüden "Oyna"ya bastıysa eski/bayat bir oyunu varsa bitir
  if (c.game && !c.game.over) {
    const g = c.game;
    const opponent = g.white === id ? g.black : g.white;
    releaseGame(g);
    send(opponent, 'over', { reason: 'disconnect', winner: g.white === id ? 'b' : 'w' });
  }
  c.game = null;
  if (waiting === id) { send(id, 'waiting', {}); return; }
  if (waiting && clients.has(waiting) && !clients.get(waiting).game) {
    const other = waiting;
    waiting = null;
    const [white, black] = Math.random() < 0.5 ? [other, id] : [id, other];
    const g = { white, black, state: Chess.initialState(), over: false };
    clients.get(white).game = g;
    clients.get(black).game = g;
    send(white, 'start', { color: 'w', opp: clients.get(black).name });
    send(black, 'start', { color: 'b', opp: clients.get(white).name });
  } else {
    waiting = id;
    send(id, 'waiting', {});
  }
}

function move(id, body) {
  const g = clients.get(id) && clients.get(id).game;
  if (!g || g.over) return false;
  const color = g.white === id ? 'w' : 'b';
  if (g.state.turn !== color) return false;
  const m = Chess.legal(g.state).find(x => x.from === body.from && x.to === body.to && (x.promo || null) === (body.promo || null));
  if (!m) return false;
  g.state = Chess.apply(g.state, m);
  const st = Chess.status(g.state);
  const payload = { from: m.from, to: m.to, promo: m.promo || null, status: st, winner: st === 'checkmate' ? color : null };
  const ids = [g.white, g.black];
  if (st !== 'playing') releaseGame(g);
  ids.forEach(pid => send(pid, 'move', payload));
  return true;
}

function readBody(req) {
  return new Promise(resolve => {
    let data = '';
    req.on('data', ch => { data += ch; if (data.length > 2000) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch { resolve({}); } });
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');

  if (req.method === 'GET' && url.pathname === '/events') {
    const id = url.searchParams.get('id');
    if (!id || id.length < 8 || id.length > 64) { res.writeHead(400); return res.end(); }
    res.writeHead(200, {
      'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache',
      Connection: 'keep-alive', 'X-Accel-Buffering': 'no',
    });
    res.write('retry: 2000\n\n');
    clients.set(id, { res, game: null, name: 'Player' });
    send(id, 'hello', {});
    const ping = setInterval(() => res.write(': ping\n\n'), 20000);
    broadcastOnline();
    req.on('close', () => {
      clearInterval(ping);
      const c = clients.get(id);
      if (!c || c.res !== res) return;
      clients.delete(id);
      if (waiting === id) waiting = null;
      if (c.game && !c.game.over) endGame(c.game, 'disconnect', c.game.white === id ? 'b' : 'w');
      broadcastOnline();
    });
    return;
  }

  if (req.method === 'POST' && url.pathname.startsWith('/api/')) {
    const body = await readBody(req);
    const id = body.id;
    let ok = true;
    if (!clients.has(id)) ok = false;
    else if (url.pathname === '/api/find') find(id, body.name);
    else if (url.pathname === '/api/cancel') { if (waiting === id) waiting = null; }
    else if (url.pathname === '/api/move') ok = move(id, body);
    else if (url.pathname === '/api/resign') {
      const g = clients.get(id).game;
      if (g) endGame(g, 'resign', g.white === id ? 'b' : 'w');
    } else ok = false;
    res.writeHead(ok ? 200 : 400, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok }));
  }

  // Sağlık kontrolü: dışarıdan "açık mısın?" diye sorulan hafif adres
  if ((req.method === 'GET' || req.method === 'HEAD') && url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
    return res.end(req.method === 'HEAD' ? undefined : 'ok');
  }

  const file = STATIC[url.pathname];
  if (req.method === 'GET' && file) {
    fs.readFile(path.join(__dirname, file[0]), (err, buf) => {
      if (err) { res.writeHead(500); return res.end('Hata'); }
      res.writeHead(200, { 'Content-Type': file[1], 'Cache-Control': 'no-cache' });
      res.end(buf);
    });
    return;
  }
  res.writeHead(404);
  res.end('Bulunamadı');
});

server.listen(PORT, () => console.log(`Satranç sunucusu hazır: http://localhost:${PORT}`));
