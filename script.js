// Al-Andalus: Shadows of the Reconquista
// A blocky voxel survival-builder. Vanilla JS + Three.js (ES module from CDN).
// Client-side only — uploads straight to Hostinger.

import * as THREE from 'three';

/* ============================================================
   WORLD CONSTANTS
   ============================================================ */
const SX = 96, SZ = 96, SY = 52;   // world size (blocks)
const CH = 16;                      // chunk width/depth
const CULL_DIST = 150;              // hide chunks beyond this (perf)
const SEA_LEVEL = 13;
let SEED = 1337;                    // overwritten per active world at load
const WATER = 11;

const HOTBAR_TYPES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const WORLDS_KEY = 'andalus_worlds_v1';   // registry of named worlds
const ACTIVE_KEY = 'andalus_active_world';
const LEGACY_SAVE_KEY = 'andalus_voxel_save_v2';

// hex -> [r,g,b] in 0..1
const rgb = (h) => [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255];

const BLOCKS = {
  1:  { name: 'Grass',      top: rgb(0x5f7d33), side: rgb(0x6e4e2e), bottom: rgb(0x6e4e2e) },
  2:  { name: 'Dirt',       top: rgb(0x6e4e2e), side: rgb(0x6e4e2e), bottom: rgb(0x6e4e2e) },
  3:  { name: 'Stone',      top: rgb(0x8c8c88), side: rgb(0x82827e), bottom: rgb(0x767672) },
  4:  { name: 'Sand',       top: rgb(0xddc988), side: rgb(0xd4bd79), bottom: rgb(0xcbb36e) },
  5:  { name: 'Sandstone',  top: rgb(0xd8c48a), side: rgb(0xcdb27a), bottom: rgb(0xbfa36b) },
  6:  { name: 'Terracotta', top: rgb(0xbf6b49), side: rgb(0xb06142), bottom: rgb(0x9c5339) },
  7:  { name: 'Azulejo',    top: rgb(0x239079), side: rgb(0x1f7d66), bottom: rgb(0x186351) },
  8:  { name: 'Copper',     top: rgb(0xc77d34), side: rgb(0xb5702f), bottom: rgb(0x965c27) },
  9:  { name: 'Wood',       top: rgb(0x7a5631), side: rgb(0x5c3f24), bottom: rgb(0x7a5631) },
  10: { name: 'Leaves',     top: rgb(0x46773e), side: rgb(0x3f6e38), bottom: rgb(0x356030) },
  11: { name: 'Water',      top: rgb(0x2f74a6), side: rgb(0x2b6ea0), bottom: rgb(0x255f8c) },
};

/* ============================================================
   WORLD DATA + PROCEDURAL GENERATION
   ============================================================ */
const world = new Uint8Array(SX * SY * SZ);
const edits = {}; // index -> type (player modifications, persisted)

const idx = (x, y, z) => x + z * SX + y * SX * SZ;
const inWorld = (x, y, z) => x >= 0 && x < SX && y >= 0 && y < SY && z >= 0 && z < SZ;

function getBlock(x, y, z) {
  if (!inWorld(x, y, z)) return 0;
  return world[idx(x, y, z)];
}
function setBlockRaw(x, y, z, t) {
  if (inWorld(x, y, z)) world[idx(x, y, z)] = t;
}

// deterministic hash -> 0..1
function hash2(x, z) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(z | 0, 668265263) ^ Math.imul(SEED, 362437);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967295;
}
const smoothstep = (t) => t * t * (3 - 2 * t);
function valueNoise(x, z) {
  const x0 = Math.floor(x), z0 = Math.floor(z);
  const u = smoothstep(x - x0), v = smoothstep(z - z0);
  const a = hash2(x0, z0), b = hash2(x0 + 1, z0),
        c = hash2(x0, z0 + 1), d = hash2(x0 + 1, z0 + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function heightAt(x, z) {
  let amp = 1, freq = 1 / 28, sum = 0, val = 0;
  for (let o = 0; o < 4; o++) {
    val += valueNoise(x * freq, z * freq) * amp;
    sum += amp; amp *= 0.5; freq *= 2;
  }
  val = Math.pow(val / sum, 1.2);
  return Math.floor(SEA_LEVEL - 4 + val * 16);
}

// low-frequency noise picks a biome per column
function biomeAt(x, z) {
  const t = valueNoise(x / 72 + 1000, z / 72 + 2000);
  return t < 0.36 ? 'desert' : t > 0.6 ? 'forest' : 'plains';
}

function generateTerrain() {
  world.fill(0);
  for (let x = 0; x < SX; x++) {
    for (let z = 0; z < SZ; z++) {
      const h = heightAt(x, z);
      const beach = h <= SEA_LEVEL + 1;
      const desert = biomeAt(x, z) === 'desert';
      const top = (beach || desert) ? 4 : 1;       // sand or grass
      const sub = (beach || desert) ? 4 : 2;       // sand or dirt
      for (let y = 0; y <= Math.max(h, SEA_LEVEL); y++) {
        if (y > h) {
          if (y <= SEA_LEVEL) setBlockRaw(x, y, z, WATER);
        } else if (y === 0) {
          setBlockRaw(x, y, z, 3);                 // bedrock floor
        } else if (y === h) {
          setBlockRaw(x, y, z, top);
        } else if (y >= h - 3) {
          setBlockRaw(x, y, z, sub);
        } else if (desert && y >= h - 7) {
          setBlockRaw(x, y, z, 5);                 // sandstone strata beneath desert
        } else {
          setBlockRaw(x, y, z, 3);                 // stone
        }
      }
    }
  }
  // trees — dense in forest, sparse oases in desert
  for (let x = 2; x < SX - 2; x++) {
    for (let z = 2; z < SZ - 2; z++) {
      const h = heightAt(x, z);
      if (h <= SEA_LEVEL + 1) continue;
      const surf = getBlock(x, h, z);
      if (surf !== 1 && surf !== 4) continue;
      const b = biomeAt(x, z);
      const dens = b === 'forest' ? 0.09 : b === 'desert' ? 0.006 : 0.025;
      if (hash2(x * 7 + 3, z * 13 + 5) > dens) continue;
      const trunk = 4 + Math.floor(hash2(x * 11, z * 17) * 3);
      const topY = h + trunk;
      for (let y = h + 1; y <= topY; y++) setBlockRaw(x, y, z, 9);
      for (let dx = -2; dx <= 2; dx++) {
        for (let dz = -2; dz <= 2; dz++) {
          const d = Math.abs(dx) + Math.abs(dz);
          if (d === 0) continue;
          if (d <= 2) setBlockRaw(x + dx, topY, z + dz, 10);
          if (d <= 1) setBlockRaw(x + dx, topY + 1, z + dz, 10);
        }
      }
      setBlockRaw(x, topY + 1, z, 10);
    }
  }
}

function applyEdits() {
  for (const k in edits) {
    const i = +k;
    const y = Math.floor(i / (SX * SZ));
    const r = i - y * SX * SZ;
    const z = Math.floor(r / SX);
    const x = r - z * SX;
    world[idx(x, y, z)] = edits[k];
  }
}

/* ============================================================
   THREE.JS SETUP
   ============================================================ */
const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);

const scene = new THREE.Scene();
const SKY_DAY = new THREE.Color(0x87b7e8);
const SKY_NIGHT = new THREE.Color(0x0a1020);
scene.background = SKY_DAY.clone();
scene.fog = new THREE.Fog(SKY_DAY.clone(), 55, 140);

const camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.1, 400);
camera.rotation.order = 'YXZ';

const hemi = new THREE.HemisphereLight(0xbfd4f2, 0x5a4a32, 0.8);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff0d8, 1.1);
scene.add(sun);
scene.add(sun.target);
const ambient = new THREE.AmbientLight(0xffffff, 0.25);
scene.add(ambient);

const solidMat = new THREE.MeshLambertMaterial({ vertexColors: true });
const waterMat = new THREE.MeshLambertMaterial({
  vertexColors: true, transparent: true, opacity: 0.72, depthWrite: false,
});

// targeted-block highlight
const highlight = new THREE.LineSegments(
  new THREE.EdgesGeometry(new THREE.BoxGeometry(1.002, 1.002, 1.002)),
  new THREE.LineBasicMaterial({ color: 0x0c0c0e })
);
highlight.visible = false;
scene.add(highlight);

/* ============================================================
   TEXTURE ATLAS  (pixel-art, generated on a canvas — no external files)
   ============================================================ */
const TILE = 16, COLS = 8;
const TEX_TYPES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const TILES = {};  // type -> { top:{col,row}, side:{...}, bottom:{...} }
let ROWS = 1;

let _seed = 20260423;
function srnd() { _seed = (_seed * 1664525 + 1013904223) >>> 0; return _seed / 4294967296; }
function css(c, m) {
  const r = Math.max(0, Math.min(255, Math.round(c[0] * 255 * m)));
  const g = Math.max(0, Math.min(255, Math.round(c[1] * 255 * m)));
  const b = Math.max(0, Math.min(255, Math.round(c[2] * 255 * m)));
  return `rgb(${r},${g},${b})`;
}

function drawTile(ctx, ox, oy, type, kind) {
  const def = BLOCKS[type];
  const base = kind === 'top' ? def.top : kind === 'bottom' ? def.bottom : def.side;
  const px = (x, y, color) => { ctx.fillStyle = color; ctx.fillRect(ox + x, oy + y, 1, 1); };
  // speckled base
  for (let y = 0; y < TILE; y++)
    for (let x = 0; x < TILE; x++)
      px(x, y, css(base, 1 + (srnd() - 0.5) * 0.18));

  if (type === 1 && kind === 'side') {             // grass: green cap over dirt
    for (let x = 0; x < TILE; x++) {
      const h = 3 + ((srnd() * 2) | 0);
      for (let y = 0; y < h; y++) px(x, y, css(def.top, 1 + (srnd() - 0.5) * 0.22));
    }
  } else if (type === 3) {                          // stone flecks
    for (let i = 0; i < 7; i++) px((srnd() * TILE) | 0, (srnd() * TILE) | 0, css(base, 0.68));
  } else if (type === 5 && kind === 'side') {       // sandstone strata
    ctx.fillStyle = css(base, 0.82);
    for (let y = 4; y < TILE; y += 6) ctx.fillRect(ox, oy + y, TILE, 1);
  } else if (type === 9 && kind === 'side') {       // wood vertical grain
    ctx.fillStyle = css(base, 0.78);
    for (const x of [2, 3, 7, 8, 12, 13]) ctx.fillRect(ox + x, oy, 1, TILE);
    ctx.fillStyle = css(base, 1.15);
    for (const x of [5, 10]) ctx.fillRect(ox + x, oy, 1, TILE);
  } else if (type === 9) {                          // wood end-grain rings
    ctx.fillStyle = css(base, 0.78);
    ctx.fillRect(ox + 3, oy + 3, 10, 1); ctx.fillRect(ox + 3, oy + 12, 10, 1);
    ctx.fillRect(ox + 3, oy + 3, 1, 10); ctx.fillRect(ox + 12, oy + 3, 1, 10);
    ctx.fillRect(ox + 6, oy + 6, 5, 1); ctx.fillRect(ox + 6, oy + 9, 5, 1);
    ctx.fillRect(ox + 6, oy + 6, 1, 4); ctx.fillRect(ox + 10, oy + 6, 1, 4);
  } else if (type === 7) {                          // azulejo glazed motif
    ctx.fillStyle = css(def.top, 1.7);
    ctx.fillRect(ox + 7, oy + 2, 2, 12); ctx.fillRect(ox + 2, oy + 7, 12, 2);
    ctx.fillStyle = css(def.top, 1.3);
    ctx.fillRect(ox + 3, oy + 3, 2, 2); ctx.fillRect(ox + 11, oy + 3, 2, 2);
    ctx.fillRect(ox + 3, oy + 11, 2, 2); ctx.fillRect(ox + 11, oy + 11, 2, 2);
  } else if (type === 8) {                          // copper: hammered + patina
    for (let i = 0; i < 12; i++) px((srnd() * TILE) | 0, (srnd() * TILE) | 0, css(base, 1.28));
    for (let i = 0; i < 4; i++) px((srnd() * TILE) | 0, (srnd() * TILE) | 0, 'rgb(58,138,108)');
  } else if (type === 10) {                         // leaves clumps
    for (let i = 0; i < 16; i++) px((srnd() * TILE) | 0, (srnd() * TILE) | 0, css(base, 0.68));
    for (let i = 0; i < 9; i++) px((srnd() * TILE) | 0, (srnd() * TILE) | 0, css(base, 1.25));
  } else if (type === 11) {                         // water ripples
    ctx.fillStyle = css(base, 1.22);
    for (let y = 2; y < TILE; y += 5) ctx.fillRect(ox, oy + y, TILE, 1);
  }
}

function buildAtlas() {
  const cells = [];
  for (const t of TEX_TYPES) for (const k of ['top', 'side', 'bottom']) cells.push([t, k]);
  ROWS = Math.ceil(cells.length / COLS);
  const cv = document.createElement('canvas');
  cv.width = COLS * TILE; cv.height = ROWS * TILE;
  const ctx = cv.getContext('2d');
  cells.forEach(([t, k], i) => {
    const col = i % COLS, row = (i / COLS) | 0;
    (TILES[t] ||= {})[k] = { col, row };
    drawTile(ctx, col * TILE, row * TILE, t, k);
  });
  const tex = new THREE.CanvasTexture(cv);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

const atlasTex = buildAtlas();
solidMat.map = atlasTex;
waterMat.map = atlasTex;

// UV corner patterns (match FACES corner order below). flipY is on by default.
const SIDE_UV = [[0, 1], [0, 0], [1, 1], [1, 0]];  // ±x / ±z : v runs with world-y (upright)
const CAP_UV  = [[0, 1], [1, 1], [0, 0], [1, 0]];  // ±y
function tileUV(col, row, uu, vv) {
  const fu = uu > 0.5 ? 0.998 : 0.002;   // half-texel inset to avoid bleeding
  const fv = vv > 0.5 ? 0.998 : 0.002;
  return [(col + fu) / COLS, 1 - (row + (1 - fv)) / ROWS];
}
const faceShade = (f) => f === 3 ? 1.0 : f === 2 ? 0.55 : (f === 0 || f === 1) ? 0.72 : 0.86;

/* ============================================================
   CHUNK MESHING
   ============================================================ */
const FACES = [
  { dir: [-1, 0, 0], corners: [[0,1,0],[0,0,0],[0,1,1],[0,0,1]] }, // -x
  { dir: [ 1, 0, 0], corners: [[1,1,1],[1,0,1],[1,1,0],[1,0,0]] }, // +x
  { dir: [ 0,-1, 0], corners: [[1,0,1],[0,0,1],[1,0,0],[0,0,0]] }, // -y (bottom)
  { dir: [ 0, 1, 0], corners: [[0,1,1],[1,1,1],[0,1,0],[1,1,0]] }, // +y (top)
  { dir: [ 0, 0,-1], corners: [[1,0,0],[0,0,0],[1,1,0],[0,1,0]] }, // -z
  { dir: [ 0, 0, 1], corners: [[0,0,1],[1,0,1],[0,1,1],[1,1,1]] }, // +z
];

const chunkMeshes = new Map(); // "cx,cz" -> {solid, water}

function buildChunk(cx, cz) {
  const S = { P: [], N: [], C: [], U: [], I: [] };  // solid
  const W = { P: [], N: [], C: [], U: [], I: [] };  // water

  for (let y = 0; y < SY; y++) {
    for (let lz = 0; lz < CH; lz++) {
      for (let lx = 0; lx < CH; lx++) {
        const x = cx * CH + lx, z = cz * CH + lz;
        const b = getBlock(x, y, z);
        if (!b) continue;
        const isWater = b === WATER;
        for (let f = 0; f < 6; f++) {
          const face = FACES[f];
          const nb = getBlock(x + face.dir[0], y + face.dir[1], z + face.dir[2]);
          const draw = isWater ? (nb === 0) : (nb === 0 || nb === WATER);
          if (!draw) continue;
          const s = faceShade(f);
          const kind = f === 3 ? 'top' : f === 2 ? 'bottom' : 'side';
          const tile = TILES[b][kind];
          const uvp = (f === 2 || f === 3) ? CAP_UV : SIDE_UV;
          const a = isWater ? W : S;
          const baseI = a.P.length / 3;
          for (let ci = 0; ci < 4; ci++) {
            const c = face.corners[ci];
            a.P.push(x + c[0], y + c[1], z + c[2]);
            a.N.push(face.dir[0], face.dir[1], face.dir[2]);
            a.C.push(s, s, s);
            const uv = tileUV(tile.col, tile.row, uvp[ci][0], uvp[ci][1]);
            a.U.push(uv[0], uv[1]);
          }
          a.I.push(baseI, baseI + 1, baseI + 2, baseI + 2, baseI + 1, baseI + 3);
        }
      }
    }
  }

  const key = cx + ',' + cz;
  const old = chunkMeshes.get(key);
  if (old) {
    if (old.solid) { scene.remove(old.solid); old.solid.geometry.dispose(); }
    if (old.water) { scene.remove(old.water); old.water.geometry.dispose(); }
  }

  const make = (a, mat) => {
    if (!a.I.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(a.P, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(a.N, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(a.C, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(a.U, 2));
    g.setIndex(a.I);
    const m = new THREE.Mesh(g, mat);
    scene.add(m);
    return m;
  };

  chunkMeshes.set(key, { solid: make(S, solidMat), water: make(W, waterMat) });
}

function buildAllChunks() {
  for (let cx = 0; cx < SX / CH; cx++)
    for (let cz = 0; cz < SZ / CH; cz++) buildChunk(cx, cz);
}

function rebuildAround(x, z) {
  const done = new Set();
  const touch = (bx, bz) => {
    if (!inWorld(bx, 0, bz)) return;
    const cx = Math.floor(bx / CH), cz = Math.floor(bz / CH);
    const k = cx + ',' + cz;
    if (done.has(k)) return;
    done.add(k);
    buildChunk(cx, cz);
  };
  touch(x, z); touch(x - 1, z); touch(x + 1, z); touch(x, z - 1); touch(x, z + 1);
}

// hide chunks far from the player so the bigger world stays cheap to draw
function cullChunks() {
  const px = player.pos.x, pz = player.pos.z;
  chunkMeshes.forEach((m, key) => {
    const [cx, cz] = key.split(',').map(Number);
    const d = Math.hypot(px - (cx * CH + CH / 2), pz - (cz * CH + CH / 2));
    const vis = d < CULL_DIST;
    if (m.solid) m.solid.visible = vis;
    if (m.water) m.water.visible = vis;
  });
}

/* ============================================================
   PLAYER + PHYSICS
   ============================================================ */
const MAX_HP = 20, MAX_FOOD = 20;
const player = {
  pos: new THREE.Vector3(SX / 2, SY, SZ / 2), // feet position
  vel: new THREE.Vector3(),
  yaw: 0, pitch: 0,
  onGround: false,
  fly: false,
  health: MAX_HP, food: MAX_FOOD, dates: 0,
  dead: false, hurtCd: 0, fallPeak: undefined,
  dagger: false, sword: false, armor: false,  // crafted gear
};
const weaponDmg = () => player.sword ? 20 : player.dagger ? 12 : 7;
const PR = 0.3, PH = 1.8, EYE = 1.62;
const GRAVITY = 26, JUMP = 8.4;

function collisionSolidAt(x, y, z) {
  if (x < 0 || x >= SX || z < 0 || z >= SZ) return true; // world walls
  if (y < 0) return true;
  if (y >= SY) return false;
  const b = world[idx(x | 0, y | 0, z | 0)];
  return b !== 0 && b !== WATER;
}
// does an AABB (centre x/z, feet y, radius r, height h) overlap any solid voxel?
function boxCollides(pos, r, h) {
  const x0 = Math.floor(pos.x - r), x1 = Math.floor(pos.x + r);
  const y0 = Math.floor(pos.y), y1 = Math.floor(pos.y + h);
  const z0 = Math.floor(pos.z - r), z1 = Math.floor(pos.z + r);
  for (let x = x0; x <= x1; x++)
    for (let y = y0; y <= y1; y++)
      for (let z = z0; z <= z1; z++)
        if (collisionSolidAt(x, y, z)) return true;
  return false;
}
const playerCollides = () => boxCollides(player.pos, PR, PH);

// move an arbitrary entity one axis, reverting on collision; returns true if blocked
function moveEntityAxis(pos, axis, amount, r, h) {
  pos[axis] += amount;
  if (boxCollides(pos, r, h)) { pos[axis] -= amount; return true; }
  return false;
}
function entityOnGround(pos, r) {
  const y = pos.y;
  pos.y -= 0.08;
  const g = boxCollides(pos, r, 0.1);
  pos.y = y;
  return g;
}
function moveAxis(axis, amount) {
  player.pos[axis] += amount;
  if (playerCollides()) {
    player.pos[axis] -= amount;
    if (axis === 'y') {
      if (amount < 0) player.onGround = true;
      player.vel.y = 0;
    }
    return true;
  }
  return false;
}

function findSpawn() {
  // search outward from the centre for a dry column
  const cx = SX >> 1, cz = SZ >> 1;
  for (let r = 0; r < SX / 2; r++) {
    for (let dx = -r; dx <= r; dx++) {
      for (let dz = -r; dz <= r; dz++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const x = cx + dx, z = cz + dz;
        if (!inWorld(x, 0, z)) continue;
        for (let y = SY - 1; y > 0; y--) {
          const b = getBlock(x, y, z);
          if (b && b !== WATER) {
            if (y >= SEA_LEVEL) {
              player.pos.set(x + 0.5, y + 1, z + 0.5);
              return;
            }
            break;
          }
        }
      }
    }
  }
  player.pos.set(cx + 0.5, SY - 1, cz + 0.5);
}

/* ============================================================
   INPUT
   ============================================================ */
const keys = new Set();
let started = false, locked = false, playing = false, pointerLockOK = true;
let chatting = false; // co-op chat input is open
let selected = 0; // hotbar index
// drag-look fallback state (used when pointer lock is unavailable, e.g. in a sandboxed iframe)
let mouseDown = false, dragBtn = -1, dragged = false, lastMX = 0, lastMY = 0;

function look(mx, my) {
  const s = 0.0022;
  player.yaw -= mx * s;
  player.pitch -= my * s;
  player.pitch = Math.max(-1.55, Math.min(1.55, player.pitch));
}
function enableFallback() {
  if (locked) return;
  pointerLockOK = false;
  playing = true;
  pause.classList.add('hidden');
}

const inventory = {};
for (const t of HOTBAR_TYPES) inventory[t] = 0;
const resetStartingKit = () => {
  for (const t of HOTBAR_TYPES) inventory[t] = 0;
  inventory[5] = 40; inventory[6] = 40; inventory[7] = 30; inventory[8] = 30;
};

addEventListener('keydown', (e) => {
  if (chatting) return;                          // the chat input owns the keyboard while open
  if (e.code === 'KeyT' && net.online && started && !crafting && !building && !player.dead) { e.preventDefault(); openChat(); return; }
  keys.add(e.code);
  if (e.code === 'Escape' && crafting) { closeCraft(); return; }
  if (e.code === 'Escape' && building) { closeBuild(); return; }
  if (e.code === 'KeyC') toggleCraft();
  if (e.code === 'KeyB') toggleBuild();
  if (e.code === 'KeyF') player.fly = !player.fly;
  if (e.code === 'KeyE') eatDate();
  if (e.code === 'KeyM') toggleMute();
  if (e.code >= 'Digit0' && e.code <= 'Digit9') {
    const n = +e.code.slice(5);
    selected = n === 0 ? 9 : n - 1;
    updateHotbar();
  }
  // in fallback mode there is no pointer lock, so Esc toggles pause here
  if (e.code === 'Escape' && !pointerLockOK && started) {
    playing = !playing;
    pause.classList.toggle('hidden', playing);
  }
});
addEventListener('keyup', (e) => keys.delete(e.code));

addEventListener('wheel', (e) => {
  if (!playing || chatting) return;
  selected = (selected + (e.deltaY > 0 ? 1 : -1) + HOTBAR_TYPES.length) % HOTBAR_TYPES.length;
  updateHotbar();
}, { passive: true });

canvas.addEventListener('mousemove', (e) => {
  if (chatting) return;
  if (locked) { look(e.movementX, e.movementY); return; }
  if (IS_TOUCH) return;                            // touch devices use touch look, not mouse
  if (!playing || !mouseDown) return;              // fallback: look only while dragging
  const dx = e.clientX - lastMX, dy = e.clientY - lastMY;
  if (Math.abs(dx) + Math.abs(dy) > 2) dragged = true;
  look(dx, dy);
  lastMX = e.clientX; lastMY = e.clientY;
});

canvas.addEventListener('mousedown', (e) => {
  if (chatting) return;
  if (locked) {                                    // pointer-locked: click acts immediately
    if (e.button === 0) primaryAction();
    else if (e.button === 2) placeBlock();
    return;
  }
  if (!playing || IS_TOUCH) return;                // fallback: start a potential drag
  e.preventDefault();
  mouseDown = true; dragBtn = e.button; dragged = false;
  lastMX = e.clientX; lastMY = e.clientY;
});
addEventListener('mouseup', (e) => {               // fallback: a click without drag = break/place
  if (chatting) return;
  if (!mouseDown) return;
  mouseDown = false;
  if (locked || dragged) return;
  if (dragBtn === 0) primaryAction();
  else if (dragBtn === 2) placeBlock();
});
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

document.addEventListener('pointerlockchange', () => {
  locked = document.pointerLockElement === canvas;
  if (locked) { playing = true; pause.classList.add('hidden'); }
  else if (pointerLockOK && started && !player.dead && !crafting && !building && !chatting) { playing = false; pause.classList.remove('hidden'); }
});
document.addEventListener('pointerlockerror', enableFallback);

/* ============================================================
   VOXEL RAYCAST (DDA)
   ============================================================ */
function raycast(maxDist) {
  const o = camera.position;
  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir);
  let x = Math.floor(o.x), y = Math.floor(o.y), z = Math.floor(o.z);
  const stepX = Math.sign(dir.x) || 1, stepY = Math.sign(dir.y) || 1, stepZ = Math.sign(dir.z) || 1;
  const tDX = dir.x !== 0 ? Math.abs(1 / dir.x) : Infinity;
  const tDY = dir.y !== 0 ? Math.abs(1 / dir.y) : Infinity;
  const tDZ = dir.z !== 0 ? Math.abs(1 / dir.z) : Infinity;
  let tMX = dir.x !== 0 ? ((stepX > 0 ? x + 1 - o.x : o.x - x) / Math.abs(dir.x)) : Infinity;
  let tMY = dir.y !== 0 ? ((stepY > 0 ? y + 1 - o.y : o.y - y) / Math.abs(dir.y)) : Infinity;
  let tMZ = dir.z !== 0 ? ((stepZ > 0 ? z + 1 - o.z : o.z - z) / Math.abs(dir.z)) : Infinity;

  let prev = { x, y, z }, dist = 0;
  while (dist <= maxDist) {
    const b = getBlock(x, y, z);
    if (b && b !== WATER) return { hit: { x, y, z }, place: prev };
    prev = { x, y, z };
    if (tMX < tMY && tMX < tMZ) { x += stepX; dist = tMX; tMX += tDX; }
    else if (tMY < tMZ) { y += stepY; dist = tMY; tMY += tDY; }
    else { z += stepZ; dist = tMZ; tMZ += tDZ; }
  }
  return null;
}

function breakBlock() {
  const r = raycast(6);
  if (!r) return;
  const { x, y, z } = r.hit;
  if (y <= 0) return; // keep the floor
  const t = getBlock(x, y, z);
  setBlockRaw(x, y, z, 0);
  edits[idx(x, y, z)] = 0;
  netSendEdit(idx(x, y, z), 0);
  if (HOTBAR_TYPES.includes(t)) inventory[t]++;
  if (t === 10 && Math.random() < 0.3) player.dates++;   // palm fronds sometimes yield dates
  rebuildAround(x, z);
  updateHotbar();
}

function placeBlock() {
  const r = raycast(6);
  if (!r) return;
  const type = HOTBAR_TYPES[selected];
  if (inventory[type] <= 0) return;
  const { x, y, z } = r.place;
  if (!inWorld(x, y, z) || getBlock(x, y, z) !== 0) return;
  // don't place inside the player
  const p = player.pos;
  if (x + 1 > p.x - PR && x < p.x + PR &&
      z + 1 > p.z - PR && z < p.z + PR &&
      y + 1 > p.y && y < p.y + PH) return;
  setBlockRaw(x, y, z, type);
  edits[idx(x, y, z)] = type;
  netSendEdit(idx(x, y, z), type);
  inventory[type]--;
  rebuildAround(x, z);
  updateHotbar();
}

/* ============================================================
   DAY / NIGHT
   ============================================================ */
let timeOfDay = 0.28; // 0..1, start mid-morning
let sunHeight = 1, dayNum = 1;
const DAY_LEN = 240;  // seconds per full cycle
const skyTmp = new THREE.Color();

function updateDayNight(dt) {
  const prev = timeOfDay;
  timeOfDay = (timeOfDay + dt / DAY_LEN) % 1;
  if (timeOfDay < prev) dayNum++;
  const ang = timeOfDay * Math.PI * 2 - Math.PI / 2;
  const sx = Math.cos(ang), sy = Math.sin(ang);
  sunHeight = sy;
  sun.position.set(sx * 80, sy * 100, 30).add(player.pos);
  sun.target.position.copy(player.pos);
  sun.target.updateMatrixWorld();

  const day = Math.max(0, sy);           // 0 at horizon/night, 1 at noon
  sun.intensity = 0.15 + day * 1.05;
  hemi.intensity = 0.25 + day * 0.75;
  ambient.intensity = 0.12 + day * 0.18;

  skyTmp.copy(SKY_NIGHT).lerp(SKY_DAY, Math.min(1, day * 1.4));
  // copper dawn/dusk tint near the horizon
  if (sy > -0.25 && sy < 0.35) {
    const g = 1 - Math.min(1, Math.abs(sy) / 0.3);
    skyTmp.lerp(new THREE.Color(0xd98a3d), g * 0.35);
  }
  scene.background.copy(skyTmp);
  scene.fog.color.copy(skyTmp);

  const names = [[0.23, 'Dawn'], [0.3, 'Morning'], [0.5, 'Midday'],
                 [0.7, 'Afternoon'], [0.78, 'Dusk'], [1.01, 'Night']];
  let label = 'Night';
  for (const [t, n] of names) if (timeOfDay < t) { label = n; break; }
  clockEl.textContent = `Day ${dayNum} · ${label}`;
}

/* ============================================================
   HUD
   ============================================================ */
const titleEl = document.getElementById('title');
const pause = document.getElementById('pause');
const crosshair = document.getElementById('crosshair');
const info = document.getElementById('info');
const hotbarEl = document.getElementById('hotbar');
const clockEl = document.getElementById('clock');
const coordsEl = document.getElementById('coords');
const savedEl = document.getElementById('saved');

function buildHotbarDOM() {
  hotbarEl.innerHTML = '';
  HOTBAR_TYPES.forEach((t, i) => {
    const def = BLOCKS[t];
    const c = def.top;
    const slot = document.createElement('div');
    slot.className = 'slot';
    slot.title = def.name;
    slot.innerHTML =
      `<div class="swatch" style="background:rgb(${c.map(v => Math.round(v * 255)).join(',')})"></div>` +
      `<span class="key">${(i + 1) % 10}</span>` +
      `<span class="count"></span>`;
    slot.addEventListener('click', () => { selected = i; updateHotbar(); });
    hotbarEl.appendChild(slot);
  });
}
function updateHotbar() {
  [...hotbarEl.children].forEach((slot, i) => {
    const t = HOTBAR_TYPES[i];
    slot.classList.toggle('sel', i === selected);
    slot.classList.toggle('empty', inventory[t] <= 0);
    slot.querySelector('.count').textContent = inventory[t] > 0 ? inventory[t] : '';
  });
}

/* ============================================================
   SURVIVAL + MOBS
   ============================================================ */
const statsEl = document.getElementById('stats');
const hpFill = document.getElementById('hpFill');
const foodFill = document.getElementById('foodFill');
const dateCount = document.getElementById('dateCount');
const hurtEl = document.getElementById('hurt');
const deathEl = document.getElementById('death');
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3();

const MOB_MAX = 9, MOB_HIT_CD = 0.8, MOB_R = 0.35, MOB_H = 1.5;
// three kinds of night-dweller, each with its own stats and colour
const MOB_TYPES = {
  shade:  { hp: 10, speed: 2.7, dmg: 2,   scale: 1.0,  aggro: 22, drop: 1, body: 0x241f1b },
  jackal: { hp: 6,  speed: 4.3, dmg: 1.5, scale: 0.8,  aggro: 26, drop: 1, body: 0x5a3b22 },
  brute:  { hp: 22, speed: 1.9, dmg: 4,   scale: 1.25, aggro: 20, drop: 2, body: 0x2a211c },
};
const mobs = [];
let mobSpawnTimer = 3;

const _mobBody = new THREE.BoxGeometry(0.7, 0.9, 0.42);
const _mobHead = new THREE.BoxGeometry(0.55, 0.5, 0.5);
const _mobEye = new THREE.BoxGeometry(0.1, 0.1, 0.06);
const _mobEyeMat = new THREE.MeshBasicMaterial({ color: 0xe8954a });
const _mobMats = {};
const mobMat = (t) => _mobMats[t] || (_mobMats[t] = new THREE.MeshLambertMaterial({ color: MOB_TYPES[t].body }));

function makeMobMesh(type) {
  const g = new THREE.Group();
  const mat = mobMat(type);
  const body = new THREE.Mesh(_mobBody, mat); body.position.y = 0.55;
  const head = new THREE.Mesh(_mobHead, mat); head.position.y = 1.2;
  const e1 = new THREE.Mesh(_mobEye, _mobEyeMat); e1.position.set(0.13, 1.24, 0.26);
  const e2 = new THREE.Mesh(_mobEye, _mobEyeMat); e2.position.set(-0.13, 1.24, 0.26);
  g.add(body, head, e1, e2);
  g.scale.setScalar(MOB_TYPES[type].scale);
  scene.add(g);
  return g;
}
function spawnMob(x, y, z, type) {
  const def = MOB_TYPES[type];
  mobs.push({
    mesh: makeMobMesh(type), pos: new THREE.Vector3(x, y, z), vel: new THREE.Vector3(),
    hp: def.hp, atkCd: 0.7, def, wander: new THREE.Vector3(), wanderT: 0,
  });
}
function removeMob(i) {
  scene.remove(mobs[i].mesh);
  mobs.splice(i, 1);
}
function trySpawnMob() {
  for (let t = 0; t < 14; t++) {
    const ang = Math.random() * Math.PI * 2;
    const d = 12 + Math.random() * 16;
    const x = Math.floor(player.pos.x + Math.cos(ang) * d);
    const z = Math.floor(player.pos.z + Math.sin(ang) * d);
    if (!inWorld(x, 0, z)) continue;
    let y = -1;
    for (let yy = SY - 1; yy > 0; yy--) { const b = getBlock(x, yy, z); if (b && b !== WATER) { y = yy; break; } }
    if (y < SEA_LEVEL) continue;                       // not in the sea
    if (getBlock(x, y + 1, z) !== 0 || getBlock(x, y + 2, z) !== 0) continue; // headroom
    const r = Math.random();
    const type = r < 0.6 ? 'shade' : r < 0.9 ? 'jackal' : 'brute';
    spawnMob(x + 0.5, y + 1, z + 0.5, type);
    return;
  }
}
function updateMobs(dt) {
  mobSpawnTimer -= dt;
  const night = sunHeight < 0.03;
  if (!net.online && night && mobs.length < MOB_MAX && mobSpawnTimer <= 0) { mobSpawnTimer = 2.0; trySpawnMob(); }  // mobs are solo-only in v1

  for (let i = mobs.length - 1; i >= 0; i--) {
    const m = mobs[i], def = m.def;
    const dx = player.pos.x - m.pos.x, dz = player.pos.z - m.pos.z;
    const dist = Math.hypot(dx, dz);

    // steering: chase when the player's near, otherwise drift/wander
    let wx = 0, wz = 0;
    if (dist < def.aggro && dist > 0.001) { wx = dx / dist; wz = dz / dist; m.wanderT = 0; }
    else {
      m.wanderT -= dt;
      if (m.wanderT <= 0) { const a = Math.random() * Math.PI * 2; m.wander.set(Math.cos(a), 0, Math.sin(a)); m.wanderT = 2 + Math.random() * 3; }
      wx = m.wander.x * 0.4; wz = m.wander.z * 0.4;
    }
    // separation so they don't stack on one another
    for (const o of mobs) {
      if (o === m) continue;
      const ox = m.pos.x - o.pos.x, oz = m.pos.z - o.pos.z, od = ox * ox + oz * oz;
      if (od < 1.6 && od > 0.0001) { const inv = 1 / Math.sqrt(od); wx += ox * inv * 0.5; wz += oz * inv * 0.5; }
    }
    const wl = Math.hypot(wx, wz);
    if (wl > 0.001) { m.vel.x = wx / wl * def.speed; m.vel.z = wz / wl * def.speed; }
    else { m.vel.x = 0; m.vel.z = 0; }

    m.vel.y -= GRAVITY * dt;
    if (m.vel.y < -40) m.vel.y = -40;
    const bx = moveEntityAxis(m.pos, 'x', m.vel.x * dt, MOB_R, MOB_H);
    const bz = moveEntityAxis(m.pos, 'z', m.vel.z * dt, MOB_R, MOB_H);
    if (moveEntityAxis(m.pos, 'y', m.vel.y * dt, MOB_R, MOB_H)) m.vel.y = 0;
    const grounded = entityOnGround(m.pos, MOB_R);
    if ((bx || bz) && grounded && m.vel.y <= 0.01) m.vel.y = 6.5; // hop over 1-block steps

    m.atkCd -= dt;
    if (dist < 1.7 && Math.abs(player.pos.y - m.pos.y) < 2 && m.atkCd <= 0) {
      hurtPlayer(def.dmg, m.pos);
      m.atkCd = MOB_HIT_CD;
    }
    if (sunHeight > 0.3) m.hp -= dt * 6;  // they burn away in daylight
    if (m.pos.y < -20) m.hp = 0;
    if (m.hp <= 0) { removeMob(i); continue; }

    m.mesh.position.copy(m.pos);
    m.mesh.rotation.y = Math.atan2(dx, dz);
  }
}

function attackMob() {
  const dir = _v1; camera.getWorldDirection(dir);
  const eye = camera.position;
  let best = -1, bestDot = 0.5;
  for (let i = 0; i < mobs.length; i++) {
    const m = mobs[i];
    _v2.set(m.pos.x - eye.x, (m.pos.y + 0.9) - eye.y, m.pos.z - eye.z);
    const d = _v2.length();
    if (d > 3.4 || d < 0.001) continue;
    _v2.multiplyScalar(1 / d);
    const dot = _v2.dot(dir);
    if (dot > bestDot) { bestDot = dot; best = i; }
  }
  if (best < 0) return false;
  const m = mobs[best];
  m.hp -= weaponDmg();
  const kx = m.pos.x - player.pos.x, kz = m.pos.z - player.pos.z;
  const l = Math.hypot(kx, kz) || 1;
  m.vel.x = kx / l * 6; m.vel.z = kz / l * 6; m.vel.y = 4;
  if (m.hp <= 0) { player.dates += m.def.drop; removeMob(best); }  // killing drops dates
  return true;
}
// left-click: strike a shade if one's in front, otherwise mine the block
function primaryAction() {
  if (net.online ? attackNetMob() : attackMob()) return;
  breakBlock();
}

function hurtPlayer(amount, srcPos) {
  if (player.dead || player.hurtCd > 0) return;
  player.hurtCd = 0.5;
  const net_amt = player.armor ? amount * 0.5 : amount;    // Copper Vest halves damage
  if (net.online) {                  // server owns health: report the hit, it echoes authoritative hp
    flashHurt();
    if (srcPos) knockbackFrom(srcPos);
    netSend({ t: 'dmg', amount: net_amt });
    return;
  }
  player.health -= net_amt;
  flashHurt();
  if (srcPos) knockbackFrom(srcPos);
  if (player.health <= 0) { player.health = 0; die(); }
}
function flashHurt() {
  hurtEl.style.opacity = '0.6';
  clearTimeout(flashHurt._t);
  flashHurt._t = setTimeout(() => { hurtEl.style.opacity = '0'; }, 110);
}
function die() {
  player.dead = true;
  playing = false;
  if (locked) document.exitPointerLock();
  deathEl.classList.remove('hidden');
}
function respawn() {
  if (net.online) {              // server picks the spawn + resets health, then echoes 'respawned'
    player.food = Math.max(player.food, 12);
    netSend({ t: 'respawn' });
    return;
  }
  for (let i = mobs.length - 1; i >= 0; i--) removeMob(i);
  player.health = MAX_HP;
  player.food = Math.max(player.food, 12);
  player.dead = false;
  player.vel.set(0, 0, 0);
  player.fallPeak = undefined;
  findSpawn();
  deathEl.classList.add('hidden');
  if (pointerLockOK) requestLock(); else playing = true;
}
document.getElementById('respawnBtn').addEventListener('click', respawn);

function survivalTick(dt) {
  if (player.hurtCd > 0) player.hurtCd = Math.max(0, player.hurtCd - dt);
  const moving = keys.has('KeyW') || keys.has('KeyS') || keys.has('KeyA') || keys.has('KeyD');
  const sprint = keys.has('ShiftLeft') || keys.has('ShiftRight');
  player.food -= dt * (moving && sprint ? 0.10 : 0.045);
  if (player.food < 0) player.food = 0;

  if (net.online) {
    // food stays client-side; health is the server's — send regen/starvation as small deltas
    if (player.food >= 16 && player.health < MAX_HP) { net.hAccum += dt * 0.8; player.food = Math.max(0, player.food - dt * 0.25); }
    if (player.food <= 0 && player.health > 1) net.hAccum -= dt * 0.35;
    if (net.hAccum >= 1) { netSend({ t: 'heal', amount: net.hAccum }); net.hAccum = 0; }
    else if (net.hAccum <= -1) { netSend({ t: 'dmg', amount: -net.hAccum }); net.hAccum = 0; }
    return;
  }

  if (player.food >= 16 && player.health < MAX_HP) {       // well-fed: regenerate
    player.health = Math.min(MAX_HP, player.health + dt * 0.8);
    player.food = Math.max(0, player.food - dt * 0.25);
  }
  if (player.food <= 0 && player.health > 1) {             // starving: weaken (not fatal)
    player.health = Math.max(1, player.health - dt * 0.35);
  }
}
function eatDate() {
  if (player.dates > 0 && player.food < MAX_FOOD) {
    player.dates--;
    player.food = Math.min(MAX_FOOD, player.food + 6);
  }
}
function updateStatsHUD() {
  hpFill.style.width = (player.health / MAX_HP * 100) + '%';
  foodFill.style.width = (player.food / MAX_FOOD * 100) + '%';
  dateCount.textContent = player.dates;
  gearEl.textContent =
    (player.sword ? 'Sword' : player.dagger ? 'Dagger' : 'Fists') +
    (player.armor ? ' · Vest' : '');
}

/* ============================================================
   CRAFTING
   ============================================================ */
const gearEl = document.getElementById('gear');
const craftEl = document.getElementById('craft');
const craftListEl = document.getElementById('craftList');
let crafting = false;

// cost/give keys are block-type ids; `once` marks a one-time gear unlock
const RECIPES = [
  { name: 'Copper Dagger',  cost: { 9: 1, 8: 2 }, once: 'dagger', desc: 'Melee damage 7 → 12' },
  { name: 'Copper Sword',   cost: { 9: 2, 8: 4 }, once: 'sword',  desc: 'Melee damage → 20' },
  { name: 'Copper Vest',    cost: { 8: 6, 9: 1 }, once: 'armor',  desc: 'Halves damage taken' },
  { name: 'Sandstone ×8', cost: { 4: 4 }, give: { 5: 8 }, desc: 'Bake beach sand into blocks' },
  { name: 'Azulejo ×4',   cost: { 4: 2, 8: 2 }, give: { 7: 4 }, desc: 'Green glazed tile' },
  { name: 'Terracotta ×4', cost: { 2: 4 }, give: { 6: 4 }, desc: 'Fire earth into terracotta' },
];

const costText = (cost) =>
  Object.entries(cost).map(([k, v]) => `${v} ${BLOCKS[k].name}`).join(' · ');
const canAfford = (r) =>
  (!r.once || !player[r.once]) &&
  Object.entries(r.cost).every(([k, v]) => inventory[k] >= v);

function craft(r) {
  if (!canAfford(r)) return;
  for (const [k, v] of Object.entries(r.cost)) inventory[k] -= v;
  if (r.once) { player[r.once] = true; if (r.once === 'armor') netSendGear(); }
  if (r.give) for (const [k, v] of Object.entries(r.give)) inventory[k] += v;
  updateHotbar();
  updateStatsHUD();
  renderCraft();
}

function renderCraft() {
  craftListEl.innerHTML = '';
  for (const r of RECIPES) {
    const owned = r.once && player[r.once];
    const row = document.createElement('div');
    row.className = 'recipe' + (owned ? ' owned' : '');
    const info = document.createElement('div');
    info.className = 'rinfo';
    info.innerHTML =
      `<div class="rname">${r.name}</div>` +
      `<div class="rcost">${costText(r.cost)}</div>` +
      `<div class="rdesc">${r.desc}</div>`;
    const btn = document.createElement('button');
    btn.className = 'rbtn';
    if (owned) { btn.textContent = 'Owned'; btn.disabled = true; }
    else if (!canAfford(r)) { btn.textContent = 'Craft'; btn.disabled = true; }
    else { btn.textContent = 'Craft'; btn.addEventListener('click', () => craft(r)); }
    row.append(info, btn);
    craftListEl.appendChild(row);
  }
}

function openCraft() {
  crafting = true;
  playing = false;
  pause.classList.add('hidden');
  if (locked) document.exitPointerLock();
  renderCraft();
  craftEl.classList.remove('hidden');
}
function closeCraft() {
  crafting = false;
  craftEl.classList.add('hidden');
  if (pointerLockOK) requestLock(); else playing = true;
}
function toggleCraft() {
  if (crafting) closeCraft();
  else if (started && !player.dead && !building) openCraft();
}

/* ============================================================
   STRUCTURE PREFABS  (stamp Moorish buildings into the world)
   ============================================================ */
const buildEl = document.getElementById('build');
const buildListEl = document.getElementById('buildList');
let building = false, buildTarget = null, buildRot = 0;

// block shorthands for the builders
const SS = 5, TC = 6, AZ = 7, CU = 8, WD = 9, LF = 10, WT = 11, AIR = 0;

// write one block, recording it as a persisted edit
function sset(x, y, z, t) {
  if (!inWorld(x, y, z)) return;
  setBlockRaw(x, y, z, t);
  edits[idx(x, y, z)] = t;
  netSendEdit(idx(x, y, z), t);     // co-op: stamped buildings sync to everyone
}

const STRUCTURES = [
  {
    name: 'Horseshoe Arch', desc: 'The gateway of al-Andalus',
    build(put) {
      const prof = ['.XXX.', 'XXoXX', 'X...X', 'X...X', 'X...X', 'X...X'];
      for (let r = 0; r < prof.length; r++) {
        const ly = prof.length - 1 - r;
        for (let c = 0; c < 5; c++) {
          const lx = c - 2, ch = prof[r][c];
          put(lx, ly, 0, ch === 'X' ? (ly >= 4 ? AZ : SS) : AIR);
        }
      }
    },
  },
  {
    name: 'Courtyard Fountain', desc: 'Sandstone basin, running water',
    build(put) {
      for (let lx = -2; lx <= 2; lx++) for (let lz = -2; lz <= 2; lz++) {
        const edge = Math.abs(lx) === 2 || Math.abs(lz) === 2;
        put(lx, 0, lz, SS);
        put(lx, 1, lz, edge ? SS : WT);
      }
      put(0, 1, 0, SS); put(0, 2, 0, SS); put(0, 3, 0, AZ); put(0, 4, 0, CU);
      for (const [a, b] of [[2, 2], [-2, 2], [2, -2], [-2, -2]]) put(a, 1, b, AZ);
    },
  },
  {
    name: 'Minaret', desc: 'Tower with a copper dome',
    build(put) {
      const H = 12;
      for (let lx = -1; lx <= 1; lx++) for (let lz = -1; lz <= 1; lz++) put(lx, 0, lz, SS);
      for (let ly = 1; ly < H; ly++) for (let lx = -1; lx <= 1; lx++) for (let lz = -1; lz <= 1; lz++) {
        const edge = Math.abs(lx) === 1 || Math.abs(lz) === 1;
        put(lx, ly, lz, edge ? (ly === 4 || ly === 8 ? AZ : SS) : AIR);
      }
      for (let lx = -1; lx <= 1; lx++) for (let lz = -1; lz <= 1; lz++) put(lx, H, lz, CU);
      put(0, H + 1, 0, CU); put(1, H + 1, 0, CU); put(-1, H + 1, 0, CU);
      put(0, H + 1, 1, CU); put(0, H + 1, -1, CU); put(0, H + 2, 0, CU);
    },
  },
  {
    name: 'Domed Pavilion', desc: 'Open patio under a dome',
    build(put) {
      for (let lx = -2; lx <= 2; lx++) for (let lz = -2; lz <= 2; lz++) put(lx, 0, lz, AZ);
      for (const [cx, cz] of [[-2, -2], [-2, 2], [2, -2], [2, 2]])
        for (let ly = 1; ly <= 3; ly++) put(cx, ly, cz, SS);
      for (let lx = -2; lx <= 2; lx++) { put(lx, 3, -2, AZ); put(lx, 3, 2, AZ); }
      for (let lz = -2; lz <= 2; lz++) { put(-2, 3, lz, AZ); put(2, 3, lz, AZ); }
      for (let lx = -1; lx <= 1; lx++) for (let lz = -1; lz <= 1; lz++) put(lx, 4, lz, CU);
      put(0, 5, 0, CU); put(1, 5, 0, CU); put(-1, 5, 0, CU);
      put(0, 5, 1, CU); put(0, 5, -1, CU); put(0, 6, 0, CU);
    },
  },
  {
    name: 'Great Mosque', desc: 'Domed prayer hall with corner towers',
    build(put) {
      const R = 4;
      for (let lx = -R; lx <= R; lx++) for (let lz = -R; lz <= R; lz++) put(lx, 0, lz, AZ);
      for (let ly = 1; ly <= 3; ly++) for (let lx = -R; lx <= R; lx++) for (let lz = -R; lz <= R; lz++) {
        const edge = Math.abs(lx) === R || Math.abs(lz) === R;
        put(lx, ly, lz, edge ? (ly === 2 ? AZ : SS) : AIR);
      }
      for (let lz = -1; lz <= 1; lz++) { put(-R, 1, lz, AIR); put(-R, 2, lz, AIR); put(-R, 3, lz, AZ); }
      for (const [cx, cz] of [[-R, -R], [-R, R], [R, -R], [R, R]])
        for (let ly = 1; ly <= 5; ly++) put(cx, ly, cz, SS);
      for (let lx = -3; lx <= 3; lx++) for (let lz = -3; lz <= 3; lz++) put(lx, 4, lz, SS);
      for (let lx = -2; lx <= 2; lx++) for (let lz = -2; lz <= 2; lz++) put(lx, 5, lz, CU);
      for (let lx = -1; lx <= 1; lx++) for (let lz = -1; lz <= 1; lz++) put(lx, 6, lz, CU);
      put(0, 7, 0, CU); put(1, 7, 0, CU); put(-1, 7, 0, CU);
      put(0, 7, 1, CU); put(0, 7, -1, CU); put(0, 8, 0, CU);
    },
  },
  {
    name: 'Wall & Gate', desc: 'Crenellated rampart with a gate',
    build(put) {
      for (let lz = -4; lz <= 4; lz++) for (let ly = 0; ly <= 3; ly++) put(0, ly, lz, SS);
      for (let lz = -1; lz <= 1; lz++) { put(0, 1, lz, AIR); put(0, 2, lz, AIR); put(0, 3, lz, AZ); }
      for (let lz = -4; lz <= 4; lz++) if ((lz + 4) % 2 === 0) put(0, 4, lz, SS);
    },
  },
  {
    name: 'Well', desc: 'A small shaded well',
    build(put) {
      for (let lx = -1; lx <= 1; lx++) for (let lz = -1; lz <= 1; lz++)
        put(lx, 0, lz, (Math.abs(lx) === 1 || Math.abs(lz) === 1) ? SS : WT);
      put(-1, 1, 0, WD); put(-1, 2, 0, WD); put(1, 1, 0, WD); put(1, 2, 0, WD);
      put(-1, 3, 0, WD); put(0, 3, 0, WD); put(1, 3, 0, WD); put(0, 4, 0, TC);
    },
  },
];

// rotate local (lx,lz) by the player's facing, then write at the origin
function stampStructure(def, ox, oy, oz, rot) {
  const put = (lx, ly, lz, t) => {
    let wx, wz;
    if (rot === 0) { wx = lx; wz = lz; }
    else if (rot === 1) { wx = -lz; wz = lx; }
    else if (rot === 2) { wx = -lx; wz = -lz; }
    else { wx = lz; wz = -lx; }
    sset(ox + wx, oy + ly, oz + wz, t);
  };
  def.build(put);
  buildAllChunks();
}

function facingRot() {
  const fx = -Math.sin(player.yaw), fz = -Math.cos(player.yaw);
  if (Math.abs(fx) >= Math.abs(fz)) return fx >= 0 ? 0 : 2;
  return fz >= 0 ? 1 : 3;
}
function targetForStamp() {
  const r = raycast(9);
  if (r) return { x: r.hit.x, y: r.hit.y + 1, z: r.hit.z };
  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir);
  const x = Math.floor(player.pos.x + dir.x * 4), z = Math.floor(player.pos.z + dir.z * 4);
  let y = SEA_LEVEL + 1;
  for (let yy = SY - 1; yy > 0; yy--) { const b = getBlock(x, yy, z); if (b && b !== WATER) { y = yy + 1; break; } }
  return { x, y, z };
}

const STRUCT_COST = {
  'Horseshoe Arch': { 5: 8, 7: 4 },
  'Courtyard Fountain': { 5: 12, 7: 2, 8: 1 },
  'Minaret': { 5: 20, 7: 4, 8: 6 },
  'Domed Pavilion': { 5: 10, 7: 12, 8: 4 },
  'Great Mosque': { 5: 40, 7: 16, 8: 10 },
  'Wall & Gate': { 5: 16, 7: 2 },
  'Well': { 5: 6, 9: 4 },
};
const affordStruct = (c) => Object.entries(c).every(([k, v]) => inventory[k] >= v);
const payStruct = (c) => { for (const [k, v] of Object.entries(c)) inventory[k] -= v; };

function renderBuild() {
  buildListEl.innerHTML = '';
  STRUCTURES.forEach((def) => {
    const cost = STRUCT_COST[def.name] || {};
    const row = document.createElement('div');
    row.className = 'recipe';
    const info = document.createElement('div');
    info.className = 'rinfo';
    info.innerHTML = `<div class="rname">${def.name}</div>` +
      `<div class="rcost">${costText(cost)}</div>` +
      `<div class="rdesc">${def.desc}</div>`;
    const btn = document.createElement('button');
    btn.className = 'rbtn'; btn.textContent = 'Stamp';
    if (!affordStruct(cost)) btn.disabled = true;
    else btn.addEventListener('click', () => {
      payStruct(cost);
      stampStructure(def, buildTarget.x, buildTarget.y, buildTarget.z, buildRot);
      updateHotbar();
      closeBuild();
    });
    row.append(info, btn);
    buildListEl.appendChild(row);
  });
}
function openBuild() {
  building = true;
  playing = false;
  pause.classList.add('hidden');
  buildTarget = targetForStamp();
  buildRot = facingRot();
  if (locked) document.exitPointerLock();
  renderBuild();
  buildEl.classList.remove('hidden');
}
function closeBuild() {
  building = false;
  buildEl.classList.add('hidden');
  if (pointerLockOK) requestLock(); else playing = true;
}
function toggleBuild() {
  if (building) closeBuild();
  else if (started && !player.dead && !crafting) openBuild();
}

/* ============================================================
   AMBIENT AUDIO  (WebAudio synth — no files; Hijaz mode on D)
   ============================================================ */
let actx = null, masterGain = null, audioOn = true, ambientTimer = null;
const SCALE = [0, 1, 4, 5, 7, 8, 11, 12];   // Hijaz-ish intervals
const BASE = 146.83;                          // D3

function initAudio() {
  if (actx) { if (actx.state === 'suspended') actx.resume(); return; }
  try {
    actx = new (window.AudioContext || window.webkitAudioContext)();
    masterGain = actx.createGain();
    masterGain.gain.value = audioOn ? 0.22 : 0;
    masterGain.connect(actx.destination);
    // slow drone (root + fifth) under a lowpass, gently breathing
    const dg = actx.createGain(); dg.gain.value = 0.05; dg.connect(masterGain);
    const lp = actx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 620; lp.connect(dg);
    for (const f of [73.42, 110.0]) {
      const o = actx.createOscillator(); o.type = 'sine'; o.frequency.value = f; o.connect(lp); o.start();
    }
    const lfo = actx.createOscillator(); lfo.frequency.value = 0.08;
    const lg = actx.createGain(); lg.gain.value = 0.02; lfo.connect(lg); lg.connect(dg.gain); lfo.start();
    scheduleAmbient();
  } catch (e) { actx = null; }
}
function pluck(freq) {
  if (!actx) return;
  const t = actx.currentTime;
  const o = actx.createOscillator(); o.type = 'triangle'; o.frequency.value = freq;
  const g = actx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.5, t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 1.1);
  const lp = actx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2200;
  o.connect(lp); lp.connect(g); g.connect(masterGain);
  o.start(t); o.stop(t + 1.2);
}
const scaleFreq = () => BASE * Math.pow(2, SCALE[(Math.random() * SCALE.length) | 0] / 12);
function scheduleAmbient() {
  if (!actx) return;
  const night = sunHeight < 0.05;
  pluck(scaleFreq() * (night ? 0.5 : 1));                  // night = lower octave
  if (!night && Math.random() < 0.35) setTimeout(() => pluck(scaleFreq()), 200);
  ambientTimer = setTimeout(scheduleAmbient, (night ? 3200 : 1800) + Math.random() * 2200);
}
function toggleMute() {
  audioOn = !audioOn;
  if (masterGain) masterGain.gain.value = audioOn ? 0.22 : 0;
}

/* ============================================================
   TOUCH CONTROLS  (mobile fallback)
   ============================================================ */
const IS_TOUCH = (navigator.maxTouchPoints | 0) > 0 || 'ontouchstart' in window;
const touchMove = { x: 0, y: 0, active: false };
let lookTouchId = null, lookLast = { x: 0, y: 0 };

function initTouchControls() {
  if (!IS_TOUCH) return;
  document.body.classList.add('touch');
  const joy = document.getElementById('joy');
  const knob = document.getElementById('knob');
  const R = 46;
  let joyId = null;

  joy.addEventListener('touchstart', (e) => { e.preventDefault(); joyId = e.changedTouches[0].identifier; }, { passive: false });
  joy.addEventListener('touchmove', (e) => {
    e.preventDefault();
    for (const t of e.changedTouches) {
      if (t.identifier !== joyId) continue;
      const r = joy.getBoundingClientRect();
      let dx = t.clientX - (r.left + r.width / 2), dy = t.clientY - (r.top + r.height / 2);
      const d = Math.hypot(dx, dy) || 1;
      if (d > R) { dx = dx / d * R; dy = dy / d * R; }
      knob.style.transform = `translate(${dx}px,${dy}px)`;
      touchMove.x = dx / R; touchMove.y = dy / R; touchMove.active = true;
    }
  }, { passive: false });
  const endJoy = (e) => {
    for (const t of e.changedTouches) if (t.identifier === joyId) {
      joyId = null; touchMove.x = 0; touchMove.y = 0; touchMove.active = false;
      knob.style.transform = 'translate(0,0)';
    }
  };
  joy.addEventListener('touchend', endJoy); joy.addEventListener('touchcancel', endJoy);

  // right-hand side of the screen (bare canvas) = look
  canvas.addEventListener('touchstart', (e) => {
    if (!playing || lookTouchId !== null) return;
    const t = e.changedTouches[0]; lookTouchId = t.identifier; lookLast = { x: t.clientX, y: t.clientY };
  }, { passive: true });
  canvas.addEventListener('touchmove', (e) => {
    if (lookTouchId === null) return;
    for (const t of e.changedTouches) if (t.identifier === lookTouchId) {
      look((t.clientX - lookLast.x) * 1.1, (t.clientY - lookLast.y) * 1.1);
      lookLast = { x: t.clientX, y: t.clientY };
    }
  }, { passive: true });
  const endLook = (e) => { for (const t of e.changedTouches) if (t.identifier === lookTouchId) lookTouchId = null; };
  canvas.addEventListener('touchend', endLook); canvas.addEventListener('touchcancel', endLook);

  const press = (id, down, up) => {
    const el = document.getElementById(id); if (!el) return;
    el.addEventListener('touchstart', (e) => { e.preventDefault(); if (down) down(); }, { passive: false });
    if (up) el.addEventListener('touchend', (e) => { e.preventDefault(); up(); }, { passive: false });
  };
  press('bJump', () => keys.add('Space'), () => keys.delete('Space'));
  press('bMine', () => primaryAction());
  press('bPlace', () => placeBlock());
  press('bCraft', () => toggleCraft());
  press('bBuild', () => toggleBuild());
  press('bEat', () => eatDate());
  press('bFly', () => { player.fly = !player.fly; });
  press('bPause', () => { if (!crafting && !building) { playing = false; pause.classList.remove('hidden'); } });
  press('bChat', () => { if (net.online) openChat(); });
}

/* ============================================================
   WORLD REGISTRY  (multiple named / saved worlds)
   ============================================================ */
let activeWorld = null;   // the world record currently loaded

function loadWorlds() {
  try { return JSON.parse(localStorage.getItem(WORLDS_KEY)) || []; }
  catch (e) { return []; }
}
function storeWorlds(list) {
  try { localStorage.setItem(WORLDS_KEY, JSON.stringify(list)); } catch (e) {}
}
function worldSaveKey(id) { return 'andalus_world_' + id; }
function makeId() {
  return Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
}
function setActive(id) { try { localStorage.setItem(ACTIVE_KEY, id); } catch (e) {} }

function createWorld(name, seed) {
  const list = loadWorlds();
  const rec = {
    id: makeId(),
    name: (name || '').trim().slice(0, 28) || 'New World',
    seed: (seed >>> 0) || (Math.floor(Math.random() * 2147483647) + 1),
    created: Date.now(), played: Date.now(),
  };
  list.push(rec);
  storeWorlds(list);
  return rec;
}
function deleteWorld(id) {
  storeWorlds(loadWorlds().filter(w => w.id !== id));
  try { localStorage.removeItem(worldSaveKey(id)); } catch (e) {}
  try { if (localStorage.getItem(ACTIVE_KEY) === id) localStorage.removeItem(ACTIVE_KEY); } catch (e) {}
}
function touchPlayed(id) {
  const list = loadWorlds(), w = list.find(x => x.id === id);
  if (w) { w.played = Date.now(); storeWorlds(list); }
}

// Choose which world to load at page start; migrate the old single-slot save; seed a default.
function resolveActiveWorld() {
  const list = loadWorlds();
  if (list.length === 0) {
    const rec = createWorld('My Medina', SEED);      // SEED is still the legacy default here
    try {
      const legacy = localStorage.getItem(LEGACY_SAVE_KEY);
      if (legacy) {
        localStorage.setItem(worldSaveKey(rec.id), legacy);  // keep the player's existing world
        localStorage.removeItem(LEGACY_SAVE_KEY);
      }
    } catch (e) {}
    setActive(rec.id);
    return rec;
  }
  let id = null; try { id = localStorage.getItem(ACTIVE_KEY); } catch (e) {}
  let rec = list.find(w => w.id === id);
  if (!rec) { rec = list.slice().sort((a, b) => b.played - a.played)[0]; setActive(rec.id); }
  return rec;
}

/* ============================================================
   SAVE / LOAD
   ============================================================ */
function save(flash = true) {
  if (!activeWorld) return;
  try {
    localStorage.setItem(worldSaveKey(activeWorld.id), JSON.stringify({
      edits,
      pos: player.pos.toArray(),
      yaw: player.yaw, pitch: player.pitch,
      inv: inventory, time: timeOfDay, day: dayNum,
      health: player.health, food: player.food, dates: player.dates,
      dagger: player.dagger, sword: player.sword, armor: player.armor,
    }));
    touchPlayed(activeWorld.id);
    if (flash) {
      savedEl.textContent = 'Saved ✓';
      savedEl.style.opacity = '1';
      clearTimeout(save._t);
      save._t = setTimeout(() => { savedEl.style.opacity = '0'; }, 1200);
    }
  } catch (e) { /* storage may be unavailable */ }
}
function loadSave() {
  if (!activeWorld) return false;
  try {
    const raw = localStorage.getItem(worldSaveKey(activeWorld.id));
    if (!raw) return false;
    const s = JSON.parse(raw);
    Object.assign(edits, s.edits || {});
    applyEdits();
    if (s.pos) player.pos.fromArray(s.pos);
    if (typeof s.yaw === 'number') player.yaw = s.yaw;
    if (typeof s.pitch === 'number') player.pitch = s.pitch;
    if (typeof s.time === 'number') timeOfDay = s.time;
    if (typeof s.day === 'number') dayNum = s.day;
    if (typeof s.health === 'number') player.health = s.health;
    if (typeof s.food === 'number') player.food = s.food;
    if (typeof s.dates === 'number') player.dates = s.dates;
    player.dagger = !!s.dagger; player.sword = !!s.sword; player.armor = !!s.armor;
    if (s.inv) for (const t of HOTBAR_TYPES) inventory[t] = s.inv[t] ?? inventory[t];
    return true;
  } catch (e) { return false; }
}

/* ============================================================
   NETWORK  (v1 co-op — pairs with server.js)
   ============================================================ */
const net = { ws: null, online: false, id: null, room: '', name: '', players: new Map(), mobs: new Map(), moveT: 0, hAccum: 0 };

function defaultServerUrl() {
  if (location.protocol === 'file:') return '';           // opened as a local file — must type one
  return (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host;
}
function normalizeServer(u) {
  u = (u || '').trim();
  if (!u) return defaultServerUrl();
  if (!/^wss?:\/\//i.test(u)) u = (location.protocol === 'https:' ? 'wss://' : 'ws://') + u.replace(/^\/+/, '');
  return u.replace(/\/+$/, '');
}
function netMsg(t, err) {
  if (!netMsgEl) return;
  netMsgEl.textContent = t || '';
  netMsgEl.style.color = err ? '#e8604f' : 'var(--muted)';
}

function joinCoop() {
  const url = normalizeServer(coopServerEl.value);
  if (!url) { netMsg('Enter a server, e.g. wss://your-app.up.railway.app', true); return; }
  const room = (coopRoomEl.value || '').trim().slice(0, 24) || 'al-andalus';
  const name = (coopNameEl.value || '').trim().slice(0, 16) || 'Traveller';
  try { localStorage.setItem('andalus_coop_name', name); } catch (e) {}
  netMsg('Connecting…');
  initAudio();                                   // this click is the user gesture — start audio now
  let ws;
  try { ws = new WebSocket(url); } catch (e) { netMsg('That server address is not valid.', true); return; }
  net.ws = ws; net.room = room; net.name = name;
  ws.onopen = () => ws.send(JSON.stringify({ t: 'join', room, name }));
  ws.onmessage = (ev) => { let m; try { m = JSON.parse(ev.data); } catch (e) { return; } handleNet(m); };
  ws.onerror = () => { if (!net.online) netMsg('Could not reach that server.', true); };
  ws.onclose = () => {
    if (net.online) { net.online = false; alert('Disconnected from the co-op server.'); location.reload(); }
    else if (netMsgEl && !/reach|valid/.test(netMsgEl.textContent)) netMsg('Connection closed.', true);
  };
}

function handleNet(m) {
  switch (m.t) {
    case 'welcome':
      net.id = m.id; net.online = true;
      resetWorldForOnline(m.seed, m.edits || {});
      if (m.spawn) player.pos.set(m.spawn.x, m.spawn.y, m.spawn.z);
      if (typeof m.hp === 'number') player.health = m.hp;
      if (typeof m.time === 'number') timeOfDay = m.time;
      if (typeof m.day === 'number') dayNum = m.day;
      net.players.forEach((_, id) => removeAvatar(id));
      for (const p of (m.players || [])) addAvatar(p);
      applyMobSnapshot(m.mobs || []);
      netSendGear();                          // tell the server our starting gear (none)
      netMsg('');
      beginPlay();
      break;
    case 'join': addAvatar(m); break;
    case 'leave': removeAvatar(m.id); break;
    case 'move': { const a = net.players.get(m.id); if (a) { a.target.set(m.x, m.y, m.z); a.yaw = m.yaw; } break; }
    case 'edit': applyRemoteEdit(m.i, m.b); break;
    case 'time':
      if (typeof m.time === 'number') timeOfDay = m.time;
      if (typeof m.day === 'number') dayNum = m.day;
      break;
    case 'mobs': applyMobSnapshot(m.list || []); break;
    case 'mobgone': removeNetMob(m.id); break;
    case 'mobkill': removeNetMob(m.id); player.dates += (m.drop || 0); updateStatsHUD(); break;
    case 'health': {
      const drop = m.hp < player.health - 0.01;
      player.health = m.hp;
      if (drop) { flashHurt(); if (m.src) knockbackFrom(m.src); }
      updateStatsHUD();
      break;
    }
    case 'phealth': if (m.id !== net.id) setTeammateHealth(m.id, m.hp); break;
    case 'chat': addChatLine(m.name, m.text, m.id === net.id); break;
    case 'died': die(); break;
    case 'respawned':
      player.pos.set(m.x, m.y, m.z);
      player.health = (typeof m.hp === 'number') ? m.hp : MAX_HP;
      player.dead = false; player.vel.set(0, 0, 0); player.fallPeak = undefined;
      deathEl.classList.add('hidden');
      if (pointerLockOK) requestLock(); else playing = true;
      updateStatsHUD();
      break;
  }
}

function netSendEdit(i, b) {
  if (net.online && net.ws && net.ws.readyState === 1) net.ws.send(JSON.stringify({ t: 'edit', i, b }));
}
function netSendMove() {
  if (net.online && net.ws && net.ws.readyState === 1)
    net.ws.send(JSON.stringify({
      t: 'move',
      x: +player.pos.x.toFixed(2), y: +player.pos.y.toFixed(2), z: +player.pos.z.toFixed(2),
      yaw: +player.yaw.toFixed(3),
    }));
}
function netSend(obj) { if (net.online && net.ws && net.ws.readyState === 1) net.ws.send(JSON.stringify(obj)); }
function netSendGear() { netSend({ t: 'gear', armor: !!player.armor }); }

// --- server-driven mobs (online): render + interpolate from snapshots ---
function applyMobSnapshot(list) {
  const seen = new Set();
  for (const s of list) {
    seen.add(s.id);
    let e = net.mobs.get(s.id);
    if (!e) {
      e = { mesh: makeMobMesh(s.type), target: new THREE.Vector3(s.x, s.y, s.z), yaw: s.yaw };
      e.mesh.position.set(s.x, s.y, s.z);
      net.mobs.set(s.id, e);
    } else { e.target.set(s.x, s.y, s.z); e.yaw = s.yaw; }
  }
  // drop any the snapshot no longer lists
  net.mobs.forEach((_, id) => { if (!seen.has(id)) removeNetMob(id); });
}
function removeNetMob(id) {
  const e = net.mobs.get(id);
  if (e) { scene.remove(e.mesh); net.mobs.delete(id); }   // meshes use shared geometry/materials
}
function updateNetMobs(dt) {
  const k = Math.min(1, dt * 12);
  net.mobs.forEach(e => { e.mesh.position.lerp(e.target, k); e.mesh.rotation.y = e.yaw; });
}

// strike the server mob in the crosshair (online); the server resolves damage/kills
function attackNetMob() {
  const dir = _v1; camera.getWorldDirection(dir);
  const eye = camera.position;
  let bestId = -1, bestDot = 0.5;
  net.mobs.forEach((e, id) => {
    _v2.set(e.mesh.position.x - eye.x, (e.mesh.position.y + 0.9) - eye.y, e.mesh.position.z - eye.z);
    const d = _v2.length();
    if (d > 3.4 || d < 0.001) return;
    _v2.multiplyScalar(1 / d);
    const dot = _v2.dot(dir);
    if (dot > bestDot) { bestDot = dot; bestId = id; }
  });
  if (bestId < 0) return false;
  netSend({ t: 'mobdmg', mid: bestId, dmg: weaponDmg() });
  return true;
}

function knockbackFrom(src) {
  const dx = player.pos.x - src.x, dz = player.pos.z - src.z;
  const l = Math.hypot(dx, dz) || 1;
  moveAxis('x', dx / l * 0.45);
  moveAxis('z', dz / l * 0.45);
  if (!player.fly) player.vel.y = 5;
}

// ---- co-op chat ----
function addChatLine(name, text, mine) {
  if (!chatLogEl) return;
  const div = document.createElement('div');
  div.className = 'chatline';
  div.innerHTML = `<span class="cname"${mine ? ' style="color:var(--green-bright)"' : ''}>${escapeHtml(name)}:</span> ${escapeHtml(text)}`;
  chatLogEl.appendChild(div);
  while (chatLogEl.children.length > 12) chatLogEl.removeChild(chatLogEl.firstChild);
  chatLogEl.scrollTop = chatLogEl.scrollHeight;
  showChatLog();
}
function showChatLog() {
  if (!chatLogEl) return;
  chatLogEl.style.opacity = '1';
  clearTimeout(showChatLog._t);
  if (!chatting) showChatLog._t = setTimeout(() => { chatLogEl.style.opacity = '0'; }, 8000);
}
function openChat() {
  if (!net.online || !started || player.dead || chatting) return;
  chatting = true;
  keys.clear();                                  // drop any held movement keys
  if (locked) { try { document.exitPointerLock(); } catch (e) {} }   // free the cursor to type
  chatInputEl.value = '';
  chatInputEl.classList.remove('hidden');
  chatInputEl.focus();
  showChatLog();
}
function closeChat(sendIt) {
  if (!chatting) return;
  const text = chatInputEl.value.trim().slice(0, 120);
  chatInputEl.classList.add('hidden');
  chatInputEl.blur();
  chatting = false;
  if (sendIt && text) netSend({ t: 'chat', text });
  showChatLog();                                 // restart the fade countdown
  if (pointerLockOK && started && !player.dead) requestLock();   // back to playing
}

// --- remote player avatars (shared box geometry, interpolated) ---
const avatarBodyGeo = new THREE.BoxGeometry(0.6, 1.3, 0.6);
const avatarHeadGeo = new THREE.BoxGeometry(0.5, 0.5, 0.5);

// a billboarded name + health bar drawn on a canvas, floating above each teammate
function drawTeammateBar(a) {
  const ctx = a.labelCtx, c = a.labelCanvas;
  ctx.clearRect(0, 0, c.width, c.height);
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  ctx.font = 'bold 22px system-ui, sans-serif';
  ctx.fillStyle = 'rgba(0,0,0,.7)'; ctx.fillText(a.name, c.width / 2 + 1, 4);
  ctx.fillStyle = '#e8dcc0';        ctx.fillText(a.name, c.width / 2, 3);
  const bw = 150, bh = 14, bx = (c.width - bw) / 2, by = 32;
  ctx.fillStyle = 'rgba(10,10,12,.85)'; ctx.fillRect(bx - 2, by - 2, bw + 4, bh + 4);
  const frac = Math.max(0, Math.min(1, a.hp / MAX_HP));
  ctx.fillStyle = `rgb(${Math.round(201 - frac * 160)},${Math.round(57 + frac * 143)},70)`;  // red→green
  ctx.fillRect(bx, by, bw * frac, bh);
  a.labelTex.needsUpdate = true;
}
function addAvatar(p) {
  if (!p || p.id === net.id || net.players.has(p.id)) return;
  const g = new THREE.Group();
  const body = new THREE.Mesh(avatarBodyGeo, new THREE.MeshLambertMaterial({ color: 0xb5702f }));
  body.position.y = 0.65; g.add(body);
  const head = new THREE.Mesh(avatarHeadGeo, new THREE.MeshLambertMaterial({ color: 0xe8dcc0 }));
  head.position.y = 1.55; g.add(head);
  // floating label
  const canvas = document.createElement('canvas'); canvas.width = 180; canvas.height = 52;
  const tex = new THREE.CanvasTexture(canvas); tex.minFilter = THREE.LinearFilter;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: true }));
  sprite.scale.set(1.7, 0.49, 1); sprite.position.set(0, 2.4, 0);
  g.add(sprite);
  g.position.set(p.x, p.y, p.z);
  scene.add(g);
  const a = {
    mesh: g, target: new THREE.Vector3(p.x, p.y, p.z), yaw: p.yaw || 0,
    name: p.name || 'Traveller', hp: (typeof p.hp === 'number') ? p.hp : MAX_HP,
    labelCanvas: canvas, labelCtx: canvas.getContext('2d'), labelTex: tex, sprite,
  };
  net.players.set(p.id, a);
  drawTeammateBar(a);
}
function removeAvatar(id) {
  const a = net.players.get(id);
  if (!a) return;
  scene.remove(a.mesh);
  a.mesh.traverse(o => { if (o.material) o.material.dispose(); });  // box geometry is shared, not disposed
  if (a.labelTex) a.labelTex.dispose();
  net.players.delete(id);
}
function setTeammateHealth(id, hp) {
  const a = net.players.get(id);
  if (!a) return;
  a.hp = hp;
  drawTeammateBar(a);
}
function updateAvatars(dt) {
  const k = Math.min(1, dt * 10);
  net.players.forEach(a => { a.mesh.position.lerp(a.target, k); a.mesh.rotation.y = a.yaw; });
}

function applyRemoteEdit(i, b) {
  const y = Math.floor(i / (SX * SZ));
  const r = i - y * SX * SZ;
  const z = Math.floor(r / SX);
  const x = r - z * SX;
  if (!inWorld(x, y, z)) return;
  edits[i] = b;
  world[idx(x, y, z)] = b;
  rebuildAround(x, z);
}

// Regenerate the world for the server's seed, carve in its shared edits, drop solo mobs.
function resetWorldForOnline(seed, snapshot) {
  SEED = (seed >>> 0) || SEED;
  for (const k in edits) delete edits[k];
  for (let i = mobs.length - 1; i >= 0; i--) removeMob(i);     // clear any solo mobs
  net.mobs.forEach((_, id) => removeNetMob(id));
  generateTerrain();
  Object.assign(edits, snapshot);
  applyEdits();
  buildAllChunks();
  resetStartingKit();                       // inventory is client-local (not synced/persisted)
  player.dagger = player.sword = player.armor = false;
  player.health = MAX_HP; player.food = MAX_FOOD; player.dates = 0;
  player.dead = false; player.vel.set(0, 0, 0); player.fallPeak = undefined;
  net.hAccum = 0;
  findSpawn();
  updateHotbar();
}

/* ============================================================
   GAME LIFECYCLE
   ============================================================ */
// Switch the active world and reload so terrain regenerates cleanly for its seed.
function switchToWorld(id) {
  if (started) save(false);
  setActive(id);
  location.reload();
}
function newWorldFromInput() {
  const rec = createWorld(worldNameEl.value, undefined);
  switchToWorld(rec.id);
}
function removeWorld(id) {
  const w = loadWorlds().find(x => x.id === id);
  if (!confirm(`Delete "${w ? w.name : 'this world'}"? This erases its save permanently.`)) return;
  const wasActive = activeWorld && activeWorld.id === id;
  deleteWorld(id);
  if (wasActive) location.reload();   // resolveActiveWorld picks/creates another on reload
  else renderWorlds();
}

function initWorld() {
  activeWorld = resolveActiveWorld();
  SEED = activeWorld.seed;
  generateTerrain();
  const hadSave = loadSave();
  if (!hadSave) { resetStartingKit(); findSpawn(); }
  buildAllChunks();
  buildHotbarDOM();
  updateHotbar();
  renderWorlds();
}

function beginPlay() {
  started = true;
  titleEl.classList.add('hidden');
  crosshair.classList.remove('hidden');
  info.classList.remove('hidden');
  hotbarEl.classList.remove('hidden');
  statsEl.classList.remove('hidden');
  chatEl.classList.toggle('hidden', !net.online); // chat only in co-op
  updateStatsHUD();
  initAudio();                                     // audio must start from a user gesture
  if (IS_TOUCH) {
    pointerLockOK = false; playing = true;
    document.body.classList.add('playing');        // reveals on-screen controls
  } else {
    requestLock();
  }
}
function requestLock() {
  let p;
  try { p = canvas.requestPointerLock(); } catch (e) { enableFallback(); return; }
  if (p && typeof p.catch === 'function') p.catch(enableFallback);
  // backstop: if lock hasn't engaged shortly, assume it's blocked and use drag-look
  setTimeout(() => { if (!locked) enableFallback(); }, 400);
}

// ---- World-select menu (on the title card) ----
const worldListEl = document.getElementById('worldList');
const worldNameEl = document.getElementById('worldName');
// ---- Co-op panel ----
const coopNameEl = document.getElementById('coopName');
const coopRoomEl = document.getElementById('coopRoom');
const coopServerEl = document.getElementById('coopServer');
const netMsgEl = document.getElementById('netMsg');
// ---- Chat ----
const chatEl = document.getElementById('chat');
const chatLogEl = document.getElementById('chatLog');
const chatInputEl = document.getElementById('chatInput');

function fmtAgo(ts) {
  const s = (Date.now() - ts) / 1000;
  if (s < 90) return 'just now';
  if (s < 3600) return Math.round(s / 60) + 'm ago';
  if (s < 86400) return Math.round(s / 3600) + 'h ago';
  return Math.round(s / 86400) + 'd ago';
}
function renderWorlds() {
  if (!worldListEl) return;
  const list = loadWorlds().sort((a, b) => b.played - a.played);
  worldListEl.innerHTML = '';
  if (list.length === 0) {
    worldListEl.innerHTML = '<div class="wempty">No worlds yet — name one below and create it.</div>';
    return;
  }
  for (const w of list) {
    const isActive = activeWorld && w.id === activeWorld.id;
    const row = document.createElement('div');
    row.className = 'wrow' + (isActive ? ' active' : '');
    const meta = document.createElement('div');
    meta.className = 'wmeta';
    meta.innerHTML =
      `<div class="wname">${escapeHtml(w.name)}${isActive ? ' <span class="wtag">· loaded</span>' : ''}</div>` +
      `<div class="wsub">seed ${w.seed} · played ${fmtAgo(w.played)}</div>`;
    const play = document.createElement('button');
    play.className = 'wplay';
    play.textContent = isActive ? 'Enter' : 'Load';
    play.addEventListener('click', () => { if (isActive) beginPlay(); else switchToWorld(w.id); });
    const del = document.createElement('button');
    del.className = 'wdel'; del.title = 'Delete world'; del.textContent = '✕';
    del.addEventListener('click', () => removeWorld(w.id));
    row.append(meta, play, del);
    worldListEl.appendChild(row);
  }
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function quitToMenu() {
  if (net.online) { location.reload(); return; }   // co-op: server holds the world; reconnect from the title
  save(false);
  playing = false;
  try { document.exitPointerLock && document.exitPointerLock(); } catch (e) {}
  document.body.classList.remove('playing');
  pause.classList.add('hidden');
  crosshair.classList.add('hidden');
  info.classList.add('hidden');
  hotbarEl.classList.add('hidden');
  statsEl.classList.add('hidden');
  renderWorlds();
  titleEl.classList.remove('hidden');
}

document.getElementById('beginBtn').addEventListener('click', beginPlay);
document.getElementById('resumeBtn').addEventListener('click', () => {
  if (pointerLockOK) requestLock();
  else { playing = true; pause.classList.add('hidden'); }
});
document.getElementById('createWorldBtn').addEventListener('click', newWorldFromInput);
worldNameEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') newWorldFromInput(); });
document.getElementById('menuBtn').addEventListener('click', quitToMenu);
document.getElementById('coopJoin').addEventListener('click', joinCoop);
coopRoomEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') joinCoop(); });
try { coopNameEl.value = localStorage.getItem('andalus_coop_name') || ''; } catch (e) {}
chatInputEl.addEventListener('keydown', (e) => {
  e.stopPropagation();
  if (e.key === 'Enter') { e.preventDefault(); closeChat(true); }
  else if (e.key === 'Escape') { e.preventDefault(); closeChat(false); }
});

addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
addEventListener('beforeunload', () => { if (!net.online) save(false); });
setInterval(() => { if (started && !net.online) save(true); }, 20000);   // solo autosave; co-op persists server-side

/* ============================================================
   MAIN LOOP
   ============================================================ */
const fwd = new THREE.Vector3(), right = new THREE.Vector3(), wish = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
let last = performance.now();

function update(dt) {
  if (player.dead) return;
  // horizontal basis from yaw only
  fwd.set(-Math.sin(player.yaw), 0, -Math.cos(player.yaw));
  right.crossVectors(fwd, UP).normalize();

  wish.set(0, 0, 0);
  if (keys.has('KeyW')) wish.add(fwd);
  if (keys.has('KeyS')) wish.sub(fwd);
  if (keys.has('KeyD')) wish.add(right);
  if (keys.has('KeyA')) wish.sub(right);
  if (touchMove.active) {                 // on-screen joystick
    wish.addScaledVector(fwd, -touchMove.y);
    wish.addScaledVector(right, touchMove.x);
  }
  if (wish.lengthSq() > 0) wish.normalize();

  const sprint = keys.has('ShiftLeft') || keys.has('ShiftRight');

  if (player.fly) {
    const sp = sprint ? 14 : 8;
    player.vel.set(wish.x * sp, 0, wish.z * sp);
    if (keys.has('Space')) player.vel.y = sp;
    else if (sprint) player.vel.y = -sp;
    moveAxis('x', player.vel.x * dt);
    moveAxis('z', player.vel.z * dt);
    moveAxis('y', player.vel.y * dt);
  } else {
    const sp = sprint ? 7 : 4.5;
    player.vel.x = wish.x * sp;
    player.vel.z = wish.z * sp;
    player.vel.y -= GRAVITY * dt;
    if (player.vel.y < -40) player.vel.y = -40;
    player.onGround = false;
    moveAxis('x', player.vel.x * dt);
    moveAxis('z', player.vel.z * dt);
    moveAxis('y', player.vel.y * dt);
    if (player.onGround && keys.has('Space')) player.vel.y = JUMP;
    // fall damage: track the apex of a fall, hurt on landing
    if (!player.onGround) {
      player.fallPeak = player.fallPeak === undefined
        ? player.pos.y : Math.max(player.fallPeak, player.pos.y);
    } else if (player.fallPeak !== undefined) {
      const drop = player.fallPeak - player.pos.y;
      if (drop > 4.5) hurtPlayer((drop - 4.5) * 1.1, null);
      player.fallPeak = undefined;
    }
    if (player.pos.y < -20) { findSpawn(); player.vel.set(0, 0, 0); } // safety net
  }

  camera.position.set(player.pos.x, player.pos.y + EYE, player.pos.z);
  camera.rotation.y = player.yaw;
  camera.rotation.x = player.pitch;

  // targeted block highlight
  const r = raycast(6);
  if (r) {
    highlight.visible = true;
    highlight.position.set(r.hit.x + 0.5, r.hit.y + 0.5, r.hit.z + 0.5);
  } else highlight.visible = false;

  coordsEl.textContent =
    `${player.pos.x.toFixed(0)}, ${player.pos.y.toFixed(0)}, ${player.pos.z.toFixed(0)}` +
    (player.fly ? '  (fly)' : '');

  survivalTick(dt);
  updateMobs(dt);
  updateStatsHUD();

  if (net.online) {
    updateAvatars(dt);
    updateNetMobs(dt);
    net.moveT -= dt;
    if (net.moveT <= 0) { net.moveT = 1 / 12; netSendMove(); }   // ~12 Hz presence
  }
}

function loop() {
  requestAnimationFrame(loop);
  const now = performance.now();
  let dt = (now - last) / 1000;
  last = now;
  if (dt > 0.05) dt = 0.05;

  updateDayNight(dt);
  if (started && playing) update(dt);
  if (started) cullChunks();

  renderer.render(scene, camera);
}

initWorld();
initTouchControls();
loop();
