const express = require('express');
const http = require('http');
const path = require('path');
const WebSocket = require('ws');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'client')));

// ── In-memory session store ──────────────────────────────────────────────
// session = {
//   code, createdAt,
//   players: [{ id, name, isHost, connected }],
//   deck: [ { id, type, name, detail, cuisine, distance, address, featured } ],
//   swipes: { playerId: { cardId: 'yes' | 'no' } },
//   status: 'lobby' | 'swiping' | 'matched',
//   match: null | { card, unanimous: boolean, votes: number }
// }
const sessions = new Map();
const sockets = new Map(); // playerId -> ws

function makeCode() {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function makeId() {
  return Math.random().toString(36).slice(2, 10);
}

function broadcast(code, msg) {
  const session = sessions.get(code);
  if (!session) return;
  const data = JSON.stringify(msg);
  for (const p of session.players) {
    const ws = sockets.get(p.id);
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(data);
  }
}

function sessionState(session) {
  return {
    code: session.code,
    players: session.players.map(p => ({ id: p.id, name: p.name, isHost: p.isHost })),
    deck: session.deck,
    status: session.status,
    match: session.match,
    // Per-player progress (counts only, not who voted what on which card)
    progress: Object.fromEntries(
      session.players.map(p => [p.id, Object.keys(session.swipes[p.id] || {}).length])
    ),
  };
}

// Check for a unanimous match: a card every player swiped right on.
function checkUnanimous(session) {
  if (session.players.length < 1) return null;
  for (const card of session.deck) {
    const allYes = session.players.every(p => session.swipes[p.id]?.[card.id] === 'yes');
    if (allYes) return { card, unanimous: true, votes: session.players.length };
  }
  return null;
}

// Majority fallback: card with the most "yes" votes once everyone finished.
function checkMajority(session) {
  const allDone = session.players.every(
    p => Object.keys(session.swipes[p.id] || {}).length >= session.deck.length
  );
  if (!allDone || session.deck.length === 0) return null;
  let best = null;
  let bestVotes = 0;
  for (const card of session.deck) {
    const votes = session.players.filter(p => session.swipes[p.id]?.[card.id] === 'yes').length;
    if (votes > bestVotes) { bestVotes = votes; best = card; }
  }
  if (!best || bestVotes === 0) return null;
  return { card: best, unanimous: false, votes: bestVotes };
}

// ── REST API ─────────────────────────────────────────────────────────────

// Create a session. Body: { hostName, deck? }
app.post('/api/session', (req, res) => {
  let code = makeCode();
  while (sessions.has(code)) code = makeCode();
  const hostId = makeId();
  const session = {
    code,
    createdAt: Date.now(),
    players: [{ id: hostId, name: (req.body.hostName || 'Host').trim() || 'Host', isHost: true, connected: false }],
    deck: Array.isArray(req.body.deck) ? req.body.deck : [],
    swipes: { [hostId]: {} },
    status: 'lobby',
    match: null,
  };
  sessions.set(code, session);
  res.json({ code, playerId: hostId, state: sessionState(session) });
});

// Get session state
app.get('/api/session/:code', (req, res) => {
  const session = sessions.get(req.params.code.toUpperCase());
  if (!session) return res.status(404).json({ error: 'Session not found' });
  res.json(sessionState(session));
});

// Join a session. Body: { name }
app.post('/api/session/:code/join', (req, res) => {
  const session = sessions.get(req.params.code.toUpperCase());
  if (!session) return res.status(404).json({ error: 'Session not found' });
  if (session.status === 'matched') return res.status(400).json({ error: 'Session already matched' });
  const playerId = makeId();
  const player = { id: playerId, name: (req.body.name || 'Guest').trim() || 'Guest', isHost: false, connected: false };
  session.players.push(player);
  session.swipes[playerId] = {};
  broadcast(session.code, { type: 'state', state: sessionState(session) });
  res.json({ playerId, state: sessionState(session) });
});

// Host sets/replaces the deck. Body: { playerId, deck }
app.post('/api/session/:code/deck', (req, res) => {
  const session = sessions.get(req.params.code.toUpperCase());
  if (!session) return res.status(404).json({ error: 'Session not found' });
  const host = session.players.find(p => p.isHost);
  if (!host || host.id !== req.body.playerId) return res.status(403).json({ error: 'Only the host can set the deck' });
  if (!Array.isArray(req.body.deck)) return res.status(400).json({ error: 'Deck must be an array' });
  session.deck = req.body.deck;
  session.swipes = Object.fromEntries(session.players.map(p => [p.id, {}]));
  session.status = session.deck.length > 0 ? 'swiping' : 'lobby';
  session.match = null;
  broadcast(session.code, { type: 'state', state: sessionState(session) });
  res.json(sessionState(session));
});

// Host starts swiping (deck already set). Body: { playerId }
app.post('/api/session/:code/start', (req, res) => {
  const session = sessions.get(req.params.code.toUpperCase());
  if (!session) return res.status(404).json({ error: 'Session not found' });
  const host = session.players.find(p => p.isHost);
  if (!host || host.id !== req.body.playerId) return res.status(403).json({ error: 'Only the host can start' });
  if (session.deck.length === 0) return res.status(400).json({ error: 'Deck is empty' });
  session.status = 'swiping';
  broadcast(session.code, { type: 'state', state: sessionState(session) });
  res.json(sessionState(session));
});

// Record a swipe. Body: { playerId, cardId, direction: 'yes'|'no' }
app.post('/api/session/:code/swipe', (req, res) => {
  const session = sessions.get(req.params.code.toUpperCase());
  if (!session) return res.status(404).json({ error: 'Session not found' });
  const { playerId, cardId, direction } = req.body;
  const player = session.players.find(p => p.id === playerId);
  if (!player) return res.status(403).json({ error: 'Not a player in this session' });
  if (session.status !== 'swiping') return res.status(400).json({ error: 'Not swiping yet' });
  if (!session.deck.some(c => c.id === cardId)) return res.status(400).json({ error: 'Unknown card' });
  if (direction !== 'yes' && direction !== 'no') return res.status(400).json({ error: 'Bad direction' });

  session.swipes[playerId][cardId] = direction;

  // Unanimous match wins immediately.
  const unanimous = checkUnanimous(session);
  if (unanimous) {
    session.status = 'matched';
    session.match = unanimous;
    broadcast(session.code, { type: 'match', match: unanimous, state: sessionState(session) });
    return res.json(sessionState(session));
  }

  // Majority fallback once everyone has finished the deck.
  const majority = checkMajority(session);
  if (majority) {
    session.status = 'matched';
    session.match = majority;
    broadcast(session.code, { type: 'match', match: majority, state: sessionState(session) });
    return res.json(sessionState(session));
  }

  broadcast(session.code, { type: 'state', state: sessionState(session) });
  res.json(sessionState(session));
});

// ── WebSocket (live updates) ─────────────────────────────────────────────
wss.on('connection', (ws, req) => {
  const url = new URL(req.url, 'http://localhost');
  const code = (url.searchParams.get('code') || '').toUpperCase();
  const playerId = url.searchParams.get('playerId') || '';
  const session = sessions.get(code);
  if (!session || !session.players.some(p => p.id === playerId)) {
    ws.close(1008, 'Unknown session or player');
    return;
  }
  sockets.set(playerId, ws);
  ws.send(JSON.stringify({ type: 'state', state: sessionState(session) }));
  ws.on('close', () => { if (sockets.get(playerId) === ws) sockets.delete(playerId); });
});

// Prune sessions older than 24h
setInterval(() => {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  for (const [code, s] of sessions) if (s.createdAt < cutoff) sessions.delete(code);
}, 60 * 60 * 1000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`What's for Dinner server on http://localhost:${PORT}`));
