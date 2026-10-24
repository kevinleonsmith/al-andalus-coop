# Al-Andalus: Shadows of the Reconquista

A first-person **voxel survival-builder** set in 8th-century al-Andalus. Wander a blocky
Iberia, gather clay, stone and timber, fight off the night, and raise your own medina of
sandstone, terracotta, azulejo-green glaze and copper. Play solo in the browser, or host a
small **co-op server** and build together.

Built with **vanilla HTML/CSS/JS + Three.js** on the client; the optional co-op server is
**Node + `ws`**. No build step, no framework.

### ▶ [Play it live](https://al-andalus-coop-production.up.railway.app)

---

## Play

**Solo** needs nothing but the three client files — open `index.html` (served, or uploaded to
any static host) and pick or create a world. Each world keeps its own seed, terrain and save
(in `localStorage`).

**Co-op** needs the server running (it serves the client *and* the multiplayer relay). See
[`DEPLOY.md`](DEPLOY.md) for one-click Railway deployment. On the title screen, pick a name
and a shared world name under **Play together**; same world name = same world.

### Controls
| | |
|---|---|
| Move | `W A S D` |
| Look | Mouse (hold-drag if pointer lock is blocked) |
| Jump / Sprint | `Space` / `Shift` |
| Break / Place | Left-click / Right-click |
| Select block | `1`–`0` or scroll |
| Eat date / Fly | `E` / `F` |
| Craft / Build | `C` / `B` |
| Chat (co-op) | `T` |
| Pause / Mute | `Esc` / `M` |

Touch devices get an on-screen joystick and action buttons.

---

## Features

- Procedural **biomes** (desert / plains / forest), terrain, palm trees, water, day/night.
- Break/place with procedurally generated **pixel-art block textures** (no image files).
- **Crafting** (weapons, Copper Vest, block recipes) and **structure prefabs** with build costs.
- **Survival:** health, food, fall damage, and three enemy types (shade / jackal / brute) with AI.
- **Multiple named worlds**, each with its own seed and save.
- Synthesized ambient Andalusian **audio**; mobile **touch controls**.

### Co-op multiplayer
- **Shared worlds** — the server owns each room's seed, block edits and day/night clock; only
  edits and positions travel the wire (terrain is regenerated from the seed on each client).
- **Server-authoritative mobs and health** — shared enemies at night, damage, death and respawn.
- **Teammate name + health bars** floating above other players, and in-world **chat**.
- **Durable worlds** via a Railway Volume (auto-detected, atomic saves).

---

## Quick start

### Local
```bash
npm install
npm start          # http://localhost:3000
```
Open two tabs, join the same world name under **Play together**, and you'll see each other.

### Deploy (Railway)
Deploy this repo on [Railway](https://railway.app) — it runs `npm start` and injects `PORT`,
no config needed. Add a **Volume** so worlds survive redeploys. Full steps in
[`DEPLOY.md`](DEPLOY.md).

The static client can alternatively live on any static host (e.g. Hostinger) pointed at the
server's `wss://` address; the server accepts WebSocket connections from any origin.

---

## Project layout
| File | What it is |
|---|---|
| `index.html`, `style.css`, `script.js` | The game client (Three.js voxel engine, all gameplay). |
| `server.js` | Co-op server: serves the client + authoritative WebSocket game relay. |
| `package.json` | `npm start` → `node server.js`; one dependency (`ws`). |
| [`DEPLOY.md`](DEPLOY.md) | Railway deployment, co-op scope, and the Volume setup. |
| [`DESIGN-SPEC.md`](DESIGN-SPEC.md) | Full design spec and build history. |

The `*.md` / `*.txt` concept docs at the repo root are the original design sources the spec
reconciles; they're kept for reference.

---

## Notes
- Client-side state (solo worlds, your co-op name) lives in `localStorage`.
- Co-op is a friends-first **co-op** model — the server is authoritative for the world, mobs
  and health, but trusts clients for their own movement. There's no PvP or anti-cheat.
