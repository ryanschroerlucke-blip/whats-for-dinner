// ── What's for Dinner? — client app ──────────────────────────────────────
const $ = id => document.getElementById(id);
const API = {
  async post(path, body) {
    const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Request failed');
    return data;
  },
  async get(path) {
    const r = await fetch(path);
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Request failed');
    return data;
  },
};

// ── State ──────────────────────────────────────────────────────────────────
let session = null;          // server session state
let myId = null;             // my primary player id
let myPlayers = [];          // player ids on THIS device (pass-the-phone)
let localIdx = 0;            // which of myPlayers is currently swiping
let cardIdx = 0;             // current card index for the active local player
let ws = null;
let deckBuilt = false;

// ── Recipes (localStorage) ────────────────────────────────────────────────
const recipeKey = 'wfd-recipes';
function getRecipes() { try { return JSON.parse(localStorage.getItem(recipeKey)) || []; } catch { return []; } }
function saveRecipes(list) { localStorage.setItem(recipeKey, JSON.stringify(list)); }

// ── Helpers ────────────────────────────────────────────────────────────────
function show(screenId) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  $(screenId).classList.add('active');
  window.scrollTo(0, 0);
}
let toastTimer;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 3000);
}
function uid() { return Math.random().toString(36).slice(2, 10); }
function emojiFor(card) {
  if (card.type === 'recipe') return '🍳';
  const c = (card.cuisine || '').toLowerCase();
  if (c.includes('pizza')) return '🍕';
  if (c.includes('sushi') || c.includes('japanese')) return '🍣';
  if (c.includes('burger') || c.includes('american')) return '🍔';
  if (c.includes('mexican') || c.includes('taco')) return '🌮';
  if (c.includes('chinese') || c.includes('asian')) return '🥡';
  if (c.includes('italian') || c.includes('pasta')) return '🍝';
  if (c.includes('indian') || c.includes('curry')) return '🍛';
  if (c.includes('chicken')) return '🍗';
  if (c.includes('coffee') || c.includes('cafe')) return '☕';
  if (c.includes('sandwich') || c.includes('deli')) return '🥪';
  if (c.includes('seafood') || c.includes('fish')) return '🦐';
  return '🍽️';
}
function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── WebSocket ──────────────────────────────────────────────────────────────
function connectWS() {
  if (!session || !myId) return;
  if (ws) ws.close();
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${proto}//${location.host}/?code=${session.code}&playerId=${myId}`);
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === 'match') { session = msg.state; showMatch(msg.match); }
    else if (msg.type === 'state') { session = msg.state; renderLobby(); maybeAdvance(); }
  };
  ws.onclose = () => setTimeout(connectWS, 3000);
}

// ── Home ───────────────────────────────────────────────────────────────────
$('btn-create').onclick = async () => {
  const name = $('home-name').value.trim() || 'Host';
  try {
    const data = await API.post('/api/session', { hostName: name });
    session = data.state;
    myId = data.playerId;
    myPlayers = [myId];
    localStorage.setItem('wfd-name', name);
    enterLobby();
  } catch (e) { toast(e.message); }
};

$('btn-join').onclick = async () => {
  const code = $('join-code').value.trim().toUpperCase();
  const name = $('home-name').value.trim() || 'Guest';
  if (!code) return toast('Enter a group code first');
  try {
    const data = await API.post(`/api/session/${code}/join`, { name });
    session = data.state;
    myId = data.playerId;
    myPlayers = [myId];
    localStorage.setItem('wfd-name', name);
    enterLobby();
  } catch (e) { toast(e.message); }
};

$('btn-recipes').onclick = () => { renderRecipes(); show('screen-recipes'); };
$('btn-recipes-back').onclick = () => show('screen-home');
$('btn-lobby-back').onclick = () => { if (ws) ws.close(); show('screen-home'); };

// Auto-fill join code from ?code= link + remembered name
(function init() {
  const params = new URLSearchParams(location.search);
  const code = params.get('code');
  if (code) $('join-code').value = code.toUpperCase();
  const savedName = localStorage.getItem('wfd-name');
  if (savedName) $('home-name').value = savedName;
})();

// ── Lobby ──────────────────────────────────────────────────────────────────
function enterLobby() {
  renderLobby();
  show('screen-lobby');
  connectWS();
  // QR code for joining
  const qrBox = $('lobby-qr');
  qrBox.innerHTML = '';
  const joinUrl = `${location.origin}${location.pathname}?code=${session.code}`;
  new QRCode(qrBox, { text: joinUrl, width: 170, height: 170 });
}

function renderLobby() {
  if (!session) return;
  $('lobby-code').textContent = session.code;
  $('player-count').textContent = session.players.length;
  $('player-list').innerHTML = session.players.map(p =>
    `<li><span>${p.name}${p.id === myId ? ' (you)' : ''}</span>${p.isHost ? '<span class="host-tag">host</span>' : ''}</li>`
  ).join('');
  const isHost = session.players.find(p => p.id === myId)?.isHost;
  $('btn-start').disabled = !isHost || session.deck.length === 0;
  $('btn-build-deck').style.display = isHost ? 'block' : 'none';
  $('btn-start').style.display = isHost ? 'block' : 'none';
  $('add-player-row').style.display = isHost ? 'flex' : 'none';
  if (deckBuilt) $('deck-status').textContent = `${session.deck.length} options in the deck — ready!`;
}

$('btn-add-player').onclick = async () => {
  const name = $('add-player-name').value.trim();
  if (!name) return toast('Enter a name for this player');
  try {
    // Pass-the-phone players join via the normal join endpoint; we keep their id locally.
    const data = await API.post(`/api/session/${session.code}/join`, { name });
    myPlayers.push(data.playerId);
    session = data.state;
    $('add-player-name').value = '';
    renderLobby();
    toast(`${name} added — pass the phone to them when it's their turn`);
  } catch (e) { toast(e.message); }
};

// ── Deck building ──────────────────────────────────────────────────────────
async function getCoords() {
  // Try browser geolocation first
  try {
    const pos = await new Promise((resolve, reject) => {
      if (!navigator.geolocation) return reject(new Error('No geolocation'));
      navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 8000 });
    });
    return { lat: pos.coords.latitude, lon: pos.coords.longitude, source: 'gps' };
  } catch { return null; }
}

async function fetchRestaurants(lat, lon, radiusKm) {
  const radiusM = radiusKm * 1000;
  const query = `[out:json][timeout:25];(node["amenity"~"restaurant|fast_food"](around:${radiusM},${lat},${lon});way["amenity"~"restaurant|fast_food"](around:${radiusM},${lat},${lon}););out center tags;`;
  const r = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'data=' + encodeURIComponent(query),
  });
  if (!r.ok) throw new Error('Restaurant lookup failed');
  const data = await r.json();
  const seen = new Set();
  return (data.elements || [])
    .filter(el => el.tags && el.tags.name && !seen.has(el.tags.name.toLowerCase()) && !seen.add(el.tags.name.toLowerCase()))
    .map(el => {
      const plat = el.lat ?? el.center?.lat;
      const plon = el.lon ?? el.center?.lon;
      return {
        id: 'r-' + uid(),
        type: 'restaurant',
        name: el.tags.name,
        cuisine: el.tags.cuisine ? el.tags.cuisine.split(';')[0] : '',
        address: [el.tags['addr:street'], el.tags['addr:city']].filter(Boolean).join(', '),
        lat: plat, lon: plon,
        distance: (plat && plon) ? haversine(lat, lon, plat, plon) : null,
        featured: false, // v2 monetization slot: paid featured restaurants sort first
      };
    })
    .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))
    .slice(0, 30);
}

$('btn-build-deck').onclick = async () => {
  if (!session) return;
  const wantRestaurants = $('toggle-restaurants').checked;
  const wantRecipes = $('toggle-recipes').checked;
  const radiusKm = parseInt($('radius-select').value, 10);
  $('deck-status').textContent = 'Building deck…';
  $('btn-build-deck').disabled = true;

  let deck = [];
  // Recipes first (they're personal, always available)
  if (wantRecipes) {
    deck.push(...getRecipes().map(r => ({
      id: 'h-' + r.id, type: 'recipe', name: r.name, detail: r.detail || 'Home recipe', featured: false,
    })));
  }
  // Restaurants from maps
  if (wantRestaurants) {
    try {
      const coords = await getCoords();
      if (!coords) {
        toast('Location blocked — deck has recipes only. Allow location for restaurants.');
      } else {
        const spots = await fetchRestaurants(coords.lat, coords.lon, radiusKm);
        deck.push(...spots);
        if (spots.length === 0) toast('No restaurants found nearby — try a bigger radius.');
      }
    } catch (e) {
      toast('Restaurant lookup hiccup — deck has recipes only.');
    }
  }

  // Featured first (v2 monetization), then shuffle the rest
  const featured = deck.filter(c => c.featured);
  const rest = deck.filter(c => !c.featured);
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }
  deck = [...featured, ...rest];

  if (deck.length === 0) {
    $('deck-status').textContent = 'Deck is empty — add a recipe or allow location.';
    $('btn-build-deck').disabled = false;
    return;
  }
  try {
    session = await API.post(`/api/session/${session.code}/deck`, { playerId: myId, deck });
    deckBuilt = true;
    renderLobby();
    toast(`${deck.length} options in the deck!`);
  } catch (e) { toast(e.message); }
  $('btn-build-deck').disabled = false;
};

$('btn-start').onclick = async () => {
  try {
    session = await API.post(`/api/session/${session.code}/start`, { playerId: myId });
    startSwiping();
  } catch (e) { toast(e.message); }
};

// ── Swiping ────────────────────────────────────────────────────────────────
function startSwiping() {
  localIdx = 0;
  cardIdx = 0;
  show('screen-swipe');
  renderSwipe();
}

function activePlayerId() { return myPlayers[localIdx]; }

function renderSwipe() {
  if (!session || session.status === 'matched') return;
  const pid = activePlayerId();
  const player = session.players.find(p => p.id === pid);
  const done = (session.progress[pid] || 0);
  const total = session.deck.length;

  // This local player finished the deck
  if (done >= total) {
    if (localIdx < myPlayers.length - 1) {
      // Pass the phone to the next local player
      localIdx++;
      $('pass-name').textContent = session.players.find(p => p.id === activePlayerId())?.name || 'next player';
      $('pass-banner').classList.remove('hidden');
      $('deck-area').style.display = 'none';
      document.querySelector('.swipe-buttons').style.display = 'none';
      $('swipe-player').textContent = 'Pass the phone';
      $('swipe-progress').textContent = '';
      return;
    }
    // All my local players done — wait for remote players / match
    $('pass-banner').classList.add('hidden');
    $('deck-area').style.display = 'none';
    document.querySelector('.swipe-buttons').style.display = 'none';
    $('swipe-player').textContent = 'All done!';
    $('swipe-progress').textContent = 'Waiting for the group…';
    return;
  }

  $('pass-banner').classList.add('hidden');
  $('deck-area').style.display = 'flex';
  document.querySelector('.swipe-buttons').style.display = 'flex';
  $('swipe-player').textContent = myPlayers.length > 1 ? `${player?.name || 'You'}'s turn` : (player?.name || 'You');
  $('swipe-progress').textContent = `${done + 1} of ${total}`;
  cardIdx = done;
  showCard(session.deck[cardIdx]);
}

$('btn-ready').onclick = () => { renderSwipe(); };

function showCard(card) {
  const el = $('swipe-card');
  el.style.transform = '';
  el.style.opacity = '';
  el.classList.remove('dragging');
  const badge = $('card-badge');
  if (card.featured) { badge.textContent = '⭐ Featured'; badge.className = 'card-badge featured'; }
  else if (card.type === 'recipe') { badge.textContent = 'Home recipe'; badge.className = 'card-badge recipe'; }
  else { badge.textContent = 'Restaurant'; badge.className = 'card-badge restaurant'; }
  $('card-emoji').textContent = emojiFor(card);
  $('card-name').textContent = card.name;
  $('card-detail').textContent = card.detail || (card.cuisine ? card.cuisine.charAt(0).toUpperCase() + card.cuisine.slice(1) : '');
  $('card-meta').textContent = [
    card.distance != null ? `${card.distance.toFixed(1)} km away` : '',
    card.address || '',
  ].filter(Boolean).join(' · ');
}

async function swipe(direction) {
  const card = session.deck[cardIdx];
  if (!card) return;
  const pid = activePlayerId();
  try {
    session = await API.post(`/api/session/${session.code}/swipe`, { playerId: pid, cardId: card.id, direction });
    if (session.status === 'matched' && session.match) { showMatch(session.match); return; }
    renderSwipe();
  } catch (e) { toast(e.message); }
}

$('btn-yes').onclick = () => swipe('yes');
$('btn-no').onclick = () => swipe('no');

// Drag-to-swipe
(function dragSwipe() {
  const el = $('swipe-card');
  let startX = 0, dx = 0, dragging = false;
  el.addEventListener('pointerdown', e => { dragging = true; startX = e.clientX; el.classList.add('dragging'); });
  el.addEventListener('pointermove', e => {
    if (!dragging) return;
    dx = e.clientX - startX;
    el.style.transform = `translateX(${dx}px) rotate(${dx / 18}deg)`;
    el.style.opacity = 1 - Math.min(Math.abs(dx) / 400, 0.6);
  });
  function end() {
    if (!dragging) return;
    dragging = false;
    el.classList.remove('dragging');
    if (dx > 90) { el.style.transform = 'translateX(120%) rotate(12deg)'; setTimeout(() => swipe('yes'), 120); }
    else if (dx < -90) { el.style.transform = 'translateX(-120%) rotate(-12deg)'; setTimeout(() => swipe('no'), 120); }
    else { el.style.transform = ''; el.style.opacity = ''; }
    dx = 0;
  }
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
})();

// If server state changed (e.g. a remote player triggered a match), keep UI honest
function maybeAdvance() {
  if (session?.status === 'matched' && session.match) { showMatch(session.match); return; }
  if (document.querySelector('#screen-swipe.active')) renderSwipe();
}

// ── Match ──────────────────────────────────────────────────────────────────
function showMatch(match) {
  const card = match.card;
  $('match-emoji').textContent = emojiFor(card);
  $('match-name').textContent = card.name;
  $('match-detail').textContent = card.detail || (card.cuisine ? card.cuisine.charAt(0).toUpperCase() + card.cuisine.slice(1) : '');
  $('match-meta').textContent = [
    card.distance != null ? `${card.distance.toFixed(1)} km away` : '',
    card.address || '',
  ].filter(Boolean).join(' · ');
  $('match-how').textContent = match.unanimous
    ? `Everyone swiped right — unanimous!`
    : `No unanimous pick, so majority rules — ${match.votes} of ${session.players.length} said yes.`;
  const mapsBtn = $('match-maps');
  if (card.type === 'restaurant' && card.lat && card.lon) {
    mapsBtn.href = `https://www.google.com/maps/dir/?api=1&destination=${card.lat},${card.lon}`;
    mapsBtn.style.display = 'block';
  } else {
    mapsBtn.style.display = 'none';
  }
  show('screen-match');
}

$('btn-again').onclick = () => {
  deckBuilt = false;
  session.status = 'lobby';
  enterLobby();
};

// ── Recipes screen ──────────────────────────────────────────────────────────
function renderRecipes() {
  const list = getRecipes();
  $('recipe-list').innerHTML = list.length === 0
    ? '<li><span class="hint">No recipes yet — add your first one above.</span></li>'
    : list.map(r => `<li><span><strong>${r.name}</strong>${r.detail ? `<br><small>${r.detail}</small>` : ''}</span><button class="del" data-id="${r.id}" title="Remove">✕</button></li>`).join('');
  $('recipe-list').querySelectorAll('.del').forEach(btn => {
    btn.onclick = () => {
      saveRecipes(getRecipes().filter(r => r.id !== btn.dataset.id));
      renderRecipes();
    };
  });
}

$('btn-add-recipe').onclick = () => {
  const name = $('recipe-name').value.trim();
  const detail = $('recipe-detail').value.trim();
  if (!name) return toast('Give the recipe a name first');
  const list = getRecipes();
  list.push({ id: uid(), name, detail });
  saveRecipes(list);
  $('recipe-name').value = '';
  $('recipe-detail').value = '';
  renderRecipes();
  toast('Recipe added!');
};

// Register service worker for installability
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
