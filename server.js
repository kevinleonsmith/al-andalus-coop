// Al-Andalus: Shadows of the Reconquista — co-op server (v2)
// Node + ws. Serves the static client AND the authoritative game server on one port.
//
// A "room" is a shared world. The server owns each world's seed, block edits, clock,
// MOBS, and every player's HEALTH. Terrain is generated client-side from the seed;
// the server reproduces just enough of that generation (surface height, edit-aware
// column lookup) to walk mobs along the ground. Only edits, positions, mob snapshots
// and health travel the wire.
//
// Deploy on Railway: runs `npm start`, reads PORT. The public https URL it gives you is
// also the wss:// URL the client uses (same origin). Leave the client "Server" box blank
// when the page is served from here. See DEPLOY.md.

'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
// Where worlds are saved. Order of preference:
//   1. ANDALUS_SAVE_DIR (explicit override)
//   2. a Railway Volume — Railway injects RAILWAY_VOLUME_MOUNT_PATH when one is attached
//   3. ./worlds next to the server (ephemeral on most hosts — fine for local/dev)
const SAVE_DIR =
  process.env.ANDALUS_SAVE_DIR ||
  (process.env.RAILWAY_VOLUME_MOUNT_PATH ? path.join(process.env.RAILWAY_VOLUME_MOUNT_PATH, 'worlds') : path.join(ROOT, 'worlds'));

// Must mirror the client's WORLD CONSTANTS (script.js).
const SX = 160, SZ = 160, SY = 72;   // must match the client's world size
const CELLS = SX * SY * SZ;
const SEA_LEVEL = 13, WATER = 11;
const MAX_HP = 20;

const DAY_LEN = 240;          // seconds per full day (matches client)
const SAVE_EVERY = 15000;     // ms between disk writes for dirty rooms
const TIME_EVERY = 5000;      // ms between clock broadcasts
const SIM_MS = 100;           // mob simulation + snapshot tick (10 Hz)

// Mob kinds — mirror the client's MOB_TYPES.
const MOB_TYPES = {
  shade:  { hp: 10, speed: 2.7, dmg: 2,   aggro: 22, drop: 1 },
  jackal: { hp: 6,  speed: 4.3, dmg: 1.5, aggro: 26, drop: 1 },
  brute:  { hp: 22, speed: 1.9, dmg: 4,   aggro: 20, drop: 2 },
};
const MOB_MAX = 9, MOB_HIT_CD = 0.8, MOB_RANGE = 1.7, SPAWN_EVERY = 2.0;

/* ----------------------- terrain reproduction (for mob ground) ----------- */
function hash2(seed, x, z) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(z | 0, 668265263) ^ Math.imul(seed, 362437);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967295;
}
const smoothstep = (t) => t * t * (3 - 2 * t);
function valueNoise(seed, x, z) {
  const x0 = Math.floor(x), z0 = Math.floor(z);
  const u = smoothstep(x - x0), v = smoothstep(z - z0);
  const a = hash2(seed, x0, z0), b = hash2(seed, x0 + 1, z0),
        c = hash2(seed, x0, z0 + 1), d = hash2(seed, x0 + 1, z0 + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function heightAt(seed, x, z) {
  let amp = 1, freq = 1 / 28, sum = 0, val = 0;
  for (let o = 0; o < 4; o++) { val += valueNoise(seed, x * freq, z * freq) * amp; sum += amp; amp *= 0.5; freq *= 2; }
  val = Math.pow(val / sum, 1.2);
  return Math.floor(SEA_LEVEL - 5 + val * 24);   // must match the client's heightAt
}
function biomeAt(seed, x, z) {
  const t = valueNoise(seed, x / 72 + 1000, z / 72 + 2000);
  return t < 0.36 ? 'desert' : t > 0.6 ? 'forest' : 'plains';
}
function terrainBlock(seed, x, y, z) {               // no trees — fine for grounding
  const h = heightAt(seed, x, z);
  const beach = h <= SEA_LEVEL + 1;
  const desert = biomeAt(seed, x, z) === 'desert';
  if (y > h) return (y <= SEA_LEVEL) ? WATER : 0;
  if (y === 0) return 3;
  if (y === h) return (beach || desert) ? 4 : 1;
  if (y >= h - 3) return (beach || desert) ? 4 : 2;
  if (desert && y >= h - 7) return 5;
  return 3;
}
function idx(x, y, z) { return y * SX * SZ + z * SX + x; }
function blockAt(room, x, y, z) {
  if (x < 0 || x >= SX || z < 0 || z >= SZ || y < 0 || y >= SY) return 0;
  const e = room.edits[idx(x, y, z)];
  return (e === undefined) ? terrainBlock(room.seed, x, y, z) : e;
}
// highest solid, non-water block in a column (edit-aware) — the ground a mob stands on
function solidTop(room, x, z) {
  for (let y = SY - 1; y >= 1; y--) { const b = blockAt(room, x, y, z); if (b && b !== WATER) return y; }
  return 0;
}
function sunHeightAt(time) { return Math.sin(time * Math.PI * 2 - Math.PI / 2); }

/* ----------------------------- static files ----------------------------- */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};
const STATIC = new Set(['index.html', 'style.css', 'script.js']);
const server = http.createServer((req, res) => {
  let p = decodeURIComponent((req.url || '/').split('?')[0]);
  if (p === '/' || p === '') p = '/index.html';
  if (p === '/health') { res.writeHead(200); res.end('ok'); return; }
  const name = path.basename(path.normalize(p));
  if (!STATIC.has(name)) { res.writeHead(404); res.end('Not found'); return; }
  fs.readFile(path.join(ROOT, name), (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(name)] || 'application/octet-stream' });
    res.end(data);
  });
});

/* -------------------------------- rooms ---------------------------------- */
// room = { name, seed, edits:{i:b}, players:Map<id,P>, mobs:Map<mid,M>, time, day,
//          dirty, mobTimer, nextMob }
// P = { ws, name, x,y,z,yaw, hp, armor, dead }
// M = { id, type, def, x,y,z, yaw, hp, atkCd, wx,wz, wanderT }
const rooms = new Map();
let nextId = 1;
const START_TIME = process.env.ANDALUS_START_TIME ? +process.env.ANDALUS_START_TIME : 0.28;

function seedFromName(name) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < name.length; i++) { h ^= name.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) || 1;
}
function safeFile(name) { return name.replace(/[^a-z0-9_-]+/gi, '_').slice(0, 40) || 'room'; }
function roomPath(name) { return path.join(SAVE_DIR, safeFile(name) + '.json'); }
function loadRoom(name) {
  let seed = seedFromName(name), edits = {};
  try {
    const s = JSON.parse(fs.readFileSync(roomPath(name), 'utf8'));
    if (typeof s.seed === 'number') seed = s.seed >>> 0;
    if (s.edits && typeof s.edits === 'object') edits = s.edits;
  } catch (e) { /* no save yet */ }
  return { name, seed, edits, players: new Map(), mobs: new Map(),
           time: START_TIME, day: 1, dirty: false, mobTimer: 3, nextMob: 1 };
}
function saveRoom(room) {
  try {
    fs.mkdirSync(SAVE_DIR, { recursive: true });
    const p = roomPath(room.name), tmp = p + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ seed: room.seed, edits: room.edits }));
    fs.renameSync(tmp, p);          // atomic swap — a crash mid-write can't corrupt the saved world
    room.dirty = false;
  } catch (e) { console.error('save failed', room.name, e.message); }
}
function getRoom(name) {
  let r = rooms.get(name);
  if (!r) { r = loadRoom(name); rooms.set(name, r); }
  return r;
}

function send(ws, obj) { if (ws.readyState === 1) { try { ws.send(JSON.stringify(obj)); } catch (e) {} } }
function broadcast(room, obj, exceptId) {
  const s = JSON.stringify(obj);
  room.players.forEach((p, id) => { if (id !== exceptId && p.ws.readyState === 1) { try { p.ws.send(s); } catch (e) {} } });
}
function findSpawn(room) {
  for (let t = 0; t < 40; t++) {
    const x = 6 + Math.floor(Math.random() * (SX - 12));
    const z = 6 + Math.floor(Math.random() * (SZ - 12));
    const top = solidTop(room, x, z);
    if (top >= SEA_LEVEL) return { x: x + 0.5, y: top + 1, z: z + 0.5 };
  }
  return { x: SX / 2, y: SY - 2, z: SZ / 2 };
}

/* ------------------------------ mob sim ---------------------------------- */
function livingPlayers(room) {
  const out = [];
  room.players.forEach((p, id) => { if (!p.dead && p.hp > 0) out.push(p); });
  return out;
}
function trySpawnMob(room) {
  const targets = livingPlayers(room);
  if (targets.length === 0) return;
  const anchor = targets[(Math.random() * targets.length) | 0];
  for (let t = 0; t < 14; t++) {
    const ang = Math.random() * Math.PI * 2;
    const d = 12 + Math.random() * 16;
    const x = Math.floor(anchor.x + Math.cos(ang) * d);
    const z = Math.floor(anchor.z + Math.sin(ang) * d);
    if (x < 1 || x >= SX - 1 || z < 1 || z >= SZ - 1) continue;
    const top = solidTop(room, x, z);
    if (top < SEA_LEVEL) continue;                                  // not in the sea
    if (blockAt(room, x, top + 1, z) !== 0 || blockAt(room, x, top + 2, z) !== 0) continue; // headroom
    const r = Math.random();
    const type = r < 0.6 ? 'shade' : r < 0.9 ? 'jackal' : 'brute';
    const id = room.nextMob++;
    room.mobs.set(id, { id, type, def: MOB_TYPES[type], x: x + 0.5, y: top + 1, z: z + 0.5,
                        yaw: 0, hp: MOB_TYPES[type].hp, atkCd: 0.7, wx: 0, wz: 0, wanderT: 0 });
    return;
  }
}
function simMobs(room, dt) {
  const sy = sunHeightAt(room.time);
  const night = sy < 0.03;
  room.mobTimer -= dt;
  if (night && room.mobs.size < MOB_MAX && room.mobTimer <= 0 && livingPlayers(room).length) {
    room.mobTimer = SPAWN_EVERY; trySpawnMob(room);
  }

  const all = [...room.mobs.values()];
  for (const m of all) {
    const def = m.def;
    // nearest living player
    let tgt = null, best = Infinity;
    room.players.forEach((p) => {
      if (p.dead || p.hp <= 0) return;
      const d = Math.hypot(p.x - m.x, p.z - m.z);
      if (d < best) { best = d; tgt = p; }
    });

    let wx = 0, wz = 0;
    if (tgt && best < def.aggro && best > 0.001) { wx = (tgt.x - m.x) / best; wz = (tgt.z - m.z) / best; m.wanderT = 0; }
    else {
      m.wanderT -= dt;
      if (m.wanderT <= 0) { const a = Math.random() * Math.PI * 2; m.wx = Math.cos(a); m.wz = Math.sin(a); m.wanderT = 2 + Math.random() * 3; }
      wx = m.wx * 0.4; wz = m.wz * 0.4;
    }
    // separation
    for (const o of all) {
      if (o === m) continue;
      const ox = m.x - o.x, oz = m.z - o.z, od = ox * ox + oz * oz;
      if (od < 1.6 && od > 0.0001) { const inv = 1 / Math.sqrt(od); wx += ox * inv * 0.5; wz += oz * inv * 0.5; }
    }
    const wl = Math.hypot(wx, wz);
    if (wl > 0.001) {
      const nx = m.x + (wx / wl) * def.speed * dt;
      const nz = m.z + (wz / wl) * def.speed * dt;
      const top = solidTop(room, Math.floor(nx), Math.floor(nz));
      if (top >= SEA_LEVEL) { m.x = nx; m.z = nz; m.y = top + 1; }   // walk the surface; stay out of the sea
      m.yaw = Math.atan2(wx, wz);
    }

    // attack
    m.atkCd -= dt;
    if (tgt && best < MOB_RANGE && Math.abs(tgt.y - m.y) < 2 && m.atkCd <= 0) {
      m.atkCd = MOB_HIT_CD;
      damagePlayer(room, tgt, def.dmg * (tgt.armor ? 0.5 : 1), { x: m.x, z: m.z });
    }

    if (sy > 0.3) m.hp -= dt * 6;                                     // burn away in daylight
    if (m.hp <= 0) { room.mobs.delete(m.id); broadcast(room, { t: 'mobgone', id: m.id }); }
  }

  // position snapshot
  const list = [];
  room.mobs.forEach(m => list.push({ id: m.id, type: m.type, x: +m.x.toFixed(2), y: +m.y.toFixed(2), z: +m.z.toFixed(2), yaw: +m.yaw.toFixed(2) }));
  broadcast(room, { t: 'mobs', list });
}

/* ------------------------------ health ----------------------------------- */
function broadcastHealth(room, p) {
  broadcast(room, { t: 'phealth', id: p.id, hp: +p.hp.toFixed(2) });   // teammate bars (all players)
}
function damagePlayer(room, p, amount, srcPos) {
  if (p.dead || amount <= 0) return;
  p.hp = Math.max(0, p.hp - amount);
  send(p.ws, { t: 'health', hp: +p.hp.toFixed(2), src: srcPos || null });  // owner HUD (carries flash/knockback)
  broadcastHealth(room, p);
  if (p.hp <= 0) { p.dead = true; send(p.ws, { t: 'died' }); }
}
function healPlayer(room, p, amount) {
  if (p.dead || amount <= 0) return;
  p.hp = Math.min(MAX_HP, p.hp + amount);
  send(p.ws, { t: 'health', hp: +p.hp.toFixed(2) });
  broadcastHealth(room, p);
}

/* ----------------------------- ws handling ------------------------------- */
const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  ws.id = nextId++;
  ws.room = null; ws.alive = true;
  ws.on('pong', () => { ws.alive = true; });

  ws.on('message', (buf) => {
    let m; try { m = JSON.parse(buf.toString()); } catch (e) { return; }
    if (!m || typeof m.t !== 'string') return;

    if (m.t === 'join') {
      if (ws.room) return;
      const roomName = String(m.room || 'al-andalus').trim().slice(0, 24) || 'al-andalus';
      const name = String(m.name || 'Traveller').trim().slice(0, 16) || 'Traveller';
      const room = getRoom(roomName);
      ws.room = roomName;
      const sp = findSpawn(room);
      const self = { ws, id: ws.id, name, x: sp.x, y: sp.y, z: sp.z, yaw: 0, hp: MAX_HP, armor: false, dead: false };
      room.players.set(ws.id, self);

      const others = [];
      room.players.forEach((p, id) => { if (id !== ws.id) others.push({ id, name: p.name, x: p.x, y: p.y, z: p.z, yaw: p.yaw, hp: p.hp }); });
      const mobList = [];
      room.mobs.forEach(mm => mobList.push({ id: mm.id, type: mm.type, x: +mm.x.toFixed(2), y: +mm.y.toFixed(2), z: +mm.z.toFixed(2), yaw: +mm.yaw.toFixed(2) }));
      send(ws, { t: 'welcome', id: ws.id, seed: room.seed, time: room.time, day: room.day,
                 edits: room.edits, players: others, mobs: mobList, hp: self.hp, spawn: sp });
      broadcast(room, { t: 'join', id: ws.id, name, x: self.x, y: self.y, z: self.z, yaw: self.yaw, hp: self.hp }, ws.id);
      return;
    }

    const room = ws.room && rooms.get(ws.room);
    if (!room) return;
    const self = room.players.get(ws.id);
    if (!self) return;

    switch (m.t) {
      case 'move':
        if (![m.x, m.y, m.z, m.yaw].every(n => typeof n === 'number' && isFinite(n))) return;
        self.x = m.x; self.y = m.y; self.z = m.z; self.yaw = m.yaw;
        broadcast(room, { t: 'move', id: ws.id, x: m.x, y: m.y, z: m.z, yaw: m.yaw }, ws.id);
        break;

      case 'edit': {
        const i = m.i | 0, b = m.b | 0;
        if (i < 0 || i >= CELLS || b < 0 || b > 255) return;
        room.edits[i] = b;
        room.dirty = true;
        broadcast(room, { t: 'edit', i, b }, ws.id);
        break;
      }

      case 'gear':
        self.armor = !!m.armor;
        break;

      case 'dmg':                                         // fall / starvation, pre-adjusted by client
        if (typeof m.amount === 'number' && m.amount > 0) damagePlayer(room, self, Math.min(100, m.amount), null);
        break;

      case 'heal':                                        // well-fed regen / future items
        if (typeof m.amount === 'number' && m.amount > 0) healPlayer(room, self, Math.min(100, m.amount));
        break;

      case 'mobdmg': {                                    // player struck a mob
        const mob = room.mobs.get(m.mid | 0);
        if (!mob || self.dead) return;
        const dmg = Math.max(0, Math.min(100, +m.dmg || 0));
        mob.hp -= dmg;
        if (mob.hp <= 0) {
          room.mobs.delete(mob.id);
          broadcast(room, { t: 'mobgone', id: mob.id });
          send(ws, { t: 'mobkill', id: mob.id, drop: mob.def.drop });   // attacker gets the dates
        }
        break;
      }

      case 'chat': {
        let text = String(m.text || '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 120);
        if (!text) return;
        broadcast(room, { t: 'chat', id: ws.id, name: self.name, text });   // to everyone, incl. sender
        break;
      }

      case 'respawn': {
        const sp = findSpawn(room);
        self.x = sp.x; self.y = sp.y; self.z = sp.z; self.hp = MAX_HP; self.dead = false;
        send(ws, { t: 'respawned', x: sp.x, y: sp.y, z: sp.z, hp: MAX_HP });
        broadcastHealth(room, self);           // teammates see them back at full
        break;
      }
    }
  });

  ws.on('close', () => {
    const room = ws.room && rooms.get(ws.room);
    if (!room) return;
    room.players.delete(ws.id);
    broadcast(room, { t: 'leave', id: ws.id });
    if (room.players.size === 0) {
      room.mobs.clear();                                  // no one to haunt
      if (room.dirty) saveRoom(room);
    }
  });
});

/* --------------------------- timers / upkeep ----------------------------- */
let lastClock = Date.now();
setInterval(() => {
  const now = Date.now(), dt = (now - lastClock) / 1000; lastClock = now;
  rooms.forEach((room) => {
    if (room.players.size === 0) return;
    const prev = room.time;
    room.time = (room.time + dt / DAY_LEN) % 1;
    if (room.time < prev) room.day++;
    broadcast(room, { t: 'time', time: room.time, day: room.day });
  });
}, TIME_EVERY);

let lastSim = Date.now();
setInterval(() => {
  const now = Date.now(); let dt = (now - lastSim) / 1000; lastSim = now;
  if (dt > 0.5) dt = 0.5;
  rooms.forEach((room) => { if (room.players.size) simMobs(room, dt); });
}, SIM_MS);

setInterval(() => { rooms.forEach(r => { if (r.dirty) saveRoom(r); }); }, SAVE_EVERY);

setInterval(() => {
  wss.clients.forEach(ws => { if (!ws.alive) return ws.terminate(); ws.alive = false; try { ws.ping(); } catch (e) {} });
}, 30000);

function flushAll() { rooms.forEach(r => { if (r.dirty) saveRoom(r); }); }
process.on('SIGTERM', () => { flushAll(); process.exit(0); });   // Railway sends SIGTERM on redeploy
process.on('SIGINT', () => { flushAll(); process.exit(0); });

try { fs.mkdirSync(SAVE_DIR, { recursive: true }); }
catch (e) { console.error('WARNING: cannot create save dir', SAVE_DIR, '-', e.message); }

server.listen(PORT, () => console.log('Al-Andalus co-op server (v2) on :' + PORT + '  · worlds → ' + SAVE_DIR));
