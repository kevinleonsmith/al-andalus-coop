# Al-Andalus — Unified Design Spec

*Reconciles `MoorishRuleInEurope.md` (grand strategy), `andalus-rpg-concept.md` (character RPG), `game-maker-prompt.txt` (web app build), and `tech-stack-game.txt` (engine stack) into one direction.*

**Working title:** *Al-Andalus: Shadows of the Reconquista*
**Setting:** The Iberian Peninsula, 711–1492 CE
**Last updated:** 2026-10-23

---

## 1. The core decision: what kind of game is this?

> **Direction set 2026-10-23:** a **first-person voxel survival-builder** — Minecraft-style — set in 8th-century al-Andalus. The earlier grand-strategy/RPG framing is kept below only as lore and long-term flavour; it is **not** the game being built.

> **The game.** You wander a blocky 3D Iberia from a first-person view. You break blocks, gather resources (clay, stone, timber, sand), and build — raising your own medina of sandstone, terracotta, azulejo-green glaze, and copper. A day/night cycle runs overhead.

**Perspective:** first-person, real-time 3D (voxel world rendered with Three.js).

**What survives from the old design as flavour, not mechanics:** the setting (711–1492 Iberia), the al-Andalus multicultural tone, the architectural palette (sandstone / terracotta / azulejo / copper), and — someday — factions and historical events as a layer *on top of* the sandbox. The six RPG attributes, tech trees, turn-based strategy, and auto-resolved battles from the previous spec are shelved.

---

## 2. What we keep from each source doc

- **From `MoorishRuleInEurope.md`:** faction roster & leaders, city-building (medinas, mosques, cathedrals, castles, markets), tech tree (Golden Age science vs Reconquista military), diplomacy/religion (crusades & jihads), dynamic events (plague, famine, Inquisition), victory conditions, historical timeline.
- **From `andalus-rpg-concept.md`:** character origins, the six attributes, use-based skill trees, dialogue & relationship systems, language system (Arabic / Romance / Hebrew), moral choices without good-evil framing, lifestyle mechanics, the four narrative paths.
- **From `tech-stack-game.txt`:** the *eventual* engine target (Unity/Godot/Node), treated as Phase 3 — not Phase 1.
- **From `game-maker-prompt.txt`:** the vanilla HTML/CSS/JS web build and the **black / copper / green** palette — adopted as the Phase 1 prototype.
- **Dropped / deferred:** the spreadsheet-builder appendix in `game-maker-prompt.txt` is unrelated to this game and is out of scope.

---

## 3. Unified factions

Both docs agree closely. Final roster:

**Moorish (Muslim):** Umayyads of Córdoba · Almoravids · Almohads · Nasrids of Granada
**Christian (Reconquista):** Asturias · León & Castile · Crown of Aragon · Portugal
**Neutral / hybrid:** Jewish communities of al-Andalus (culture/trade/diplomacy) · Berber tribes (mercenaries / rebels)

Each faction gives a leader, a starting era, and bonuses that map onto the six attributes above.

---

## 4. Unified timeline (one era list)

The two docs used slightly different era splits; this is the single canonical set. A playthrough picks a start era; the campaign begins in 711.

1. **The Conquest** (711–756)
2. **Umayyad Golden Age / Caliphate of Córdoba** (756–1031)
3. **Taifa Period** (1031–1086)
4. **Almoravid & Almohad Rule** (1086–1212)
5. **Late Reconquista** (1212–1492) — ends at the Fall of Granada

**Scripted historical anchors** (player actions can bend them): Battle of Guadalete (711), Tours (732), fall of the Caliphate (1031), Las Navas de Tolosa (1212), the Black Death (1340s), Fall of Granada (1492).

---

## 5. Core gameplay loop (voxel sandbox)

1. **Explore** the blocky world in first person (WASD + mouse, jump, sprint, fly toggle).
2. **Gather** — break blocks to collect clay, stone, sand, timber, leaves into a hotbar inventory.
3. **Build** — place blocks to raise structures; the Moorish palette (sandstone, terracotta, azulejo, copper) is the build set.
4. **Survive the cycle** — day/night runs continuously; night is the hook for future threats (see §9).

## 6. Win / progression (sandbox-first)

No hard win condition — it's a creative/survival sandbox. Progression comes from what you build and from a future survival layer (hunger, enemies at night, better tools). Faction goals and historical objectives are a possible later overlay, not a launch requirement.

---

## 7. Phased tech plan

| Phase | Goal | Stack | Deliverable |
|---|---|---|---|
| **1 — Playable prototype** ✅ built | Prove the voxel core loop in the browser | **Vanilla HTML/CSS/JS + Three.js** (single CDN import), client-side only, Hostinger-deployable. Palette: black / copper / green. | Procedural Iberia terrain, first-person movement + physics, break/place, hotbar, palm trees, water, day/night, `localStorage` save — the three files now in this folder |
| **2 — Survival layer** ✅ complete | Make night matter | Same vanilla + Three.js | Health + hunger, fall damage, night "shades" (burn at dawn), melee combat, dates as food, death & respawn, crafting (C): weapons / Copper Vest / block recipes, and **procedural pixel-art block textures** (generated on a canvas, no external files). All persisted. |
| **3 — World & polish** ✅ complete | Bigger, prettier, themed | Three.js + WebAudio | Structure prefabs menu (B: arch, fountain, minaret, pavilion, mosque, wall-and-gate, well), a **larger 96×96 world** with distance culling, **synthesized ambient Andalusian audio** (Hijaz-mode drone + plucks, day/night-aware, M to mute), and a **mobile/touch fallback** (joystick + drag-look + action buttons). |

**Why this order:** Phase 1 is self-contained and deployable now; it proves the voxel loop before investing in survival systems or a bigger world. The Unity/Godot/Node engine stack from `tech-stack-game.txt` is **not** part of this direction — the browser build is the product.

---

## 8. Art & tone

- **Palette:** black, copper, green gradient (from the build prompt).
- **Motifs:** Islamic geometric patterns, medieval manuscript illumination.
- **Tone:** morally complex, no "good vs evil" religious framing; al-Andalus as a genuine multicultural melting pot.

---

## 9. Open questions (for Phase 2)

1. **Survival depth:** full hunger + health + death, or a lighter "hazards at night" model?
2. **Textures vs flat colours:** hand-made block textures (more Minecraft) or keep the clean low-poly vertex-coloured look?
3. **World size:** keep the fixed 64×64 island, or stream a larger/infinite world?
4. **Enemies:** blocky generic creatures, or themed (e.g. raiders) with the setting's tone?

---

## 10. Status & next step

**Phases 1 & 2 complete** — `index.html`, `style.css`, `script.js` in this folder. Open `index.html` (served, or straight to Hostinger) to play. Includes: procedural world, first-person movement, break/place, day/night, health/hunger, fall damage, night enemies, melee combat, dates as food, death & respawn, crafting, and pixel-art textures.

**All three phases complete.** The browser build is a playable voxel survival-builder: procedural 96×96 world, first-person movement, break/place with textures, day/night, survival (health/hunger/fall damage/night enemies/combat/death), crafting (C), structure prefabs (B), ambient audio (M to mute), and touch controls on mobile. `index.html` + `style.css` + `script.js`, no backend.

**Beyond Phase 3 — done:** biomes (desert / plains / forest, driving surface blocks + tree density), three enemy types (shade / fast jackal / tanky brute) with smarter AI (wander when idle, separation so they don't clump), a build-cost economy (prefabs cost sandstone/azulejo/copper/wood; the Stamp button disables when you can't afford it), and **multiple named/saved worlds** — a world-select menu on the title card (create with a name, each world gets its own random seed + terrain + save slot; load, delete, and "Save & quit to world menu" from pause). The old single-slot save is migrated into a world named "My Medina" on first run.

**Named-worlds storage:** registry under `andalus_worlds_v1` (`[{id,name,seed,created,played}]`), active id under `andalus_active_world`, per-world save under `andalus_world_<id>`. `SEED` is now set per active world at load; switching/creating a world reloads so terrain regenerates cleanly.

**Co-op multiplayer (v1) — built.** `server.js` (Node + `ws`) serves the client **and** a WebSocket relay on one port; deploy to Railway (`npm start`, reads `process.env.PORT`). A *room* = a shared world; the server owns each room's **seed + block edits + day/night clock** and relays **player positions** (copper box avatars, interpolated). Terrain is still generated client-side from the seed, so only edits + positions travel. Rooms persist to `worlds/<room>.json`; seeds are deterministic from the room name. Client gained a "Play together" title panel (name / world / optional `wss://` server), `net` module, remote-edit application, and solo saves/mobs are disabled while online. **v1 scope:** synced = seed, break/place + stamped structures, presence, clock. Solo-only/not-synced = enemies (off in co-op), health/combat/death, inventory (starting kit on join). Deployment becomes a **hybrid**: static client can still sit on Hostinger pointing at the Railway `wss://`, or just open the Railway URL directly. See `DEPLOY.md`. Verified with a two-client relay test (welcome/seed/edit/move/leave/persistence/validation all pass).

**Co-op multiplayer (v2) — built.** The server is now **authoritative for mobs and player health**. It reproduces just enough terrain (ported `hash2`/`valueNoise`/`heightAt`/`biomeAt` + an edit-aware `solidTop` column scan) to walk mobs along the ground — no full physics port; mobs snap to the surface and stay out of the sea. Server spawns the three mob types at night (its clock), chases the nearest living player with wander + separation, burns them off in daylight, and resolves attacks. Health is single-source on the server: mob hits apply there; the client reports fall/starvation as `dmg`, well-fed regen as `heal`, armor state as `gear` (server halves mob damage for vested players); death and respawn are server-driven (`died` → death screen, respawn button → server picks the spawn and resets HP). Client renders server mobs from ~10 Hz snapshots (`{t:'mobs'}`, interpolated, reusing the solo mob meshes), sends melee as `{t:'mobdmg'}` and gets the drop via `{t:'mobkill'}`. The solo mob sim and local health math still run when offline. Verified headless: mobs spawn at night, path across real terrain to a stationary player and damage them, a player can kill a mob and collect the drop, and death→respawn resets to full HP. (`ANDALUS_START_TIME` / `ANDALUS_SAVE_DIR` env hooks exist for testing.)

**Teammate health bars — built.** The server broadcasts every player's health to the room (`{t:'phealth', id, hp}`) on any change (mob hit, fall/starve, regen, respawn), and presence (`welcome`/`join`) now carries each player's HP. The client draws a billboarded **name + HP bar** (canvas-textured `THREE.Sprite`, red→green, depth-tested) floating above each teammate's avatar. Verified headless: presence carries HP and a teammate receives the damaged player's `phealth` with the correct value while the owner still gets the private `health`.

**Co-op chat — built.** Press **T** (or the touch **Chat** button) in a co-op world to open a chat line; Enter sends, Esc cancels. The server sanitizes (strips control chars, drops empty, clamps to 120 chars) and relays `{t:'chat', id, name, text}` to the whole room including the sender. Opening chat frees the cursor (exits pointer lock) and clears held movement; the input owns the keyboard while open (game keys/clicks are suppressed). The log (bottom-left) shows the last 12 lines, your own name in green, and fades out 8 s after the last message. HTML-escaped on render. Verified headless: sender sees own line, teammate receives it, control chars stripped, empty ignored, over-long clamped to 120.

**Durable worlds (Railway Volume) — built.** The save dir resolves to `ANDALUS_SAVE_DIR`, else `$RAILWAY_VOLUME_MOUNT_PATH/worlds` (Railway injects this when a Volume is attached — zero config beyond adding the volume), else `./worlds`. The dir is created at startup and logged; saves are now **atomic** (temp file + `rename`), and dirty rooms flush on the 15 s timer, on room-empty, and on **SIGTERM/SIGINT** (every Railway redeploy). Verified headless across a real process restart: an edit written under an auto-detected volume path persists to disk and returns in a fresh process's `welcome`. See `DEPLOY.md`.

**v3 (not built):** anti-cheat validation if PvP is ever added.

**Beyond Phase 3 — still open:** truly infinite/streamed terrain (an engine rewrite — on-demand chunk gen + unload).
