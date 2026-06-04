// =============================================================================
// Minimal P2P multiplayer over WebRTC using PeerJS.
//
// Topology: star — the player who clicks "Host" creates a Peer with a random
// short id; everyone else opens `?join=<id>` and dials that peer directly.
// The host relays state messages between joiners. World is procedurally seeded
// (same seed → same terrain), so we only sync:
//   - the seed (sent by the host on connect)
//   - block changes (place / break / explosions)
//   - per-player position+rotation (≈12 Hz)
//
// The browser globals `Peer` (peerjs) and `QRCode` (qrcodejs) are loaded by
// <script> tags in index.html.
// =============================================================================

import * as THREE from 'three';

const SEND_HZ = 12;
const REMOTE_NAME_HEIGHT = 2.4;

function shortId() {
  // ~6-char alphanumeric room id. Only the last token after the project prefix
  // is shown to the user, so collisions are rare enough in practice.
  const chars = 'abcdefghijkmnopqrstuvwxyz23456789';
  let s = '';
  for (let i = 0; i < 6; i++) s += chars[(Math.random() * chars.length) | 0];
  return 'mc-' + s;
}

// Simple boxy avatar for remote players. Vaguely Steve-shaped, distinct color.
function buildAvatar(color) {
  const group = new THREE.Group();
  const reg = (mat) => mat;
  const skin = reg(new THREE.MeshBasicMaterial({ color }));
  const dark = reg(new THREE.MeshBasicMaterial({ color: 0x1a1a1a }));
  const shirt = reg(new THREE.MeshBasicMaterial({ color: 0x2e6db8 }));
  const pants = reg(new THREE.MeshBasicMaterial({ color: 0x222244 }));
  const cube = (w, h, d, mat, x, y, z) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    group.add(m);
    return m;
  };
  // Body parts (player capsule occupies y in [0..1.75], legs ~0.0..0.85)
  cube(0.55, 0.85, 0.30, pants, 0, 0.425, 0);   // legs
  cube(0.60, 0.55, 0.30, shirt, 0, 1.10, 0);    // torso
  cube(0.55, 0.55, 0.55, skin,  0, 1.65, 0);    // head
  // Eyes
  cube(0.10, 0.08, 0.02, dark,  0.12, 1.70, 0.28);
  cube(0.10, 0.08, 0.02, dark, -0.12, 1.70, 0.28);
  // Arms
  cube(0.18, 0.55, 0.18, shirt,  0.39, 1.10, 0);
  cube(0.18, 0.55, 0.18, shirt, -0.39, 1.10, 0);
  return group;
}

// 2D nameplate canvas → sprite
function buildNamePlate(text) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(0,0,0,0.55)';
  g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = '#fff';
  g.font = 'bold 28px monospace';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, c.width / 2, c.height / 2);
  const tex = new THREE.CanvasTexture(c);
  tex.minFilter = THREE.LinearFilter;
  const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(1.6, 0.4, 1);
  return sprite;
}

class RemotePlayer {
  constructor(scene, id, name, color) {
    this.id = id;
    this.name = name;
    this.scene = scene;
    this.avatar = buildAvatar(color);
    this.nameplate = buildNamePlate(name);
    this.nameplate.position.set(0, REMOTE_NAME_HEIGHT, 0);
    this.avatar.add(this.nameplate);
    scene.add(this.avatar);
    this.target = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 };
    this.current = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 };
    this.lastUpdate = performance.now();
  }
  setState(s) {
    this.target.x = s.x; this.target.y = s.y; this.target.z = s.z;
    this.target.yaw = s.yaw; this.target.pitch = s.pitch;
    this.lastUpdate = performance.now();
  }
  tick(dt) {
    // Lerp toward target for smoothness.
    const k = Math.min(1, dt * 12);
    this.current.x += (this.target.x - this.current.x) * k;
    this.current.y += (this.target.y - this.current.y) * k;
    this.current.z += (this.target.z - this.current.z) * k;
    this.current.yaw += (this.target.yaw - this.current.yaw) * k;
    this.avatar.position.set(this.current.x, this.current.y, this.current.z);
    this.avatar.rotation.y = this.current.yaw;
  }
  destroy() { this.scene.remove(this.avatar); }
}

// Pseudo-random color from peer id
function colorFor(id) {
  let h = 0; for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  const hue = ((h % 360) + 360) % 360;
  const c = new THREE.Color().setHSL(hue / 360, 0.6, 0.5);
  return c.getHex();
}

export class Multiplayer {
  constructor(game) {
    this.game = game;
    this.peer = null;
    this.isHost = false;
    this.hostConn = null;             // (joiner only) connection to host
    this.conns = new Map();           // (host) peerId → DataConnection
    this.remote = new Map();          // peerId → RemotePlayer
    this.blockDiffs = new Map();      // "x,y,z" → blockId (host history of changes)
    this.lastSendT = 0;
    this.status = 'offline';
    this.myId = null;
    this.myName = 'Player' + ((Math.random() * 1000) | 0);
    this._installHooks();
  }

  // Wrap world.setBlock so any local change broadcasts to peers (unless we're
  // already replaying a remote change).
  _installHooks() {
    const w = this.game.world;
    const orig = w.setBlock.bind(w);
    this._suppressBroadcast = false;
    w.setBlock = (x, y, z, id) => {
      orig(x, y, z, id);
      if (this._suppressBroadcast) return;
      if (this.status !== 'host' && this.status !== 'joined') return;
      this._broadcast({ t: 'block', x, y, z, id });
      if (this.isHost) this.blockDiffs.set(x + ',' + y + ',' + z, id);
    };
  }

  _applyRemoteBlock(x, y, z, id) {
    this._suppressBroadcast = true;
    try { this.game.world.setBlock(x, y, z, id); }
    finally { this._suppressBroadcast = false; }
    if (this.isHost) this.blockDiffs.set(x + ',' + y + ',' + z, id);
  }

  // Called every frame by Game.animate
  tick(dt) {
    for (const rp of this.remote.values()) rp.tick(dt);
    if (this.status !== 'host' && this.status !== 'joined') return;
    this.lastSendT += dt;
    if (this.lastSendT >= 1 / SEND_HZ) {
      this.lastSendT = 0;
      const p = this.game.player.position;
      const yaw = this.game.player.yaw;
      const pitch = this.game.player.pitch;
      const msg = { t: 'state', id: this.myId, x: p.x, y: p.y, z: p.z, yaw, pitch };
      this._broadcast(msg);
    }
  }

  // ---- transport helpers ----
  _broadcast(msg, exceptId) {
    if (this.isHost) {
      for (const [pid, conn] of this.conns) {
        if (pid === exceptId) continue;
        if (conn.open) conn.send(msg);
      }
    } else if (this.hostConn && this.hostConn.open) {
      this.hostConn.send(msg);
    }
  }

  _onMessage(fromId, msg) {
    if (!msg || !msg.t) return;
    if (msg.t === 'state') {
      // Don't render ourselves
      if (msg.id === this.myId) return;
      let rp = this.remote.get(msg.id);
      if (!rp) {
        rp = new RemotePlayer(this.game.scene, msg.id, msg.name || msg.id.slice(-4), colorFor(msg.id));
        this.remote.set(msg.id, rp);
      }
      rp.setState(msg);
      // If host, relay to all other joiners.
      if (this.isHost) this._broadcast(msg, fromId);
    } else if (msg.t === 'block') {
      this._applyRemoteBlock(msg.x, msg.y, msg.z, msg.id);
      if (this.isHost) this._broadcast(msg, fromId);
    } else if (msg.t === 'bye') {
      const rp = this.remote.get(msg.id);
      if (rp) { rp.destroy(); this.remote.delete(msg.id); }
      if (this.isHost) this._broadcast(msg, fromId);
    } else if (msg.t === 'welcome') {
      // joiner-only path
      if (msg.seed != null) this.game.setSeed(msg.seed);
      // Apply existing block diffs.
      if (msg.diffs) {
        for (const [k, id] of msg.diffs) {
          const [x, y, z] = k.split(',').map(Number);
          this._applyRemoteBlock(x, y, z, id);
        }
      }
      this._setStatus('joined');
    }
  }

  _setStatus(s) {
    this.status = s;
    document.dispatchEvent(new CustomEvent('mp-status', { detail: { status: s, mp: this } }));
  }

  // ---- public API ----
  async host() {
    if (this.peer) return this.myId;
    return new Promise((resolve, reject) => {
      const id = shortId();
      const peer = new Peer(id);
      this.peer = peer;
      this.isHost = true;
      this.myId = id;
      this._setStatus('connecting');
      peer.on('open', (openId) => {
        this.myId = openId;
        this._setStatus('host');
        resolve(openId);
      });
      peer.on('error', (err) => {
        console.error('peer error', err);
        this._setStatus('error');
        reject(err);
      });
      peer.on('connection', (conn) => {
        conn.on('open', () => {
          this.conns.set(conn.peer, conn);
          // Welcome packet: seed + accumulated block diffs.
          const diffs = Array.from(this.blockDiffs.entries());
          conn.send({ t: 'welcome', seed: this.game.getSeed ? this.game.getSeed() : window.WORLD_SEED, diffs });
          // Tell this new peer about all currently-known players (so they
          // render existing remotes immediately even before next state tick).
          for (const [otherId, rp] of this.remote) {
            const c = rp.current;
            conn.send({ t: 'state', id: otherId, x: c.x, y: c.y, z: c.z, yaw: c.yaw, pitch: c.pitch, name: rp.name });
          }
          // Also tell *us* about the new joiner (no-op for state but seeds map).
        });
        conn.on('data', (msg) => this._onMessage(conn.peer, msg));
        conn.on('close', () => {
          this.conns.delete(conn.peer);
          const rp = this.remote.get(conn.peer);
          if (rp) { rp.destroy(); this.remote.delete(conn.peer); }
          this._broadcast({ t: 'bye', id: conn.peer });
        });
      });
    });
  }

  async join(hostId) {
    if (this.peer) return;
    return new Promise((resolve, reject) => {
      const peer = new Peer();
      this.peer = peer;
      this.isHost = false;
      this._setStatus('connecting');
      peer.on('open', (id) => {
        this.myId = id;
        const conn = peer.connect(hostId, { reliable: true });
        this.hostConn = conn;
        conn.on('open', () => {
          // Wait for welcome via _onMessage.
          resolve(id);
        });
        conn.on('data', (msg) => this._onMessage(hostId, msg));
        conn.on('close', () => {
          this._setStatus('offline');
          for (const rp of this.remote.values()) rp.destroy();
          this.remote.clear();
        });
      });
      peer.on('error', (err) => {
        console.error('peer error', err);
        this._setStatus('error');
        reject(err);
      });
    });
  }

  getJoinUrl() {
    if (!this.myId) return null;
    const u = new URL(location.href);
    u.searchParams.delete('seed');
    u.searchParams.set('join', this.myId);
    u.hash = '';
    return u.toString();
  }

  peerCount() {
    if (this.isHost) return this.conns.size;
    return this.hostConn && this.hostConn.open ? 1 : 0;
  }
}
