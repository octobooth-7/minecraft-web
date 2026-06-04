# Minecraft Web

A single-page voxel sandbox in the browser, built with [Three.js](https://threejs.org/). No build step — open `index.html` and play.

**Live demo:** https://octobooth-7.github.io/minecraft-web/

## Features

- Procedurally generated world with smooth biome transitions (plains ↔ ice spikes), seeded so worlds are reproducible (`?seed=123` or press `N` for a new one)
- Water, beaches, swimming, fall damage
- Day / night cycle with light propagation; hostile mobs only spawn in the dark; zombies and skeletons burn in sunlight
- 7 mob types (pig, cow, sheep, chicken, zombie, skeleton, creeper)
- Pre-generated castles, ice spikes, trees
- Survival + Creative mode, hearts, hotbar, drag-and-drop inventory, block drops
- **WebRTC multiplayer** via PeerJS — click *Host*, scan the QR code, others join instantly
- Scriptable AI API at `window.MinecraftAI` (move, look, break, place, observe…)

## Controls

| Key | Action |
| --- | --- |
| `WASD` | Move |
| `Space` | Jump / swim up |
| `Shift` | Sprint |
| `Left click` | Break |
| `Right click` | Place |
| `1-9` / wheel | Hotbar |
| `E` | Inventory |
| `F` | Fly (creative) |
| `G` | Toggle gamemode |
| `R` | Reload world |
| `N` | New random seed |

## Multiplayer

Click **Host**. A short room id is generated, a join URL is shown, and a QR code appears. Other players visit the URL (or scan the QR with their phone) and connect peer-to-peer. The world is procedurally seeded, so every client generates the same terrain — only block edits and player positions are sent over the network.

Signalling uses the free public PeerJS broker; gameplay is direct P2P over WebRTC.
