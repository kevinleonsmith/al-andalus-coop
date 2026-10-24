# Deploying Al-Andalus co-op (v1) to Railway

The co-op server (`server.js`) serves the game client **and** the WebSocket relay on
one port. Deploy it once; everyone opens the Railway URL and plays together.

## What's in the repo
- `index.html`, `style.css`, `script.js` — the game client (unchanged for solo play).
- `server.js` — Node + `ws` server (static files + co-op relay).
- `package.json` — `npm start` → `node server.js`; depends on `ws`.
- Worlds persist to a `worlds/` folder as JSON (one file per room).

## Deploy on Railway
1. Push this folder to a GitHub repo (or use `railway up` from the Railway CLI).
2. On [railway.app](https://railway.app): **New Project → Deploy from GitHub repo** (pick this repo).
3. Railway auto-detects Node, runs `npm install`, then `npm start`. No build step, no config needed.
   - It injects `PORT` automatically; the server reads `process.env.PORT`.
4. Under **Settings → Networking**, click **Generate Domain**. You'll get something like
   `https://al-andalus-coop-production.up.railway.app`.

## Play
- **Simplest:** open that Railway URL in a browser. On the title screen, under
  **Play together (co-op)**, enter a name and a shared world name, leave **Server** blank,
  and click **Join Co-op**. Share the URL + world name with friends — same world name = same world.
- **Keeping the client on Hostinger too (optional):** upload `index.html` / `style.css` /
  `script.js` to Hostinger as before. In the co-op **Server** box, type your Railway address
  as `wss://al-andalus-coop-production.up.railway.app`. (Must be `wss://` — a plain `ws://`
  from an `https://` page is blocked by the browser.) The Railway server accepts WebSocket
  connections from any origin, so this cross-host setup works.

## Persistence (durable worlds via a Railway Volume)
Each room's block edits are written to `<save-dir>/<room>.json` every ~15s, when the last
player leaves, and on shutdown (SIGTERM/SIGINT, i.e. every redeploy). Writes are atomic
(temp file + rename), so a crash mid-save can't corrupt a world.

Railway's container filesystem is **ephemeral** — without a volume, a redeploy wipes saved
worlds. Attach a **Volume** once and the server uses it automatically:

1. In your Railway service: **Settings → Volumes → Add Volume**. Pick any mount path, e.g.
   `/data`. (Railway allows one volume per service.)
2. Redeploy. That's it — Railway injects `RAILWAY_VOLUME_MOUNT_PATH`, and the server saves to
   `$RAILWAY_VOLUME_MOUNT_PATH/worlds` automatically. You'll see it in the deploy log:
   `… · worlds → /data/worlds`.
3. (Optional) To force a specific directory instead, set `ANDALUS_SAVE_DIR=/data/worlds` —
   it takes precedence over the volume path.

Worlds now survive redeploys, restarts and crashes. Seeds are also deterministic from the
room name, so even if a save file were ever lost the terrain regenerates identically — only
player-made edits live in the volume.

## Scope of co-op (v2)
- **Server-authoritative:** world seed, block edits (break/place + stamped structures),
  the day/night clock, **enemies** (spawned at night, shared by everyone, drops go to the
  killer) and **player health** (mob hits, fall/starvation, well-fed regen, Copper Vest,
  death and respawn all resolved server-side).
- **Still client-local:** movement, food/hunger (its health effects are relayed to the
  server), and inventory (each player gets the starting kit on join; inventory isn't saved
  online). Other players appear as copper avatars with a floating **name + health bar**.
- **Chat:** press **T** in a co-op world (or the touch **Chat** button) to talk; Enter sends,
  Esc cancels. Messages are server-relayed to the whole room.
- **Testing hooks (env vars):** `ANDALUS_START_TIME=0.85` starts a world at night (mobs spawn
  at once); `ANDALUS_SAVE_DIR=/path` relocates saved worlds.

## Run locally
```
npm install
npm start           # serves on http://localhost:3000
```
Open `http://localhost:3000` in two tabs, join the same world name, and you'll see each other.
