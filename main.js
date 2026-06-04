import * as THREE from 'three';
import { Multiplayer } from './multiplayer.js';

// ============================================================
// Constants
// ============================================================
const CHUNK_SIZE = 16;
const CHUNK_HEIGHT = 64;
const RENDER_DISTANCE = 8;     // chunks radius

// World seed is mutable: default from ?seed= URL param, otherwise random.
// Use MinecraftAI.setSeed(n) or press N (new random) / R (same seed reload).
let WORLD_SEED = (function () {
  try {
    const m = location.search.match(/[?&]seed=(-?\d+)/);
    if (m) return parseInt(m[1], 10) | 0;
    const h = location.hash.match(/seed=(-?\d+)/);
    if (h) return parseInt(h[1], 10) | 0;
  } catch (_) {}
  return (Math.random() * 0x7fffffff) | 0;
})();

const BLOCK = {
  AIR: 0,
  GRASS: 1,
  DIRT: 2,
  STONE: 3,
  SAND: 4,
  WOOD: 5,
  LEAVES: 6,
  SNOW: 7,
  ICE: 8,
  COBBLE: 9,
  BRICK: 10,
  PLANKS: 11,
  WATER: 12,
};

const BLOCK_NAMES = ['Air', 'Grass', 'Dirt', 'Stone', 'Sand', 'Wood', 'Leaves',
                     'Snow', 'Ice', 'Cobble', 'Brick', 'Planks', 'Water'];

// face order: +x, -x, +y, -y, +z, -z
// Each entry: [px, nx, py, ny, pz, nz] tile indices into the atlas
const BLOCK_TEXTURES = {
  [BLOCK.GRASS]:  [1, 1, 0, 2, 1, 1],
  [BLOCK.DIRT]:   [2, 2, 2, 2, 2, 2],
  [BLOCK.STONE]:  [3, 3, 3, 3, 3, 3],
  [BLOCK.SAND]:   [4, 4, 4, 4, 4, 4],
  [BLOCK.WOOD]:   [5, 5, 6, 6, 5, 5],
  [BLOCK.LEAVES]: [7, 7, 7, 7, 7, 7],
  [BLOCK.SNOW]:   [9, 9, 8, 2, 9, 9], // top=snow, sides=snowy-grass-ish, bottom=dirt
  [BLOCK.ICE]:    [10, 10, 10, 10, 10, 10],
  [BLOCK.COBBLE]: [11, 11, 11, 11, 11, 11],
  [BLOCK.BRICK]:  [12, 12, 12, 12, 12, 12],
  [BLOCK.PLANKS]: [13, 13, 13, 13, 13, 13],
  [BLOCK.WATER]:  [14, 14, 14, 14, 14, 14],
};

// Blocks that are non-solid for collision (player & mobs walk through them).
function isLiquid(b) { return b === BLOCK.WATER; }
// Opaque to neighbor culling (i.e. fully obscures faces behind it).
function isOpaqueBlock(b) { return b !== BLOCK.AIR && b !== BLOCK.WATER; }

const ATLAS_TILES = 4; // 4x4 grid
const TILE_PIXELS = 16;

// ============================================================
// Procedural texture atlas
// ============================================================
function makeTextureAtlas() {
  const size = ATLAS_TILES * TILE_PIXELS;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  // Helpers
  function tile(idx, drawFn) {
    const x = (idx % ATLAS_TILES) * TILE_PIXELS;
    const y = Math.floor(idx / ATLAS_TILES) * TILE_PIXELS;
    ctx.save();
    ctx.translate(x, y);
    ctx.beginPath();
    ctx.rect(0, 0, TILE_PIXELS, TILE_PIXELS);
    ctx.clip();
    drawFn(ctx);
    ctx.restore();
  }

  function noise(ctx, base, variance) {
    for (let py = 0; py < TILE_PIXELS; py++) {
      for (let px = 0; px < TILE_PIXELS; px++) {
        const r = base[0] + (Math.random() - 0.5) * variance;
        const g = base[1] + (Math.random() - 0.5) * variance;
        const b = base[2] + (Math.random() - 0.5) * variance;
        ctx.fillStyle = `rgb(${r|0},${g|0},${b|0})`;
        ctx.fillRect(px, py, 1, 1);
      }
    }
  }

  // 0: grass top
  tile(0, (ctx) => noise(ctx, [86, 152, 70], 30));
  // 1: grass side
  tile(1, (ctx) => {
    noise(ctx, [134, 96, 67], 25); // dirt base
    // green top strip with jagged edge
    for (let px = 0; px < TILE_PIXELS; px++) {
      const h = 3 + ((Math.random() * 2) | 0);
      for (let py = 0; py < h; py++) {
        const r = 86 + (Math.random() - 0.5) * 30;
        const g = 152 + (Math.random() - 0.5) * 30;
        const b = 70 + (Math.random() - 0.5) * 30;
        ctx.fillStyle = `rgb(${r|0},${g|0},${b|0})`;
        ctx.fillRect(px, py, 1, 1);
      }
    }
  });
  // 2: dirt
  tile(2, (ctx) => noise(ctx, [134, 96, 67], 30));
  // 3: stone
  tile(3, (ctx) => noise(ctx, [128, 128, 128], 30));
  // 4: sand
  tile(4, (ctx) => noise(ctx, [220, 210, 160], 20));
  // 5: wood side
  tile(5, (ctx) => {
    noise(ctx, [110, 80, 50], 18);
    ctx.strokeStyle = 'rgba(70,50,30,0.5)';
    for (let i = 0; i < 4; i++) {
      ctx.beginPath();
      ctx.moveTo(0, i * 4 + 1);
      ctx.lineTo(TILE_PIXELS, i * 4 + 1);
      ctx.stroke();
    }
  });
  // 6: wood top (rings)
  tile(6, (ctx) => {
    noise(ctx, [150, 110, 70], 15);
    ctx.strokeStyle = 'rgba(80,55,30,0.6)';
    for (let r = 2; r < 9; r += 2) {
      ctx.beginPath();
      ctx.arc(8, 8, r, 0, Math.PI * 2);
      ctx.stroke();
    }
  });
  // 7: leaves
  tile(7, (ctx) => {
    ctx.fillStyle = '#1f3a1a';
    ctx.fillRect(0, 0, TILE_PIXELS, TILE_PIXELS);
    for (let i = 0; i < 80; i++) {
      const r = 30 + Math.random() * 40;
      const g = 90 + Math.random() * 50;
      const b = 30 + Math.random() * 30;
      ctx.fillStyle = `rgba(${r|0},${g|0},${b|0},0.85)`;
      ctx.fillRect((Math.random() * TILE_PIXELS) | 0, (Math.random() * TILE_PIXELS) | 0, 1, 1);
    }
  });
  // 8: snow top
  tile(8, (ctx) => noise(ctx, [240, 245, 252], 12));
  // 9: snowy grass side (dirt with snow strip on top)
  tile(9, (ctx) => {
    noise(ctx, [134, 96, 67], 25);
    for (let px = 0; px < TILE_PIXELS; px++) {
      const h = 4 + ((Math.random() * 2) | 0);
      for (let py = 0; py < h; py++) {
        const r = 240 + (Math.random() - 0.5) * 12;
        const g = 245 + (Math.random() - 0.5) * 12;
        const b = 252 + (Math.random() - 0.5) * 12;
        ctx.fillStyle = `rgb(${r|0},${g|0},${b|0})`;
        ctx.fillRect(px, py, 1, 1);
      }
    }
  });
  // 10: ice (light blue with cracks)
  tile(10, (ctx) => {
    noise(ctx, [160, 210, 240], 18);
    ctx.strokeStyle = 'rgba(120,180,220,0.6)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      let x = Math.random() * TILE_PIXELS, y = Math.random() * TILE_PIXELS;
      ctx.moveTo(x, y);
      for (let s = 0; s < 4; s++) {
        x += (Math.random() - 0.5) * 8;
        y += (Math.random() - 0.5) * 8;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  });
  // 11: cobblestone
  tile(11, (ctx) => {
    noise(ctx, [110, 110, 110], 18);
    ctx.strokeStyle = 'rgba(60,60,60,0.85)';
    ctx.lineWidth = 1;
    // irregular stone joints
    const lines = [
      [0, 5, 16, 4], [0, 11, 16, 12],
      [4, 0, 5, 5], [10, 0, 11, 5],
      [3, 5, 4, 11], [9, 5, 8, 11], [13, 5, 14, 11],
      [5, 11, 4, 16], [11, 11, 12, 16],
    ];
    for (const [x1, y1, x2, y2] of lines) {
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    }
    // highlights
    ctx.fillStyle = 'rgba(200,200,200,0.18)';
    for (let i = 0; i < 6; i++) {
      ctx.fillRect((Math.random() * TILE_PIXELS) | 0, (Math.random() * TILE_PIXELS) | 0, 1, 1);
    }
  });
  // 12: stone bricks (dark, used for castle towers)
  tile(12, (ctx) => {
    noise(ctx, [78, 78, 92], 14);
    ctx.strokeStyle = 'rgba(30,30,40,0.95)';
    ctx.lineWidth = 1;
    // Horizontal mortar lines
    ctx.beginPath(); ctx.moveTo(0, 5); ctx.lineTo(16, 5); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, 11); ctx.lineTo(16, 11); ctx.stroke();
    // Vertical mortar lines, offset between courses (running bond)
    ctx.beginPath(); ctx.moveTo(5, 0);  ctx.lineTo(5, 5);   ctx.stroke();
    ctx.beginPath(); ctx.moveTo(11, 0); ctx.lineTo(11, 5);  ctx.stroke();
    ctx.beginPath(); ctx.moveTo(2, 5);  ctx.lineTo(2, 11);  ctx.stroke();
    ctx.beginPath(); ctx.moveTo(8, 5);  ctx.lineTo(8, 11);  ctx.stroke();
    ctx.beginPath(); ctx.moveTo(14, 5); ctx.lineTo(14, 11); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(5, 11); ctx.lineTo(5, 16);  ctx.stroke();
    ctx.beginPath(); ctx.moveTo(11,11); ctx.lineTo(11,16);  ctx.stroke();
  });
  // 13: oak planks
  tile(13, (ctx) => {
    noise(ctx, [170, 130, 80], 18);
    ctx.strokeStyle = 'rgba(90,60,30,0.9)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 4; i++) {
      const y = i * 4;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(16, y); ctx.stroke();
    }
    // staggered plank ends
    ctx.beginPath(); ctx.moveTo(7, 0); ctx.lineTo(7, 4); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(11, 4); ctx.lineTo(11, 8); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(4, 8); ctx.lineTo(4, 12); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(13, 12); ctx.lineTo(13, 16); ctx.stroke();
  });
  // 14: water (wavy blue)
  tile(14, (ctx) => {
    noise(ctx, [50, 110, 200], 18);
    ctx.strokeStyle = 'rgba(190,220,255,0.45)';
    ctx.lineWidth = 1;
    for (let row = 0; row < 4; row++) {
      const y = row * 4 + 1;
      ctx.beginPath();
      ctx.moveTo(0, y);
      for (let x = 0; x <= TILE_PIXELS; x += 2) {
        ctx.lineTo(x, y + ((x + row) % 4 < 2 ? 0 : 1));
      }
      ctx.stroke();
    }
  });

  const tex = new THREE.CanvasTexture(c);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = false;
  tex.userData.canvas = c;
  return tex;
}

// ============================================================
// Block icons (isometric thumbnail) for inventory UI
// ============================================================
function makeBlockIcon(atlasCanvas, blockType, size = 44) {
  const faces = BLOCK_TEXTURES[blockType];
  if (!faces) return null;
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  // Tile lookup helpers
  const tilePx = TILE_PIXELS;
  const tileXY = (idx) => [(idx % ATLAS_TILES) * tilePx, Math.floor(idx / ATLAS_TILES) * tilePx];

  // Iso projection geometry: cube fits within size x size
  const cx = size / 2;
  const w = size * 0.34;     // half-width
  const hTop = size * 0.22;  // half-depth (top diamond height)
  const hSide = size * 0.36; // side face vertical extent
  const cyTop = size * 0.18; // top of diamond
  const yMidL = cyTop + hTop;          // left/right corners of top
  const yMidC = cyTop + hTop * 2;      // bottom corner of top (and where sides meet)
  const yBot = yMidC + hSide;          // bottom of side faces

  // Quads
  // Top face (diamond): P0=left, P1=top, P2=bottom-of-diamond
  const top = { P0:[cx-w, yMidL], P1:[cx, cyTop], P2:[cx, yMidC] };
  // Left face (-Z front): P0=top-left, P1=top-right(=top.P2), P2=bottom-left
  const left = { P0:[cx-w, yMidL], P1:[cx, yMidC], P2:[cx-w, yMidL+hSide] };
  // Right face (+X side): P0=top-left(=top.P2), P1=top-right, P2=bottom-left(=left.P1+(0,hSide))
  const right = { P0:[cx, yMidC], P1:[cx+w, yMidL], P2:[cx, yMidC+hSide] };

  function drawTile(quad, faceIdx, brightness) {
    const [sx, sy] = tileXY(faces[faceIdx]);
    const [p0x, p0y] = quad.P0;
    const [p1x, p1y] = quad.P1;
    const [p2x, p2y] = quad.P2;
    // Linear map: (0,0)->P0, (T,0)->P1, (0,T)->P2 where T = tilePx
    const T = tilePx;
    const a = (p1x - p0x) / T, b = (p1y - p0y) / T;
    const cc = (p2x - p0x) / T, d = (p2y - p0y) / T;
    ctx.save();
    ctx.setTransform(a, b, cc, d, p0x, p0y);
    ctx.drawImage(atlasCanvas, sx, sy, T, T, 0, 0, T, T);
    ctx.restore();
    if (brightness < 1) {
      ctx.save();
      ctx.setTransform(a, b, cc, d, p0x, p0y);
      ctx.fillStyle = `rgba(0,0,0,${(1 - brightness).toFixed(3)})`;
      ctx.fillRect(0, 0, T, T);
      ctx.restore();
    }
  }

  // Draw order doesn't matter (no overlap in iso layout).
  drawTile(top, 2, 1.0);     // +Y
  drawTile(left, 5, 0.78);   // -Z, slightly darker
  drawTile(right, 0, 0.62);  // +X, darker

  return c;
}
function makeCrackTexture() {
  const size = 64;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, size, size);
  ctx.strokeStyle = 'rgba(0,0,0,0.9)';
  ctx.lineCap = 'round';
  ctx.lineWidth = 2;
  // jagged cracks
  for (let i = 0; i < 6; i++) {
    ctx.beginPath();
    let x = Math.random() * size, y = Math.random() * size;
    ctx.moveTo(x, y);
    const steps = 5 + ((Math.random() * 4) | 0);
    for (let s = 0; s < steps; s++) {
      x += (Math.random() - 0.5) * 22;
      y += (Math.random() - 0.5) * 22;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  // chips
  ctx.fillStyle = 'rgba(0,0,0,0.75)';
  for (let i = 0; i < 25; i++) {
    ctx.fillRect((Math.random() * size) | 0, (Math.random() * size) | 0, 2, 2);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  return tex;
}

// ============================================================
// Procedural fire texture: 4-frame animated flame strip (64x16)
// ============================================================
function makeFireTexture() {
  const FRAMES = 4;
  const SIZE = 16;
  const c = document.createElement('canvas');
  c.width = SIZE * FRAMES;
  c.height = SIZE;
  const ctx = c.getContext('2d');

  for (let f = 0; f < FRAMES; f++) {
    const ox = f * SIZE;
    // Flame shape: tall teardrop using nested ovals from yellow→orange→red
    // Use jittered pixel art per frame for animation
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const cx = SIZE / 2 - 0.5;
        // Flame narrows toward top; pixel y=0 is top
        const t = y / (SIZE - 1); // 0=top, 1=bottom
        const widthAtY = (1 - Math.pow(1 - t, 1.6)) * (SIZE * 0.5);
        const dx = x - cx;
        // Per-frame jitter: offset width + center wobble
        const jitter = (Math.sin((y + f * 3) * 1.3) * 0.7) +
                       (Math.random() - 0.5) * 1.4;
        const inside = Math.abs(dx + jitter * 0.4) < widthAtY + jitter * 0.3;
        if (!inside) continue;

        // Layered colors: outer red, mid orange, inner yellow, hot core white
        const inner = Math.abs(dx) < widthAtY * 0.45;
        const core = Math.abs(dx) < widthAtY * 0.18 && t > 0.35;
        let color;
        if (core) color = '#fff7c2';
        else if (inner) color = t < 0.25 ? '#ffe25a' : '#ffb02e';
        else color = t < 0.4 ? '#ff8a1a' : '#d63a18';
        // Top fade
        if (t < 0.18 && Math.random() < 0.45) continue;

        ctx.fillStyle = color;
        ctx.fillRect(ox + x, y, 1, 1);
      }
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.repeat.set(1 / FRAMES, 1);
  return tex;
}

// ============================================================
// Simple value-noise based terrain
// ============================================================
function hash2(x, y, seed) {
  let h = x * 374761393 + y * 668265263 + seed * 982451653;
  h = (h ^ (h >>> 13)) * 1274126177;
  h = h ^ (h >>> 16);
  return ((h >>> 0) % 100000) / 100000;
}
function smooth(t) { return t * t * (3 - 2 * t); }
function valueNoise2D(x, y, seed) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const v00 = hash2(xi, yi, seed);
  const v10 = hash2(xi + 1, yi, seed);
  const v01 = hash2(xi, yi + 1, seed);
  const v11 = hash2(xi + 1, yi + 1, seed);
  const u = smooth(xf), v = smooth(yf);
  return (v00 * (1 - u) + v10 * u) * (1 - v) + (v01 * (1 - u) + v11 * u) * v;
}
function fbm(x, y, seed) {
  let amp = 1, freq = 1, sum = 0, norm = 0;
  for (let i = 0; i < 4; i++) {
    sum += valueNoise2D(x * freq, y * freq, seed + i * 17) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

function terrainHeight(wx, wz) {
  const base = fbm(wx / 80, wz / 80, WORLD_SEED);
  const detail = fbm(wx / 25, wz / 25, WORLD_SEED + 1) * 0.3;
  const h = base * 0.7 + detail;
  return Math.floor(20 + h * 18); // ~20..38
}

// Biome temperature in [0..1]. Low = ice, high = plains.
function biomeTemp(wx, wz) {
  return fbm(wx / 220, wz / 220, WORLD_SEED + 7);
}

// Returns a "snow probability" 0..1 with a soft transition band around the
// ice/plains threshold. A per-cell hash pick decides the actual surface,
// producing patchy, natural borders rather than a hard line.
const ICE_THRESHOLD = 0.42;
const ICE_BAND = 0.07; // half-width of the transition band

function snowChance(temp) {
  // Below threshold-band: 1 (full ice). Above threshold+band: 0 (full plains).
  // Smoothstep through the transition.
  const t = (temp - (ICE_THRESHOLD - ICE_BAND)) / (ICE_BAND * 2);
  if (t <= 0) return 1;
  if (t >= 1) return 0;
  return 1 - smooth(t); // smooth = 3t² - 2t³
}

// Backward-compat: discrete biome name. Used for cross-chunk decisions where
// "is this generally an ice area" matters (e.g. ice-spike spawn loop).
function biomeAt(wx, wz) {
  return biomeTemp(wx, wz) < ICE_THRESHOLD ? 'ice' : 'plains';
}

// Per-cell surface decision with smooth blending.
// Returns 'ice' or 'plains' for surface block & decoration choices.
function surfaceBiome(wx, wz) {
  const temp = biomeTemp(wx, wz);
  const p = snowChance(temp);
  if (p >= 1) return 'ice';
  if (p <= 0) return 'plains';
  // Use a high-frequency hash (offset from terrain seeds) so the patch pattern
  // doesn't align with terrain features.
  const r = hash2(wx, wz, WORLD_SEED + 2027);
  return r < p ? 'ice' : 'plains';
}

// ============================================================
// Structure system
// Castles are placed at most one per CASTLE_REGION × CASTLE_REGION chunk
// region, at a deterministic offset. Each chunk asks "is there a castle
// near me?" and writes any of its blocks that fall inside this chunk.
// ============================================================
const CASTLE_REGION = 12;     // chunks per region (12*16 = 192 blocks)
const CASTLE_FOOTPRINT = 44;  // half-extent for footprint check
const CASTLE_W = 36;          // wall-to-wall span (must be even)

function castleOriginForRegion(rx, rz) {
  // ~40% chance of a castle in any region; deterministic placement.
  const r = hash2(rx, rz, WORLD_SEED + 4242);
  if (r < 0.4) return null;
  const offX = ((hash2(rx, rz, WORLD_SEED + 12345) * (CASTLE_REGION - 5)) | 0) + 3;
  const offZ = ((hash2(rx, rz, WORLD_SEED + 67890) * (CASTLE_REGION - 5)) | 0) + 3;
  const wx = (rx * CASTLE_REGION + offX) * CHUNK_SIZE;
  const wz = (rz * CASTLE_REGION + offZ) * CHUNK_SIZE;
  return { wx, wz };
}

// Write a block into chunk only if (wx, wy, wz) lies within this chunk.
function chunkWrite(chunk, wx, wy, wz, block, overwrite = true) {
  if (wy < 0 || wy >= CHUNK_HEIGHT) return;
  const cx = Math.floor(wx / CHUNK_SIZE), cz = Math.floor(wz / CHUNK_SIZE);
  if (cx !== chunk.cx || cz !== chunk.cz) return;
  const lx = wx - cx * CHUNK_SIZE, lz = wz - cz * CHUNK_SIZE;
  const idx = blockIndex(lx, wy, lz);
  if (!overwrite && chunk.blocks[idx] !== BLOCK.AIR && block === BLOCK.AIR) return;
  chunk.blocks[idx] = block;
}

// Solid square tower with a stepped pyramid roof + spire.
function buildTower(chunk, cx, cz, baseY, height, radius, wallBlock, roofBlock) {
  const top = baseY + height;
  // Hollow square tower
  for (let y = baseY; y <= top; y++) {
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dz = -radius; dz <= radius; dz++) {
        const onWall = (Math.abs(dx) === radius || Math.abs(dz) === radius);
        if (onWall) chunkWrite(chunk, cx + dx, y, cz + dz, wallBlock);
        else if (y === baseY) chunkWrite(chunk, cx + dx, y, cz + dz, BLOCK.PLANKS); // floor
      }
    }
  }
  // Battlements (merlons) on tower top
  for (let dx = -radius; dx <= radius; dx++) {
    for (let dz = -radius; dz <= radius; dz++) {
      const onWall = (Math.abs(dx) === radius || Math.abs(dz) === radius);
      if (onWall && (Math.abs(dx + dz) % 2 === 0)) {
        chunkWrite(chunk, cx + dx, top + 1, cz + dz, wallBlock);
      }
    }
  }
  // Stepped pyramid roof
  let r = radius + 1;
  let y = top + 2;
  while (r >= 0) {
    for (let dx = -r; dx <= r; dx++) {
      for (let dz = -r; dz <= r; dz++) {
        if (Math.abs(dx) === r || Math.abs(dz) === r || r === 0) {
          chunkWrite(chunk, cx + dx, y, cz + dz, roofBlock);
        }
      }
    }
    r -= 1;
    y += 1;
  }
  // Tall spire with banner
  for (let i = 0; i < 4; i++) chunkWrite(chunk, cx, y + i, cz, BLOCK.WOOD);
  // Green banner flag
  chunkWrite(chunk, cx + 1, y + 2, cz, BLOCK.LEAVES);
  chunkWrite(chunk, cx + 1, y + 3, cz, BLOCK.LEAVES);
}

// Build a castle into the chunk (may span multiple chunks).
function buildCastle(chunk, originX, originZ) {
  const baseH = terrainHeight(originX, originZ);
  // Raised plinth: castle sits 2 blocks above surrounding terrain
  const plinthY = baseH + 2;
  const platformY = plinthY + 1;

  const half = CASTLE_W / 2 | 0;
  const minX = originX - half, maxX = originX + half;
  const minZ = originZ - half, maxZ = originZ + half;

  // Moat: 4-wide trench around the plinth, 2 deep, sandy bottom + ice "water"
  const moatInner = half + 2;
  const moatOuter = half + 6;
  for (let x = originX - moatOuter; x <= originX + moatOuter; x++) {
    for (let z = originZ - moatOuter; z <= originZ + moatOuter; z++) {
      const dx = Math.abs(x - originX), dz = Math.abs(z - originZ);
      const inMoat = (dx <= moatOuter && dz <= moatOuter) &&
                      !(dx <= moatInner && dz <= moatInner);
      if (!inMoat) continue;
      const th = terrainHeight(x, z);
      // Carve down 2 below terrain, fill bottom with sand, then ice (water proxy)
      const bottom = baseH - 2;
      for (let y = bottom; y < CHUNK_HEIGHT; y++) chunkWrite(chunk, x, y, z, BLOCK.AIR);
      chunkWrite(chunk, x, bottom, z, BLOCK.SAND);
      chunkWrite(chunk, x, bottom + 1, z, BLOCK.ICE);
      chunkWrite(chunk, x, bottom + 2, z, BLOCK.ICE);
      // suppress excess terrain above
      for (let y = bottom + 3; y <= th + 4; y++) chunkWrite(chunk, x, y, z, BLOCK.AIR);
    }
  }

  // Plinth: solid cobble foundation
  for (let x = minX - 1; x <= maxX + 1; x++) {
    for (let z = minZ - 1; z <= maxZ + 1; z++) {
      const th = terrainHeight(x, z);
      // Fill from below up to plinthY with cobble
      for (let y = Math.min(th, plinthY) - 4; y <= plinthY; y++) {
        chunkWrite(chunk, x, y, z, BLOCK.COBBLE);
      }
      // Clear above up to platform-clear height
      for (let y = platformY; y < CHUNK_HEIGHT; y++) chunkWrite(chunk, x, y, z, BLOCK.AIR);
    }
  }

  // Courtyard floor: planks center, cobble ring
  for (let x = minX + 1; x <= maxX - 1; x++) {
    for (let z = minZ + 1; z <= maxZ - 1; z++) {
      chunkWrite(chunk, x, plinthY, z, BLOCK.COBBLE);
    }
  }
  // Inner pathway from gate to keep (planks)
  const gateCenterX = originX;
  for (let z = maxZ - 1; z >= originZ + 4; z--) {
    chunkWrite(chunk, gateCenterX,     plinthY, z, BLOCK.PLANKS);
    chunkWrite(chunk, gateCenterX - 1, plinthY, z, BLOCK.PLANKS);
    chunkWrite(chunk, gateCenterX + 1, plinthY, z, BLOCK.PLANKS);
  }

  // Outer curtain walls (cobble), 6 blocks tall, 2-block thick parapet at top
  const wallTop = platformY + 5;
  for (let y = platformY; y <= wallTop; y++) {
    for (let x = minX; x <= maxX; x++) {
      chunkWrite(chunk, x, y, minZ, BLOCK.COBBLE);
      chunkWrite(chunk, x, y, maxZ, BLOCK.COBBLE);
    }
    for (let z = minZ; z <= maxZ; z++) {
      chunkWrite(chunk, minX, y, z, BLOCK.COBBLE);
      chunkWrite(chunk, maxX, y, z, BLOCK.COBBLE);
    }
  }
  // Wall walk (planks) at wallTop along inside of walls
  for (let x = minX + 1; x <= maxX - 1; x++) {
    chunkWrite(chunk, x, wallTop, minZ + 1, BLOCK.PLANKS);
    chunkWrite(chunk, x, wallTop, maxZ - 1, BLOCK.PLANKS);
  }
  for (let z = minZ + 1; z <= maxZ - 1; z++) {
    chunkWrite(chunk, minX + 1, wallTop, z, BLOCK.PLANKS);
    chunkWrite(chunk, maxX - 1, wallTop, z, BLOCK.PLANKS);
  }
  // Crenellations (alternating brick merlons, 2 tall)
  for (let x = minX; x <= maxX; x += 2) {
    chunkWrite(chunk, x, wallTop + 1, minZ, BLOCK.BRICK);
    chunkWrite(chunk, x, wallTop + 2, minZ, BLOCK.BRICK);
    chunkWrite(chunk, x, wallTop + 1, maxZ, BLOCK.BRICK);
    chunkWrite(chunk, x, wallTop + 2, maxZ, BLOCK.BRICK);
  }
  for (let z = minZ; z <= maxZ; z += 2) {
    chunkWrite(chunk, minX, wallTop + 1, z, BLOCK.BRICK);
    chunkWrite(chunk, minX, wallTop + 2, z, BLOCK.BRICK);
    chunkWrite(chunk, maxX, wallTop + 1, z, BLOCK.BRICK);
    chunkWrite(chunk, maxX, wallTop + 2, z, BLOCK.BRICK);
  }

  // 4 corner towers: 5x5 base, 14 tall, brick walls, brick stepped roof + spire
  const corners = [
    [minX, minZ], [maxX, minZ], [minX, maxZ], [maxX, maxZ],
  ];
  for (const [tx, tz] of corners) {
    buildTower(chunk, tx, tz, platformY, 14, 2, BLOCK.BRICK, BLOCK.BRICK);
  }

  // 4 mid-wall guard towers (smaller)
  const mids = [
    [originX, minZ], [originX, maxZ], [minX, originZ], [maxX, originZ],
  ];
  for (const [tx, tz] of mids) {
    // Skip the south-mid since gatehouse takes that spot
    if (tx === originX && tz === maxZ) continue;
    buildTower(chunk, tx, tz, platformY, 9, 1, BLOCK.BRICK, BLOCK.BRICK);
  }

  // Gatehouse: twin towers flanking a 3-wide arched entry on south wall (z=maxZ)
  // Carve archway through the curtain wall
  for (let dx = -1; dx <= 1; dx++) {
    for (let y = platformY; y <= platformY + 3; y++) {
      chunkWrite(chunk, gateCenterX + dx, y, maxZ, BLOCK.AIR);
    }
  }
  // Brick arch top
  for (let dx = -2; dx <= 2; dx++) {
    chunkWrite(chunk, gateCenterX + dx, platformY + 4, maxZ, BLOCK.BRICK);
  }
  chunkWrite(chunk, gateCenterX, platformY + 5, maxZ, BLOCK.BRICK);
  // Twin gate towers
  buildTower(chunk, gateCenterX - 3, maxZ, platformY, 12, 1, BLOCK.BRICK, BLOCK.BRICK);
  buildTower(chunk, gateCenterX + 3, maxZ, platformY, 12, 1, BLOCK.BRICK, BLOCK.BRICK);
  // Banners flanking gate
  chunkWrite(chunk, gateCenterX - 2, platformY + 3, maxZ + 1, BLOCK.LEAVES);
  chunkWrite(chunk, gateCenterX - 2, platformY + 2, maxZ + 1, BLOCK.LEAVES);
  chunkWrite(chunk, gateCenterX + 2, platformY + 3, maxZ + 1, BLOCK.LEAVES);
  chunkWrite(chunk, gateCenterX + 2, platformY + 2, maxZ + 1, BLOCK.LEAVES);

  // Drawbridge across moat (planks at plinth level)
  for (let z = maxZ + 1; z <= originZ + moatOuter + 1; z++) {
    for (let dx = -1; dx <= 1; dx++) {
      chunkWrite(chunk, gateCenterX + dx, plinthY, z, BLOCK.PLANKS);
      // Clear airspace above
      for (let y = plinthY + 1; y <= plinthY + 4; y++) {
        chunkWrite(chunk, gateCenterX + dx, y, z, BLOCK.AIR);
      }
    }
  }
  // Bridge railing posts
  for (let z = maxZ + 2; z <= originZ + moatOuter; z += 2) {
    chunkWrite(chunk, gateCenterX - 2, plinthY + 1, z, BLOCK.WOOD);
    chunkWrite(chunk, gateCenterX + 2, plinthY + 1, z, BLOCK.WOOD);
  }

  // Central keep: 9x9 brick fortress, 18 tall, multi-floor with planks
  const k = 4;
  const keepBaseY = platformY;
  const keepTopY = platformY + 18;
  for (let x = originX - k; x <= originX + k; x++) {
    for (let z = originZ - k; z <= originZ + k; z++) {
      const onWall = (x === originX - k || x === originX + k ||
                      z === originZ - k || z === originZ + k);
      for (let y = keepBaseY; y <= keepTopY; y++) {
        if (onWall) chunkWrite(chunk, x, y, z, BLOCK.BRICK);
      }
      // Multiple planks floors
      if (!onWall) {
        for (const fy of [platformY + 5, platformY + 10, platformY + 15]) {
          chunkWrite(chunk, x, fy, z, BLOCK.PLANKS);
        }
      }
    }
  }
  // Keep entrance (north side facing courtyard) - 2 wide, 3 tall
  for (let dx = -1; dx <= 0; dx++) {
    for (let y = keepBaseY + 1; y <= keepBaseY + 3; y++) {
      chunkWrite(chunk, originX + dx, y, originZ - k, BLOCK.AIR);
    }
  }
  // Decorative archway over keep entrance
  chunkWrite(chunk, originX - 2, keepBaseY + 4, originZ - k, BLOCK.PLANKS);
  chunkWrite(chunk, originX - 1, keepBaseY + 4, originZ - k, BLOCK.PLANKS);
  chunkWrite(chunk, originX,     keepBaseY + 4, originZ - k, BLOCK.PLANKS);
  chunkWrite(chunk, originX + 1, keepBaseY + 4, originZ - k, BLOCK.PLANKS);

  // Keep windows on each side at each floor
  for (const wy of [platformY + 7, platformY + 12, platformY + 16]) {
    chunkWrite(chunk, originX,     wy, originZ - k, BLOCK.AIR);
    chunkWrite(chunk, originX,     wy, originZ + k, BLOCK.AIR);
    chunkWrite(chunk, originX - k, wy, originZ,     BLOCK.AIR);
    chunkWrite(chunk, originX + k, wy, originZ,     BLOCK.AIR);
  }
  // Keep crenellations (2-tall merlons)
  for (let x = originX - k; x <= originX + k; x += 2) {
    chunkWrite(chunk, x, keepTopY + 1, originZ - k, BLOCK.BRICK);
    chunkWrite(chunk, x, keepTopY + 2, originZ - k, BLOCK.BRICK);
    chunkWrite(chunk, x, keepTopY + 1, originZ + k, BLOCK.BRICK);
    chunkWrite(chunk, x, keepTopY + 2, originZ + k, BLOCK.BRICK);
  }
  for (let z = originZ - k; z <= originZ + k; z += 2) {
    chunkWrite(chunk, originX - k, keepTopY + 1, z, BLOCK.BRICK);
    chunkWrite(chunk, originX - k, keepTopY + 2, z, BLOCK.BRICK);
    chunkWrite(chunk, originX + k, keepTopY + 1, z, BLOCK.BRICK);
    chunkWrite(chunk, originX + k, keepTopY + 2, z, BLOCK.BRICK);
  }
  // Keep central spire (tall flagpole with king's banner)
  for (let i = 0; i < 7; i++) chunkWrite(chunk, originX, keepTopY + 1 + i, originZ, BLOCK.WOOD);
  // Big leaf banner (3 tall, 2 wide)
  for (let i = 0; i < 3; i++) {
    chunkWrite(chunk, originX + 1, keepTopY + 4 + i, originZ, BLOCK.LEAVES);
    chunkWrite(chunk, originX + 2, keepTopY + 4 + i, originZ, BLOCK.LEAVES);
  }

  // Courtyard well (cobble ring with ice "water" inside) west of keep
  const wellX = originX - 8, wellZ = originZ + 4;
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      if (Math.abs(dx) + Math.abs(dz) === 2) {
        chunkWrite(chunk, wellX + dx, plinthY,     wellZ + dz, BLOCK.COBBLE);
        chunkWrite(chunk, wellX + dx, plinthY + 1, wellZ + dz, BLOCK.COBBLE);
      }
    }
  }
  chunkWrite(chunk, wellX, plinthY, wellZ, BLOCK.ICE);
  // Well roof posts + planks roof
  chunkWrite(chunk, wellX - 1, plinthY + 2, wellZ - 1, BLOCK.WOOD);
  chunkWrite(chunk, wellX + 1, plinthY + 2, wellZ - 1, BLOCK.WOOD);
  chunkWrite(chunk, wellX - 1, plinthY + 2, wellZ + 1, BLOCK.WOOD);
  chunkWrite(chunk, wellX + 1, plinthY + 2, wellZ + 1, BLOCK.WOOD);
  for (let dx = -1; dx <= 1; dx++)
    for (let dz = -1; dz <= 1; dz++)
      chunkWrite(chunk, wellX + dx, plinthY + 3, wellZ + dz, BLOCK.PLANKS);

  // Decorative wood pillars at the courtyard corners
  const pillars = [
    [originX - 10, originZ - 6], [originX + 10, originZ - 6],
    [originX - 10, originZ + 6], [originX + 10, originZ + 6],
  ];
  for (const [px, pz] of pillars) {
    for (let y = plinthY + 1; y <= plinthY + 3; y++) chunkWrite(chunk, px, y, pz, BLOCK.WOOD);
    chunkWrite(chunk, px, plinthY + 4, pz, BLOCK.LEAVES);
  }

  // Stair from courtyard up to wall walk (planks staircase along east interior wall)
  for (let i = 0; i < 5; i++) {
    const sx = maxX - 1;
    const sz = originZ - 4 + i;
    for (let y = plinthY + 1; y <= plinthY + 1 + i; y++) {
      chunkWrite(chunk, sx, y, sz, BLOCK.PLANKS);
    }
  }
}

// Build an ice spike at (wx, wz) into chunk (if blocks fall inside).
function buildIceSpike(chunk, wx, wz) {
  const baseH = terrainHeight(wx, wz);
  const height = 8 + ((hash2(wx, wz, WORLD_SEED + 555) * 7) | 0);
  for (let y = 0; y < height; y++) {
    const t = y / height;
    const radius = Math.max(0, Math.round((1 - t) * 2.2));
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dz = -radius; dz <= radius; dz++) {
        if (dx * dx + dz * dz > radius * radius + 0.3) continue;
        chunkWrite(chunk, wx + dx, baseH + 1 + y, wz + dz, BLOCK.ICE);
      }
    }
  }
  // Tip
  chunkWrite(chunk, wx, baseH + 1 + height, wz, BLOCK.ICE);
}

function generateChunk(chunk) {
  const { cx, cz } = chunk;
  const SEA_LEVEL = 25;
  for (let x = 0; x < CHUNK_SIZE; x++) {
    for (let z = 0; z < CHUNK_SIZE; z++) {
      const wx = cx * CHUNK_SIZE + x;
      const wz = cz * CHUNK_SIZE + z;
      const h = terrainHeight(wx, wz);
      const temp = biomeTemp(wx, wz);
      const biome = surfaceBiome(wx, wz);
      // 0..1: how "icy" this column is overall (drives decoration density).
      const iceWeight = snowChance(temp);
      const underwater = h < SEA_LEVEL;
      const beach = !underwater && h <= SEA_LEVEL + 1; // sandy shore one block above sea

      for (let y = 0; y <= h && y < CHUNK_HEIGHT; y++) {
        let b;
        if (underwater || beach) {
          // Lake/sea bed: sand on top, dirt below, stone deeper.
          if (y === h) b = BLOCK.SAND;
          else if (y > h - 3) b = BLOCK.SAND;
          else b = BLOCK.STONE;
        } else if (biome === 'ice') {
          if (y === h) b = BLOCK.SNOW;
          else if (y > h - 3) b = BLOCK.DIRT;
          else b = BLOCK.STONE;
        } else {
          if (y === h) b = BLOCK.GRASS;
          else if (y > h - 4) b = BLOCK.DIRT;
          else b = BLOCK.STONE;
        }
        chunk.blocks[blockIndex(x, y, z)] = b;
      }

      // Fill water from h+1 up to SEA_LEVEL (inclusive). In ice biomes, freeze
      // the very top layer into ice for a wintry look.
      if (underwater) {
        for (let y = h + 1; y <= SEA_LEVEL && y < CHUNK_HEIGHT; y++) {
          if (biome === 'ice' && y === SEA_LEVEL) {
            chunk.blocks[blockIndex(x, y, z)] = BLOCK.ICE;
          } else {
            chunk.blocks[blockIndex(x, y, z)] = BLOCK.WATER;
          }
        }
      }

      // Decorations (skip if inside the castle footprint of any nearby castle,
      // or if this column is underwater).
      const r = hash2(wx, wz, WORLD_SEED + 99);
      const insideAnyCastle = isInsideAnyCastleFootprint(wx, wz);

      // Trees: probability fades to 0 as we move into ice.
      // (1 - iceWeight) so plains = full density, ice band = tapered, ice = 0.
      if (!insideAnyCastle && !underwater && !beach) {
        const treeChance = (1 - iceWeight) * 0.008;
        if (r > 1 - treeChance && h + 6 < CHUNK_HEIGHT &&
            x >= 2 && x < CHUNK_SIZE - 2 && z >= 2 && z < CHUNK_SIZE - 2) {
          const trunk = 4 + ((r * 1000) % 2 | 0);
          for (let i = 1; i <= trunk; i++) {
            chunk.blocks[blockIndex(x, h + i, z)] = BLOCK.WOOD;
          }
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -2; dx <= 2; dx++) {
              for (let dz = -2; dz <= 2; dz++) {
                if (dx === 0 && dz === 0 && dy < 1) continue;
                const lx = x + dx, ly = h + trunk + dy, lz = z + dz;
                if (lx < 0 || lx >= CHUNK_SIZE || lz < 0 || lz >= CHUNK_SIZE) continue;
                if (ly >= CHUNK_HEIGHT) continue;
                if (Math.abs(dx) + Math.abs(dz) + Math.abs(dy) > 3) continue;
                const idx = blockIndex(lx, ly, lz);
                if (chunk.blocks[idx] === BLOCK.AIR) chunk.blocks[idx] = BLOCK.LEAVES;
              }
            }
          }
          chunk.blocks[blockIndex(x, h + trunk + 1, z)] = BLOCK.LEAVES;
        }
      }
      // Ice spikes are placed below in a separate pass (cross-chunk safe)
    }
  }

  // ----- Cross-chunk structures -----
  // 1) Ice spikes — iterate world cells in a margin around this chunk
  const margin = 3;
  const minWX = cx * CHUNK_SIZE - margin, maxWX = (cx + 1) * CHUNK_SIZE + margin;
  const minWZ = cz * CHUNK_SIZE - margin, maxWZ = (cz + 1) * CHUNK_SIZE + margin;
  for (let wx = minWX; wx < maxWX; wx++) {
    for (let wz = minWZ; wz < maxWZ; wz++) {
      const temp = biomeTemp(wx, wz);
      const w = snowChance(temp); // 1 in pure ice, 0 in pure plains
      if (w <= 0.05) continue;
      const r = hash2(wx, wz, WORLD_SEED + 311);
      // Ice-spike threshold scales with iciness: more spikes deep in the biome,
      // sparse and random near the border.
      const thresh = 1 - 0.015 * w;
      if (r > thresh && !isInsideAnyCastleFootprint(wx, wz) && terrainHeight(wx, wz) >= 25) {
        buildIceSpike(chunk, wx, wz);
      }
    }
  }

  // 2) Castles — for each region whose footprint may overlap this chunk
  const halfRegions = 2;
  const myRX = Math.floor(cx / CASTLE_REGION);
  const myRZ = Math.floor(cz / CASTLE_REGION);
  for (let drx = -halfRegions; drx <= halfRegions; drx++) {
    for (let drz = -halfRegions; drz <= halfRegions; drz++) {
      const origin = castleOriginForRegion(myRX + drx, myRZ + drz);
      if (!origin) continue;
      // does chunk overlap castle footprint? (incl. moat + drawbridge)
      const half = 28;
      const cwxMin = cx * CHUNK_SIZE, cwxMax = (cx + 1) * CHUNK_SIZE - 1;
      const cwzMin = cz * CHUNK_SIZE, cwzMax = (cz + 1) * CHUNK_SIZE - 1;
      if (origin.wx + half < cwxMin || origin.wx - half > cwxMax) continue;
      if (origin.wz + half < cwzMin || origin.wz - half > cwzMax) continue;
      buildCastle(chunk, origin.wx, origin.wz);
    }
  }

  chunk.generated = true;
}

function isInsideAnyCastleFootprint(wx, wz) {
  const rx = Math.floor(wx / (CASTLE_REGION * CHUNK_SIZE));
  const rz = Math.floor(wz / (CASTLE_REGION * CHUNK_SIZE));
  const half = 26;
  for (let drx = -1; drx <= 1; drx++) {
    for (let drz = -1; drz <= 1; drz++) {
      const o = castleOriginForRegion(rx + drx, rz + drz);
      if (!o) continue;
      if (Math.abs(wx - o.wx) <= half && Math.abs(wz - o.wz) <= half) return true;
    }
  }
  return false;
}

// ============================================================
// Chunk: stores blocks in a flat Uint8Array
// Index: x + z*CHUNK_SIZE + y*CHUNK_SIZE*CHUNK_SIZE
// ============================================================
function blockIndex(x, y, z) {
  return x + z * CHUNK_SIZE + y * CHUNK_SIZE * CHUNK_SIZE;
}

class Chunk {
  constructor(cx, cz) {
    this.cx = cx;
    this.cz = cz;
    this.blocks = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE * CHUNK_HEIGHT);
    this.mesh = null;
    this.dirty = true;
    this.generated = false;
  }
  get(x, y, z) {
    if (y < 0 || y >= CHUNK_HEIGHT) return BLOCK.AIR;
    return this.blocks[blockIndex(x, y, z)];
  }
  set(x, y, z, v) {
    if (y < 0 || y >= CHUNK_HEIGHT) return;
    this.blocks[blockIndex(x, y, z)] = v;
    this.dirty = true;
  }
}

function generateChunkOLD_REMOVED() {}

// ============================================================
// World: chunk container with cross-chunk block lookups
// ============================================================
class World {
  constructor() {
    this.chunks = new Map();
  }
  key(cx, cz) { return `${cx},${cz}`; }
  getChunk(cx, cz) { return this.chunks.get(this.key(cx, cz)); }
  ensureChunk(cx, cz) {
    let c = this.getChunk(cx, cz);
    if (!c) {
      c = new Chunk(cx, cz);
      this.chunks.set(this.key(cx, cz), c);
    }
    return c;
  }
  getBlock(wx, wy, wz) {
    if (wy < 0 || wy >= CHUNK_HEIGHT) return BLOCK.AIR;
    const cx = Math.floor(wx / CHUNK_SIZE);
    const cz = Math.floor(wz / CHUNK_SIZE);
    const c = this.getChunk(cx, cz);
    if (!c || !c.generated) return BLOCK.AIR;
    const lx = wx - cx * CHUNK_SIZE;
    const lz = wz - cz * CHUNK_SIZE;
    return c.blocks[blockIndex(lx, wy, lz)];
  }
  setBlock(wx, wy, wz, v) {
    if (wy < 0 || wy >= CHUNK_HEIGHT) return;
    const cx = Math.floor(wx / CHUNK_SIZE);
    const cz = Math.floor(wz / CHUNK_SIZE);
    const c = this.getChunk(cx, cz);
    if (!c) return;
    const lx = wx - cx * CHUNK_SIZE;
    const lz = wz - cz * CHUNK_SIZE;
    c.blocks[blockIndex(lx, wy, lz)] = v;
    c.dirty = true;
    // Mark neighboring chunks dirty if on boundary
    if (lx === 0)              { const n = this.getChunk(cx - 1, cz); if (n) n.dirty = true; }
    if (lx === CHUNK_SIZE - 1) { const n = this.getChunk(cx + 1, cz); if (n) n.dirty = true; }
    if (lz === 0)              { const n = this.getChunk(cx, cz - 1); if (n) n.dirty = true; }
    if (lz === CHUNK_SIZE - 1) { const n = this.getChunk(cx, cz + 1); if (n) n.dirty = true; }
  }
  isSolid(wx, wy, wz) {
    const b = this.getBlock(wx, wy, wz);
    return b !== BLOCK.AIR && !isLiquid(b);
  }
  isWater(wx, wy, wz) {
    return this.getBlock(wx, wy, wz) === BLOCK.WATER;
  }
}

// ============================================================
// Mesh builder with face culling
// ============================================================
const FACES = [
  // +X
  { dir: [ 1, 0, 0], corners: [[1,0,1],[1,1,1],[1,1,0],[1,0,0]], normal:[1,0,0],  flip:true },
  // -X
  { dir: [-1, 0, 0], corners: [[0,0,0],[0,1,0],[0,1,1],[0,0,1]], normal:[-1,0,0], flip:true },
  // +Y (top)
  { dir: [ 0, 1, 0], corners: [[0,1,1],[1,1,1],[1,1,0],[0,1,0]], normal:[0,1,0],  flip:false },
  // -Y (bottom)
  { dir: [ 0,-1, 0], corners: [[0,0,0],[1,0,0],[1,0,1],[0,0,1]], normal:[0,-1,0], flip:false },
  // +Z
  { dir: [ 0, 0, 1], corners: [[1,0,1],[0,0,1],[0,1,1],[1,1,1]], normal:[0,0,1],  flip:true },
  // -Z
  { dir: [ 0, 0,-1], corners: [[0,0,0],[0,1,0],[1,1,0],[1,0,0]], normal:[0,0,-1], flip:false },
];
// Face index mapping to BLOCK_TEXTURES indices: [+x,-x,+y,-y,+z,-z]
const FACE_LIGHT = [0.75, 0.75, 1.0, 0.5, 0.85, 0.85];

function tileUV(tileIndex) {
  const px = tileIndex % ATLAS_TILES;
  const py = Math.floor(tileIndex / ATLAS_TILES);
  // Inset slightly to avoid bleeding
  const eps = 0.5 / (ATLAS_TILES * TILE_PIXELS);
  const u0 = px / ATLAS_TILES + eps;
  const u1 = (px + 1) / ATLAS_TILES - eps;
  const v0 = 1 - (py + 1) / ATLAS_TILES + eps;
  const v1 = 1 - py / ATLAS_TILES - eps;
  return [u0, v0, u1, v1];
}

function buildChunkMesh(world, chunk, material, pass) {
  // pass: 'opaque' (default) builds the solid mesh; 'water' builds the
  // translucent water mesh. They use different culling rules.
  pass = pass || 'opaque';
  const positions = [];
  const normals = [];
  const uvs = [];
  const colors = [];
  const indices = [];

  const baseX = chunk.cx * CHUNK_SIZE;
  const baseZ = chunk.cz * CHUNK_SIZE;

  for (let y = 0; y < CHUNK_HEIGHT; y++) {
    for (let z = 0; z < CHUNK_SIZE; z++) {
      for (let x = 0; x < CHUNK_SIZE; x++) {
        const b = chunk.blocks[blockIndex(x, y, z)];
        if (b === BLOCK.AIR) continue;
        if (pass === 'opaque' && b === BLOCK.WATER) continue;
        if (pass === 'water' && b !== BLOCK.WATER) continue;
        const tex = BLOCK_TEXTURES[b];
        for (let f = 0; f < 6; f++) {
          const face = FACES[f];
          const nx = x + face.dir[0];
          const ny = y + face.dir[1];
          const nz = z + face.dir[2];
          let neighbor;
          if (nx < 0 || nx >= CHUNK_SIZE || nz < 0 || nz >= CHUNK_SIZE) {
            neighbor = world.getBlock(baseX + nx, ny, baseZ + nz);
          } else if (ny < 0 || ny >= CHUNK_HEIGHT) {
            neighbor = BLOCK.AIR;
          } else {
            neighbor = chunk.blocks[blockIndex(nx, ny, nz)];
          }
          // Cull rules:
          // - Opaque face: cull when neighbor is opaque (visible against air or water).
          // - Water face: cull when neighbor is opaque or also water (visible only against air).
          if (pass === 'opaque') {
            if (isOpaqueBlock(neighbor)) continue;
          } else {
            if (neighbor !== BLOCK.AIR) continue;
          }

          const [u0, v0, u1, v1] = tileUV(tex[f]);
          const light = FACE_LIGHT[f];
          const startVertex = positions.length / 3;

          for (let i = 0; i < 4; i++) {
            const c = face.corners[i];
            positions.push(x + c[0], y + c[1], z + c[2]);
            normals.push(face.normal[0], face.normal[1], face.normal[2]);
            colors.push(light, light, light);
          }
          // UV mapping per face (u,v ordering chosen so textures are upright)
          uvs.push(u0, v0,  u1, v0,  u1, v1,  u0, v1);

          indices.push(startVertex, startVertex + 1, startVertex + 2);
          indices.push(startVertex, startVertex + 2, startVertex + 3);
          if (face.flip) {
            // Replace last 6 indices with flipped winding so the face points outward
            indices.length -= 6;
            indices.push(startVertex, startVertex + 2, startVertex + 1);
            indices.push(startVertex, startVertex + 3, startVertex + 2);
          }
        }
      }
    }
  }

  const meshKey = pass === 'water' ? 'waterMesh' : 'mesh';
  const existing = chunk[meshKey];
  if (existing) {
    existing.geometry.dispose();
  }

  if (positions.length === 0) {
    if (existing) {
      existing.parent && existing.parent.remove(existing);
      chunk[meshKey] = null;
    }
    return null;
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geom.setAttribute('normal',   new THREE.Float32BufferAttribute(normals, 3));
  geom.setAttribute('uv',       new THREE.Float32BufferAttribute(uvs, 2));
  geom.setAttribute('color',    new THREE.Float32BufferAttribute(colors, 3));
  geom.setIndex(indices);
  geom.computeBoundingSphere();

  if (!chunk[meshKey]) {
    const m = new THREE.Mesh(geom, material);
    m.position.set(chunk.cx * CHUNK_SIZE, 0, chunk.cz * CHUNK_SIZE);
    m.matrixAutoUpdate = false;
    m.updateMatrix();
    m.frustumCulled = true;
    if (pass === 'water') m.renderOrder = 1;
    chunk[meshKey] = m;
  } else {
    chunk[meshKey].geometry = geom;
  }
  return chunk[meshKey];
}

// ============================================================
// Mobs (pigs & zombies) — blocky models, simple AI, walk animation
// ============================================================
class Mob {
  constructor(scene, world, x, y, z, type) {
    this.scene = scene;
    this.world = world;
    this.type = type;
    this.pos = new THREE.Vector3(x, y, z);
    this.vel = new THREE.Vector3();
    this.yaw = Math.random() * Math.PI * 2;
    this.targetYaw = this.yaw;
    this.wanderTimer = 0;
    this.idle = false;
    this.onGround = false;
    this.walkPhase = 0;
    this.attackPhase = 0;
    this.dead = false;

    if (type === 'pig') {
      this.radius = 0.32;
      this.height = 0.9;
      this.eye = 0.7;
      this.hp = 4;
    } else if (type === 'cow') {
      this.radius = 0.36;
      this.height = 1.2;
      this.eye = 1.0;
      this.hp = 5;
    } else if (type === 'sheep') {
      this.radius = 0.34;
      this.height = 1.05;
      this.eye = 0.9;
      this.hp = 4;
    } else if (type === 'chicken') {
      this.radius = 0.18;
      this.height = 0.55;
      this.eye = 0.4;
      this.hp = 2;
    } else if (type === 'skeleton') {
      this.radius = 0.3;
      this.height = 1.85;
      this.eye = 1.6;
      this.hp = 5;
    } else if (type === 'creeper') {
      this.radius = 0.3;
      this.height = 1.65;
      this.eye = 1.45;
      this.hp = 6;
      this.fuse = 0;          // sec while priming
      this.priming = false;
    } else {
      // zombie
      this.radius = 0.3;
      this.height = 1.85;
      this.eye = 1.6;
      this.hp = 6;
    }

    // Hostile mobs that burn in sunlight (like the real game)
    this.burnsInSun = (type === 'zombie' || type === 'skeleton');
    this.hostile = (type === 'zombie' || type === 'skeleton' || type === 'creeper');

    this.onFire = false;
    this.fireTime = 0;          // how long it's been burning (sec)
    this.burnDamageAcc = 0;     // accumulator for tick damage
    this.fireSprite = null;     // animated flame sprite, lazily attached

    this.group = new THREE.Group();
    this.parts = {};
    this.buildModel();
    // Snapshot base colors for tint restoration
    this.baseColors = this.materials.map(m => m.color.clone());
    this.scene.add(this.group);
  }

  applyTint(rgb) {
    // rgb is THREE.Color or {r,g,b} multiplier in [0,1].
    for (let i = 0; i < this.materials.length; i++) {
      const base = this.baseColors[i];
      this.materials[i].color.setRGB(base.r * rgb.r, base.g * rgb.g, base.b * rgb.b);
    }
  }

  attachFireSprite(fireTexture) {
    if (this.fireSprite) return;
    const mat = new THREE.SpriteMaterial({
      map: fireTexture.clone(),
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
    });
    mat.map.needsUpdate = true;
    mat.map.repeat.set(0.25, 1);
    const s = new THREE.Sprite(mat);
    s.scale.set(this.radius * 4.2, this.height * 1.35, 1);
    s.position.y = this.height * 0.5;
    s.renderOrder = 999;
    this.group.add(s);
    this.fireSprite = s;
  }

  detachFireSprite() {
    if (!this.fireSprite) return;
    this.group.remove(this.fireSprite);
    if (this.fireSprite.material.map) this.fireSprite.material.map.dispose();
    this.fireSprite.material.dispose();
    this.fireSprite = null;
  }

  buildModel() {
    this.materials = [];
    const reg = (m) => { this.materials.push(m); return m; };
    if (this.type === 'pig') {
      const pink = reg(new THREE.MeshBasicMaterial({ color: 0xefa3a8 }));
      const darkPink = reg(new THREE.MeshBasicMaterial({ color: 0xc97478 }));
      const black = reg(new THREE.MeshBasicMaterial({ color: 0x000000 }));

      const body = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.5, 0.9), pink);
      body.position.set(0, 0.6, 0);
      this.group.add(body);

      const head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), pink);
      head.position.set(0, 0.7, 0.55);
      this.group.add(head);
      this.parts.head = head;

      const snout = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.2, 0.1), darkPink);
      snout.position.set(0, -0.05, 0.3);
      head.add(snout);

      [-0.13, 0.13].forEach(x => {
        const eye = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.04), black);
        eye.position.set(x, 0.1, 0.255);
        head.add(eye);
      });

      // Legs pivoted at the hip (top)
      const legGeom = new THREE.BoxGeometry(0.16, 0.35, 0.16);
      legGeom.translate(0, -0.175, 0);
      this.parts.legs = [];
      const legSpots = [[-0.17, 0.35,  0.3 ], [ 0.17, 0.35,  0.3 ],
                        [-0.17, 0.35, -0.3 ], [ 0.17, 0.35, -0.3 ]];
      legSpots.forEach(p => {
        const leg = new THREE.Mesh(legGeom, pink);
        leg.position.set(p[0], p[1], p[2]);
        this.group.add(leg);
        this.parts.legs.push(leg);
      });
    } else if (this.type === 'cow') {
      const brown = reg(new THREE.MeshBasicMaterial({ color: 0x4a2c1a }));
      const white = reg(new THREE.MeshBasicMaterial({ color: 0xe9e3d4 }));
      const black = reg(new THREE.MeshBasicMaterial({ color: 0x141414 }));
      const horn  = reg(new THREE.MeshBasicMaterial({ color: 0xbab09a }));
      const muzzle = reg(new THREE.MeshBasicMaterial({ color: 0xf2c4a8 }));

      const body = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.65, 1.1), brown);
      body.position.y = 0.78;
      this.group.add(body);
      // White patches
      const patch1 = new THREE.Mesh(new THREE.BoxGeometry(0.71, 0.3, 0.35), white);
      patch1.position.set(0, -0.1, 0.2);
      body.add(patch1);
      const patch2 = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.3, 0.71), white);
      patch2.position.set(0.18, 0.2, -0.05);
      body.add(patch2);

      const head = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.55, 0.55), brown);
      head.position.set(0, 0.95, 0.7);
      this.group.add(head);
      this.parts.head = head;

      const muz = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.22, 0.1), muzzle);
      muz.position.set(0, -0.12, 0.3);
      head.add(muz);
      [-0.13, 0.13].forEach(x => {
        const eye = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.04), black);
        eye.position.set(x, 0.12, 0.28);
        head.add(eye);
      });
      // Horns
      [-0.22, 0.22].forEach(x => {
        const hn = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 0.09), horn);
        hn.position.set(x, 0.27, 0);
        head.add(hn);
      });

      const legGeom = new THREE.BoxGeometry(0.18, 0.5, 0.18);
      legGeom.translate(0, -0.25, 0);
      this.parts.legs = [];
      const spots = [[-0.2, 0.5,  0.4], [0.2, 0.5,  0.4],
                     [-0.2, 0.5, -0.4], [0.2, 0.5, -0.4]];
      spots.forEach(p => {
        const leg = new THREE.Mesh(legGeom, brown);
        leg.position.set(p[0], p[1], p[2]);
        this.group.add(leg);
        this.parts.legs.push(leg);
      });
    } else if (this.type === 'sheep') {
      const wool = reg(new THREE.MeshBasicMaterial({ color: 0xeae5dc }));
      const skin = reg(new THREE.MeshBasicMaterial({ color: 0xd5c8a8 }));
      const black = reg(new THREE.MeshBasicMaterial({ color: 0x141414 }));

      const body = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.62, 0.95), wool);
      body.position.y = 0.7;
      this.group.add(body);

      const head = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.45, 0.42), skin);
      head.position.set(0, 0.78, 0.6);
      this.group.add(head);
      this.parts.head = head;
      [-0.1, 0.1].forEach(x => {
        const eye = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 0.04), black);
        eye.position.set(x, 0.05, 0.215);
        head.add(eye);
      });

      const legGeom = new THREE.BoxGeometry(0.14, 0.4, 0.14);
      legGeom.translate(0, -0.2, 0);
      this.parts.legs = [];
      const spots = [[-0.16, 0.4,  0.3], [0.16, 0.4,  0.3],
                     [-0.16, 0.4, -0.3], [0.16, 0.4, -0.3]];
      spots.forEach(p => {
        const leg = new THREE.Mesh(legGeom, skin);
        leg.position.set(p[0], p[1], p[2]);
        this.group.add(leg);
        this.parts.legs.push(leg);
      });
    } else if (this.type === 'chicken') {
      const wht = reg(new THREE.MeshBasicMaterial({ color: 0xf0f0f0 }));
      const beak = reg(new THREE.MeshBasicMaterial({ color: 0xf2a93a }));
      const wattle = reg(new THREE.MeshBasicMaterial({ color: 0xc02a2a }));
      const black = reg(new THREE.MeshBasicMaterial({ color: 0x141414 }));

      const body = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.34, 0.42), wht);
      body.position.y = 0.32;
      this.group.add(body);

      const head = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.26, 0.26), wht);
      head.position.set(0, 0.55, 0.18);
      this.group.add(head);
      this.parts.head = head;
      const bk = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.07, 0.08), beak);
      bk.position.set(0, -0.02, 0.17);
      head.add(bk);
      const wt = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.06, 0.06), wattle);
      wt.position.set(0, -0.12, 0.13);
      head.add(wt);
      [-0.08, 0.08].forEach(x => {
        const eye = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.03), black);
        eye.position.set(x, 0.05, 0.135);
        head.add(eye);
      });
      // Wings (on sides)
      [-0.18, 0.18].forEach(x => {
        const wing = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.28, 0.32), wht);
        wing.position.set(x, 0.32, 0);
        this.group.add(wing);
      });

      const legGeom = new THREE.BoxGeometry(0.06, 0.18, 0.06);
      legGeom.translate(0, -0.09, 0);
      this.parts.legs = [];
      [-0.08, 0.08].forEach(x => {
        const leg = new THREE.Mesh(legGeom, beak);
        leg.position.set(x, 0.18, 0);
        this.group.add(leg);
        this.parts.legs.push(leg);
      });
    } else if (this.type === 'skeleton') {
      const bone = reg(new THREE.MeshBasicMaterial({ color: 0xcdcdc1 }));
      const dark = reg(new THREE.MeshBasicMaterial({ color: 0x202020 }));

      const body = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.7, 0.28), bone);
      body.position.y = 1.05;
      this.group.add(body);
      // Rib lines (simple dark stripes via thin black boxes)
      for (let i = 0; i < 3; i++) {
        const rib = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.04, 0.29), dark);
        rib.position.set(0, 0.2 - i * 0.18, 0);
        body.add(rib);
      }

      const head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), bone);
      head.position.y = 1.65;
      this.group.add(head);
      this.parts.head = head;
      // Eye sockets
      [-0.12, 0.12].forEach(x => {
        const eye = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.1, 0.04), dark);
        eye.position.set(x, 0.06, 0.255);
        head.add(eye);
      });
      // Nose hole
      const nose = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.08, 0.03), dark);
      nose.position.set(0, -0.06, 0.255);
      head.add(nose);

      // Arms — held out forward like a bow stance
      const armGeom = new THREE.BoxGeometry(0.16, 0.7, 0.16);
      armGeom.translate(0, -0.35, 0);
      this.parts.arms = [];
      [-0.33, 0.33].forEach(x => {
        const arm = new THREE.Mesh(armGeom, bone);
        arm.position.set(x, 1.4, 0);
        arm.rotation.x = -Math.PI / 2.4;
        this.group.add(arm);
        this.parts.arms.push(arm);
      });
      // Legs
      const legGeom = new THREE.BoxGeometry(0.16, 0.7, 0.16);
      legGeom.translate(0, -0.35, 0);
      this.parts.legs = [];
      [-0.12, 0.12].forEach(x => {
        const leg = new THREE.Mesh(legGeom, bone);
        leg.position.set(x, 0.7, 0);
        this.group.add(leg);
        this.parts.legs.push(leg);
      });
    } else if (this.type === 'creeper') {
      const body = reg(new THREE.MeshBasicMaterial({ color: 0x4d9b3b }));
      const dark = reg(new THREE.MeshBasicMaterial({ color: 0x0e1a0c }));

      const torso = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.1, 0.32), body);
      torso.position.y = 0.85;
      this.group.add(torso);
      this.parts.torso = torso;

      const head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), body);
      head.position.y = 1.65;
      this.group.add(head);
      this.parts.head = head;
      // Iconic creeper face
      [-0.13, 0.13].forEach(x => {
        const eye = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.04), dark);
        eye.position.set(x, 0.07, 0.255);
        head.add(eye);
      });
      // Mouth (T-shape from 3 boxes)
      const mTop = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.16, 0.04), dark);
      mTop.position.set(0, -0.05, 0.255); head.add(mTop);
      const mL = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.08, 0.04), dark);
      mL.position.set(-0.08, -0.16, 0.255); head.add(mL);
      const mR = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.08, 0.04), dark);
      mR.position.set(0.08, -0.16, 0.255); head.add(mR);

      // Four little legs
      const legGeom = new THREE.BoxGeometry(0.18, 0.35, 0.18);
      legGeom.translate(0, -0.175, 0);
      this.parts.legs = [];
      const spots = [[-0.13, 0.35,  0.16], [0.13, 0.35,  0.16],
                     [-0.13, 0.35, -0.16], [0.13, 0.35, -0.16]];
      spots.forEach(p => {
        const leg = new THREE.Mesh(legGeom, body);
        leg.position.set(p[0], p[1], p[2]);
        this.group.add(leg);
        this.parts.legs.push(leg);
      });
    } else {
      // Zombie
      const skin = reg(new THREE.MeshBasicMaterial({ color: 0x4f8e35 }));
      const shirt = reg(new THREE.MeshBasicMaterial({ color: 0x2e5a8a }));
      const pants = reg(new THREE.MeshBasicMaterial({ color: 0x2c2a55 }));
      const eyeMat = reg(new THREE.MeshBasicMaterial({ color: 0x0a0a0a }));

      const body = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.7, 0.3), shirt);
      body.position.y = 1.05;
      this.group.add(body);

      const head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), skin);
      head.position.y = 1.65;
      this.group.add(head);
      this.parts.head = head;

      [-0.12, 0.12].forEach(x => {
        const eye = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.06, 0.04), eyeMat);
        eye.position.set(x, 0.05, 0.255);
        head.add(eye);
      });

      // Arms — pivoted at the shoulder, extended forward (classic zombie pose)
      const armGeom = new THREE.BoxGeometry(0.22, 0.7, 0.22);
      armGeom.translate(0, -0.35, 0);
      this.parts.arms = [];
      [-0.36, 0.36].forEach(x => {
        const arm = new THREE.Mesh(armGeom, skin);
        arm.position.set(x, 1.4, 0);
        arm.rotation.x = -Math.PI / 2.2;
        this.group.add(arm);
        this.parts.arms.push(arm);
      });

      // Legs — pivoted at the hip
      const legGeom = new THREE.BoxGeometry(0.22, 0.7, 0.22);
      legGeom.translate(0, -0.35, 0);
      this.parts.legs = [];
      [-0.13, 0.13].forEach(x => {
        const leg = new THREE.Mesh(legGeom, pants);
        leg.position.set(x, 0.7, 0);
        this.group.add(leg);
        this.parts.legs.push(leg);
      });
    }
  }

  // Box-vs-world collision check for an arbitrary AABB.
  _blocked(minX, minY, minZ, maxX, maxY, maxZ) {
    const x0 = Math.floor(minX), x1 = Math.floor(maxX);
    const y0 = Math.floor(minY), y1 = Math.floor(maxY);
    const z0 = Math.floor(minZ), z1 = Math.floor(maxZ);
    for (let x = x0; x <= x1; x++)
      for (let y = y0; y <= y1; y++)
        for (let z = z0; z <= z1; z++)
          if (this.world.isSolid(x, y, z)) return true;
    return false;
  }

  update(dt, player) {
    // ----- AI -----
    let speed = 0;
    if (this.type === 'zombie' || this.type === 'skeleton') {
      const dx = player.position.x - this.pos.x;
      const dz = player.position.z - this.pos.z;
      const distSq = dx * dx + dz * dz;
      const aggroRange = this.type === 'skeleton' ? 400 : 256;
      if (distSq < aggroRange) {
        this.targetYaw = Math.atan2(dx, dz);
        // Skeletons keep ~5 blocks distance to "shoot"
        if (this.type === 'skeleton' && distSq < 25) speed = -1.0;
        else speed = 1.9;
        if (this.type === 'zombie' && distSq < 2.0) {
          this.attackPhase += dt * 8;
        } else {
          this.attackPhase *= 0.9;
        }
      } else {
        this.wanderTimer -= dt;
        if (this.wanderTimer <= 0) {
          this.wanderTimer = 2 + Math.random() * 4;
          this.targetYaw = Math.random() * Math.PI * 2;
          this.idle = Math.random() < 0.3;
        }
        speed = this.idle ? 0 : 0.7;
        this.attackPhase *= 0.9;
      }
    } else if (this.type === 'creeper') {
      const dx = player.position.x - this.pos.x;
      const dz = player.position.z - this.pos.z;
      const dy = player.position.y - this.pos.y;
      const distSq = dx * dx + dz * dz;
      if (distSq < 144) { // 12-block aggro
        this.targetYaw = Math.atan2(dx, dz);
        speed = 1.6;
        // Begin priming when within 3 blocks
        const fullDistSq = distSq + dy * dy;
        if (fullDistSq < 9) {
          this.priming = true;
          this.fuse += dt;
          speed = 0;
          if (this.fuse >= 1.5) {
            this._explodeQueued = true;
          }
        } else {
          // Fuse fizzles if player gets away
          this.priming = false;
          this.fuse = Math.max(0, this.fuse - dt * 1.5);
        }
      } else {
        this.priming = false;
        this.fuse = Math.max(0, this.fuse - dt);
        this.wanderTimer -= dt;
        if (this.wanderTimer <= 0) {
          this.wanderTimer = 2 + Math.random() * 4;
          this.targetYaw = Math.random() * Math.PI * 2;
          this.idle = Math.random() < 0.4;
        }
        speed = this.idle ? 0 : 0.7;
      }
    } else if (this.type === 'chicken') {
      // Chicken: skittish, slow falling
      this.wanderTimer -= dt;
      if (this.wanderTimer <= 0) {
        this.wanderTimer = 2 + Math.random() * 4;
        this.targetYaw = Math.random() * Math.PI * 2;
        this.idle = Math.random() < 0.4;
      }
      speed = this.idle ? 0 : 0.55;
    } else {
      // Pig / cow / sheep: aimless wander
      this.wanderTimer -= dt;
      if (this.wanderTimer <= 0) {
        this.wanderTimer = 3 + Math.random() * 5;
        this.targetYaw = Math.random() * Math.PI * 2;
        this.idle = Math.random() < 0.45;
      }
      speed = this.idle ? 0 : 0.65;
    }

    // Smoothly turn toward target yaw (shortest path)
    let dy = this.targetYaw - this.yaw;
    while (dy > Math.PI)  dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    this.yaw += dy * Math.min(1, dt * 4);

    this.vel.x = Math.sin(this.yaw) * speed;
    this.vel.z = Math.cos(this.yaw) * speed;

    // Gravity (chickens fall slowly — flapping)
    const grav = this.type === 'chicken' ? 6 : 22;
    const termV = this.type === 'chicken' ? -3 : -35;
    this.vel.y -= grav * dt;
    if (this.vel.y < termV) this.vel.y = termV;

    const r = this.radius, h = this.height;

    // X axis
    {
      const nx = this.pos.x + this.vel.x * dt;
      const blocked = this._blocked(nx - r, this.pos.y, this.pos.z - r,
                                    nx + r, this.pos.y + h, this.pos.z + r);
      if (!blocked) this.pos.x = nx;
      else if (this.onGround) this.vel.y = 6.5; // auto-jump over 1-block obstacles
    }
    // Z axis
    {
      const nz = this.pos.z + this.vel.z * dt;
      const blocked = this._blocked(this.pos.x - r, this.pos.y, nz - r,
                                    this.pos.x + r, this.pos.y + h, nz + r);
      if (!blocked) this.pos.z = nz;
      else if (this.onGround) this.vel.y = 6.5;
    }
    // Y axis
    {
      const ny = this.pos.y + this.vel.y * dt;
      const blocked = this._blocked(this.pos.x - r, ny, this.pos.z - r,
                                    this.pos.x + r, ny + h, this.pos.z + r);
      if (blocked) {
        if (this.vel.y < 0) this.onGround = true;
        this.vel.y = 0;
      } else {
        this.pos.y = ny;
        this.onGround = false;
      }
    }

    // ----- Animation -----
    const moving = Math.hypot(this.vel.x, this.vel.z);
    this.walkPhase += moving * dt * 5;
    const swing = Math.sin(this.walkPhase) * 0.7;

    if ((this.type === 'pig' || this.type === 'cow' || this.type === 'sheep') && this.parts.legs) {
      // Diagonal gait: FL+BR swing together, FR+BL swing opposite
      this.parts.legs[0].rotation.x =  swing; // FL
      this.parts.legs[3].rotation.x =  swing; // BR
      this.parts.legs[1].rotation.x = -swing; // FR
      this.parts.legs[2].rotation.x = -swing; // BL
    } else if (this.type === 'chicken' && this.parts.legs) {
      this.parts.legs[0].rotation.x =  swing * 0.8;
      this.parts.legs[1].rotation.x = -swing * 0.8;
    } else if (this.type === 'zombie' && this.parts.legs) {
      this.parts.legs[0].rotation.x =  swing;
      this.parts.legs[1].rotation.x = -swing;
      if (this.parts.arms) {
        const armSwing = Math.sin(this.walkPhase) * 0.18;
        const attack = Math.sin(this.attackPhase) * 0.4 * Math.min(1, this.attackPhase * 0.2);
        this.parts.arms[0].rotation.x = -Math.PI / 2.2 + armSwing + attack;
        this.parts.arms[1].rotation.x = -Math.PI / 2.2 - armSwing + attack;
      }
    } else if (this.type === 'skeleton' && this.parts.legs) {
      this.parts.legs[0].rotation.x =  swing;
      this.parts.legs[1].rotation.x = -swing;
      if (this.parts.arms) {
        const armSwing = Math.sin(this.walkPhase) * 0.15;
        this.parts.arms[0].rotation.x = -Math.PI / 2.4 + armSwing;
        this.parts.arms[1].rotation.x = -Math.PI / 2.4 - armSwing;
      }
    } else if (this.type === 'creeper' && this.parts.legs) {
      // Creepers shuffle stiffly
      this.parts.legs[0].rotation.x =  swing * 0.4;
      this.parts.legs[3].rotation.x =  swing * 0.4;
      this.parts.legs[1].rotation.x = -swing * 0.4;
      this.parts.legs[2].rotation.x = -swing * 0.4;
      // Priming flash + scale pulse
      if (this.priming && this.parts.torso) {
        const k = Math.min(1, this.fuse / 1.5);
        const pulse = 1 + 0.15 * Math.sin(this.fuse * 30);
        this.parts.torso.scale.set(pulse, 1, pulse);
        if (this.parts.head) this.parts.head.scale.set(pulse, 1, pulse);
        // Flash white
        const flash = (Math.sin(this.fuse * 35) + 1) * 0.5 * k;
        const base = this.baseColors[0];
        const r = base.r + (1 - base.r) * flash;
        const g = base.g + (1 - base.g) * flash;
        const b = base.b + (1 - base.b) * flash;
        this.materials[0].color.setRGB(r, g, b);
      } else if (this.parts.torso) {
        this.parts.torso.scale.set(1, 1, 1);
        if (this.parts.head) this.parts.head.scale.set(1, 1, 1);
      }
    }

    // Apply transform
    this.group.position.set(this.pos.x, this.pos.y, this.pos.z);
    this.group.rotation.y = this.yaw;
  }

  destroy() {
    this.detachFireSprite();
    this.scene.remove(this.group);
    this.dead = true;
  }
}
// ============================================================
function makeBlockGeometry(blockType) {
  const positions = [], normals = [], uvs = [], colors = [], indices = [];
  const tex = BLOCK_TEXTURES[blockType];
  for (let f = 0; f < 6; f++) {
    const face = FACES[f];
    const [u0, v0, u1, v1] = tileUV(tex[f]);
    const light = FACE_LIGHT[f];
    const start = positions.length / 3;
    for (let i = 0; i < 4; i++) {
      const c = face.corners[i];
      // Center cube on origin so we can scale/rotate around its middle
      positions.push(c[0] - 0.5, c[1] - 0.5, c[2] - 0.5);
      normals.push(face.normal[0], face.normal[1], face.normal[2]);
      colors.push(light, light, light);
    }
    uvs.push(u0, v0, u1, v0, u1, v1, u0, v1);
    if (face.flip) {
      indices.push(start, start + 2, start + 1, start, start + 3, start + 2);
    } else {
      indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
    }
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geom.setAttribute('normal',   new THREE.Float32BufferAttribute(normals, 3));
  geom.setAttribute('uv',       new THREE.Float32BufferAttribute(uvs, 2));
  geom.setAttribute('color',    new THREE.Float32BufferAttribute(colors, 3));
  geom.setIndex(indices);
  geom.computeBoundingSphere();
  return geom;
}

// ============================================================
// Voxel raycast (Amanatides & Woo)
// ============================================================
function raycastVoxel(world, origin, dir, maxDist) {
  let x = Math.floor(origin.x);
  let y = Math.floor(origin.y);
  let z = Math.floor(origin.z);
  const stepX = Math.sign(dir.x) || 1;
  const stepY = Math.sign(dir.y) || 1;
  const stepZ = Math.sign(dir.z) || 1;
  const tDeltaX = Math.abs(1 / dir.x);
  const tDeltaY = Math.abs(1 / dir.y);
  const tDeltaZ = Math.abs(1 / dir.z);
  const xBoundary = stepX > 0 ? x + 1 : x;
  const yBoundary = stepY > 0 ? y + 1 : y;
  const zBoundary = stepZ > 0 ? z + 1 : z;
  let tMaxX = dir.x !== 0 ? (xBoundary - origin.x) / dir.x : Infinity;
  let tMaxY = dir.y !== 0 ? (yBoundary - origin.y) / dir.y : Infinity;
  let tMaxZ = dir.z !== 0 ? (zBoundary - origin.z) / dir.z : Infinity;
  let face = null;
  let t = 0;
  while (t <= maxDist) {
    if (world.isSolid(x, y, z)) {
      return { hit: true, x, y, z, face, t };
    }
    if (tMaxX < tMaxY) {
      if (tMaxX < tMaxZ) { x += stepX; t = tMaxX; tMaxX += tDeltaX; face = [-stepX, 0, 0]; }
      else               { z += stepZ; t = tMaxZ; tMaxZ += tDeltaZ; face = [0, 0, -stepZ]; }
    } else {
      if (tMaxY < tMaxZ) { y += stepY; t = tMaxY; tMaxY += tDeltaY; face = [0, -stepY, 0]; }
      else               { z += stepZ; t = tMaxZ; tMaxZ += tDeltaZ; face = [0, 0, -stepZ]; }
    }
  }
  return { hit: false };
}

// ============================================================
// Player + physics
// ============================================================
class Player {
  constructor(camera) {
    this.camera = camera;
    this.position = new THREE.Vector3(0, CHUNK_HEIGHT, 0);
    this.velocity = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.onGround = false;
    this.flying = false;
    this.height = 1.75;
    this.eyeOffset = 1.6;
    this.radius = 0.3;
    this.fallDistance = 0;
    this.inWater = false;
  }

  forwardVector(includePitch) {
    const v = new THREE.Vector3(
      Math.sin(this.yaw) * (includePitch ? Math.cos(this.pitch) : 1),
      includePitch ? -Math.sin(this.pitch) : 0, // note: invert: looking down lowers y
      Math.cos(this.yaw) * (includePitch ? Math.cos(this.pitch) : 1)
    );
    // Three.js uses -Z forward; the camera quaternion below handles direction.
    // For movement we use a horizontal direction.
    return v;
  }

  applyCameraRotation() {
    // yaw rotates around Y, pitch around X (camera space)
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.y = this.yaw;
    this.camera.rotation.x = this.pitch;
    this.camera.position.set(this.position.x, this.position.y + this.eyeOffset, this.position.z);
  }
}

// AABB collision: try each axis separately. Player AABB centered at (x,z), y from foot.
function collideAxis(world, pos, vel, axis) {
  const r = 0.3;
  const h = 1.75;
  const newPos = pos.clone();
  newPos[axis] += vel[axis];

  const minX = newPos.x - r, maxX = newPos.x + r;
  const minY = newPos.y,     maxY = newPos.y + h;
  const minZ = newPos.z - r, maxZ = newPos.z + r;

  const x0 = Math.floor(minX), x1 = Math.floor(maxX);
  const y0 = Math.floor(minY), y1 = Math.floor(maxY);
  const z0 = Math.floor(minZ), z1 = Math.floor(maxZ);

  let hit = false;
  for (let x = x0; x <= x1 && !hit; x++) {
    for (let y = y0; y <= y1 && !hit; y++) {
      for (let z = z0; z <= z1 && !hit; z++) {
        if (world.isSolid(x, y, z)) { hit = true; break; }
      }
    }
  }
  if (!hit) {
    pos[axis] = newPos[axis];
    return false;
  }
  // Snap to block boundary
  if (vel[axis] > 0) {
    // moving positive: snap to block face just before
    const lim = (axis === 'x') ? Math.floor(maxX) - r - 1e-4
              : (axis === 'y') ? Math.floor(maxY) - h - 1e-4
              :                   Math.floor(maxZ) - r - 1e-4;
    pos[axis] = lim;
  } else if (vel[axis] < 0) {
    const lim = (axis === 'x') ? Math.floor(minX) + 1 + r + 1e-4
              : (axis === 'y') ? Math.floor(minY) + 1 + 1e-4
              :                   Math.floor(minZ) + 1 + r + 1e-4;
    pos[axis] = lim;
  }
  vel[axis] = 0;
  return true;
}

// ============================================================
// Game
// ============================================================
class Game {
  constructor() {
    this.app = document.getElementById('app');
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x87ceeb);
    this.scene.fog = new THREE.Fog(0x87ceeb, RENDER_DISTANCE * CHUNK_SIZE * 0.55, RENDER_DISTANCE * CHUNK_SIZE);

    this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.app.appendChild(this.renderer.domElement);

    // Lighting (kept minimal; face shading via vertex colors)
    this.scene.add(new THREE.AmbientLight(0xffffff, 1.0));

    // Material with atlas. Use BasicMaterial; per-face brightness is baked
    // into vertex colors (Minecraft-style flat shading).
    const atlas = makeTextureAtlas();
    this.atlasCanvas = atlas.userData.canvas;
    this.material = new THREE.MeshBasicMaterial({
      map: atlas,
      vertexColors: true,
      side: THREE.FrontSide,
    });
    this.waterMaterial = new THREE.MeshBasicMaterial({
      map: atlas,
      vertexColors: true,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
    });

    this.world = new World();
    this.player = new Player(this.camera);

    // Selection wireframe
    const selGeom = new THREE.BoxGeometry(1.002, 1.002, 1.002);
    const edges = new THREE.EdgesGeometry(selGeom);
    this.selection = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x000000 }));
    this.selection.visible = false;
    this.scene.add(this.selection);

    // Crack overlay (shown while mining)
    this.crackTex = makeCrackTexture();
    this.fireTex = makeFireTexture();

    // Day/night cycle
    this.dayLength = 240;          // seconds for full day
    this.dayTime = 0.20;            // start mid-morning
    this.skyDay   = new THREE.Color(0x87ceeb);
    this.skyDusk  = new THREE.Color(0xf2935a);
    this.skyNight = new THREE.Color(0x06091a);
    this._tmpSky  = new THREE.Color();
    this.crackMaterial = new THREE.MeshBasicMaterial({
      map: this.crackTex,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    this.crackMesh = new THREE.Mesh(new THREE.BoxGeometry(1.001, 1.001, 1.001), this.crackMaterial);
    this.crackMesh.visible = false;
    this.scene.add(this.crackMesh);

    // Mining state and dropped item entities
    this.miningTarget = null;     // {x,y,z}
    this.miningProgress = 0;      // seconds spent mining current target
    this.drops = [];              // floating block items
    this.blockGeomCache = new Map();

    // Mobs
    this.mobs = [];
    this.maxPigs = 12;
    this.maxZombies = 8;
    this.maxCows = 8;
    this.maxSheep = 10;
    this.maxChickens = 10;
    this.maxSkeletons = 6;
    this.maxCreepers = 6;

    // Health & gamemode
    this.gameMode = 'survival';   // 'survival' | 'creative'
    this.maxHealth = 20;          // 20 HP = 10 hearts (each heart = 2 HP)
    this.health = this.maxHealth;
    this.invulnTimer = 0;         // seconds remaining of damage immunity
    this.spawnPos = new THREE.Vector3();

    this.keys = {};
    this.mouse = { left: false, right: false };
    this.selectedBlock = BLOCK.GRASS;
    this.placeCooldown = 0;
    this.breakCooldown = 0;

    this.chunkLoadQueue = [];
    this.chunkMeshQueue = [];

    this.setupInput();
    this.setupHUD();
    this.spawnPlayer();

    this.lastTime = performance.now();
    this.frameCount = 0;
    this.fpsTime = this.lastTime;
    this.animate = this.animate.bind(this);
    requestAnimationFrame(this.animate);
  }

  setupHUD() {
    const NUM_HOTBAR = 9;
    const NUM_MAIN = 27;

    // Precompute block icons (canvas elements) for every placeable block
    this.creativeBlocks = [BLOCK.GRASS, BLOCK.DIRT, BLOCK.STONE, BLOCK.SAND,
                           BLOCK.WOOD, BLOCK.LEAVES, BLOCK.SNOW, BLOCK.ICE,
                           BLOCK.COBBLE, BLOCK.BRICK, BLOCK.PLANKS];
    this.blockIcons = {};
    for (const b of this.creativeBlocks) {
      this.blockIcons[b] = makeBlockIcon(this.atlasCanvas, b, 44);
    }

    // Inventory model: separate hotbar (9) and main (27).
    this.inventory = new Array(NUM_HOTBAR).fill(null);
    this.mainInventory = new Array(NUM_MAIN).fill(null);
    this.selectedSlot = 0;
    if (this.gameMode === 'creative') this.fillCreativeInventory();

    // Hotbar DOM
    const bar = document.getElementById('blockbar');
    bar.innerHTML = '';
    bar.style.pointerEvents = 'auto';
    this.hotbarEls = [];
    for (let i = 0; i < NUM_HOTBAR; i++) {
      const el = this._buildSlotElement('hot', i);
      bar.appendChild(el);
      this.hotbarEls.push(el);
    }

    // Inventory window DOM
    const invMain = document.getElementById('inv-main');
    const invHot = document.getElementById('inv-hot');
    invMain.innerHTML = ''; invHot.innerHTML = '';
    this.invMainEls = [];
    this.invHotEls = [];
    for (let i = 0; i < NUM_MAIN; i++) {
      const el = this._buildSlotElement('main', i);
      invMain.appendChild(el);
      this.invMainEls.push(el);
    }
    for (let i = 0; i < NUM_HOTBAR; i++) {
      const el = this._buildSlotElement('invhot', i);
      invHot.appendChild(el);
      this.invHotEls.push(el);
    }

    this.invOpen = false;
    this.invScreen = document.getElementById('inventory-screen');
    this.dragGhost = document.getElementById('drag-ghost');
    this.tooltipEl = document.getElementById('tooltip');
    this.heldItem = null; // {block, count} held by cursor while inventory open

    // Mouse tracking for ghost/tooltip
    document.addEventListener('mousemove', (e) => {
      if (this.dragGhost.style.display === 'block') {
        this.dragGhost.style.left = (e.clientX - 22) + 'px';
        this.dragGhost.style.top = (e.clientY - 22) + 'px';
      }
      if (this.tooltipEl.style.display === 'block') {
        this.tooltipEl.style.left = (e.clientX + 14) + 'px';
        this.tooltipEl.style.top = (e.clientY + 14) + 'px';
      }
    });

    this.refreshAllSlots();

    // Hearts
    this.heartsContainer = document.getElementById('hearts');
    this.heartsCanvas = document.getElementById('hearts-canvas');
    this.heartsCtx = this.heartsCanvas.getContext('2d');
    this.heartsCtx.imageSmoothingEnabled = false;
    this.modeEl = document.getElementById('mode');
    this.drawHearts();
    this.updateModeUI();
  }

  _buildSlotElement(kind, idx) {
    const el = document.createElement('div');
    el.className = 'slot';
    el.dataset.kind = kind;
    el.dataset.idx = idx;
    const icon = document.createElement('canvas');
    icon.width = 44; icon.height = 44;
    el.appendChild(icon);
    const cnt = document.createElement('div');
    cnt.className = 'count';
    el.appendChild(cnt);

    if (kind !== 'hot') {
      // Inventory window slots are clickable
      el.addEventListener('mousedown', (e) => this.onInventoryClick(e, kind, idx));
      el.addEventListener('mouseenter', () => this.showSlotTooltip(kind, idx));
      el.addEventListener('mouseleave', () => this.hideTooltip());
    }
    return el;
  }

  _slotRef(kind, idx) {
    if (kind === 'main') return this.mainInventory;
    return this.inventory; // 'hot' or 'invhot'
  }

  _renderSlotEl(el, slot, isActive) {
    const icon = el.firstChild;
    const cnt = el.lastChild;
    const ctx = icon.getContext('2d');
    ctx.clearRect(0, 0, 44, 44);
    if (slot && this.blockIcons[slot.block]) {
      ctx.drawImage(this.blockIcons[slot.block], 0, 0);
      cnt.textContent = (slot.count === Infinity) ? '∞' : (slot.count > 1 ? slot.count : '');
    } else {
      cnt.textContent = '';
    }
    el.classList.toggle('active', !!isActive);
  }

  refreshHotbar() {
    if (!this.hotbarEls) return;
    for (let i = 0; i < this.hotbarEls.length; i++) {
      this._renderSlotEl(this.hotbarEls[i], this.inventory[i], i === this.selectedSlot);
    }
  }

  refreshAllSlots() {
    this.refreshHotbar();
    if (this.invHotEls) {
      for (let i = 0; i < this.invHotEls.length; i++) {
        this._renderSlotEl(this.invHotEls[i], this.inventory[i], false);
      }
    }
    if (this.invMainEls) {
      for (let i = 0; i < this.invMainEls.length; i++) {
        this._renderSlotEl(this.invMainEls[i], this.mainInventory[i], false);
      }
    }
    this.refreshHeldGhost();
  }

  refreshHeldGhost() {
    if (!this.heldItem) {
      this.dragGhost.style.display = 'none';
      this.dragGhost.innerHTML = '';
      return;
    }
    this.dragGhost.innerHTML = '';
    const icon = document.createElement('canvas');
    icon.width = 44; icon.height = 44;
    icon.getContext('2d').drawImage(this.blockIcons[this.heldItem.block], 0, 0);
    const cnt = document.createElement('div');
    cnt.className = 'count';
    cnt.textContent = (this.heldItem.count === Infinity) ? '∞'
                    : (this.heldItem.count > 1 ? this.heldItem.count : '');
    this.dragGhost.appendChild(icon);
    this.dragGhost.appendChild(cnt);
    this.dragGhost.style.display = 'block';
  }

  showSlotTooltip(kind, idx) {
    const arr = this._slotRef(kind, idx);
    const slot = arr[idx];
    if (!slot) { this.hideTooltip(); return; }
    this.tooltipEl.textContent = BLOCK_NAMES[slot.block];
    this.tooltipEl.style.display = 'block';
  }
  hideTooltip() { this.tooltipEl.style.display = 'none'; }

  openInventory() {
    if (this.invOpen) return;
    this.invOpen = true;
    this.invScreen.classList.add('open');
    if (document.pointerLockElement) document.exitPointerLock();
    this.refreshAllSlots();
  }

  closeInventory() {
    if (!this.invOpen) return;
    this.invOpen = false;
    this.invScreen.classList.remove('open');
    this.hideTooltip();
    if (this.heldItem) {
      this.addToInventory(this.heldItem.block,
        this.heldItem.count === Infinity ? 1 : this.heldItem.count);
      this.heldItem = null;
      this.refreshHeldGhost();
    }
    this.refreshAllSlots();
    // Re-acquire pointer lock to resume gameplay
    this.renderer.domElement.requestPointerLock();
  }

  toggleInventory() {
    if (this.invOpen) this.closeInventory(); else this.openInventory();
  }

  // Click handler for inventory window slots (drag-and-drop / shift-click)
  onInventoryClick(e, kind, idx) {
    e.preventDefault();
    const arr = this._slotRef(kind, idx);
    const slot = arr[idx];

    // Shift-click: quick move between hotbar and main
    if (e.shiftKey) {
      if (!slot) return;
      const sourceIsHot = (kind === 'invhot');
      const target = sourceIsHot ? this.mainInventory : this.inventory;
      const moved = this._tryStackInto(target, slot);
      if (moved) {
        if (slot.count === Infinity || slot.count <= 0) {
          if (slot.count <= 0) arr[idx] = null;
        }
        this.refreshAllSlots();
      }
      return;
    }

    if (e.button === 2) {
      // Right click: split stack / place one
      if (this.heldItem) {
        // Place one from held stack into this slot
        if (!slot) {
          arr[idx] = { block: this.heldItem.block, count: 1 };
          if (this.heldItem.count !== Infinity) this.heldItem.count -= 1;
          if (this.heldItem.count <= 0) this.heldItem = null;
        } else if (slot.block === this.heldItem.block && slot.count < 64) {
          slot.count += 1;
          if (this.heldItem.count !== Infinity) this.heldItem.count -= 1;
          if (this.heldItem.count <= 0) this.heldItem = null;
        }
      } else if (slot) {
        // Pick up half of stack
        if (slot.count === Infinity) {
          this.heldItem = { block: slot.block, count: Infinity };
        } else {
          const half = Math.ceil(slot.count / 2);
          this.heldItem = { block: slot.block, count: half };
          slot.count -= half;
          if (slot.count <= 0) arr[idx] = null;
        }
      }
      this.refreshAllSlots();
      return;
    }

    // Left click: pick up / place / swap
    if (this.heldItem) {
      if (!slot) {
        arr[idx] = this.heldItem;
        this.heldItem = null;
      } else if (slot.block === this.heldItem.block) {
        if (slot.count === Infinity || this.heldItem.count === Infinity) {
          // Creative: nothing to merge meaningfully
          this.heldItem = null;
        } else {
          const room = 64 - slot.count;
          const move = Math.min(room, this.heldItem.count);
          slot.count += move;
          this.heldItem.count -= move;
          if (this.heldItem.count <= 0) this.heldItem = null;
        }
      } else {
        // Swap
        arr[idx] = this.heldItem;
        this.heldItem = slot;
      }
    } else if (slot) {
      this.heldItem = slot;
      arr[idx] = null;
    }
    this.refreshAllSlots();
  }

  _tryStackInto(targetArr, srcSlot) {
    // Stack into existing matching slots first
    const isInf = srcSlot.count === Infinity;
    if (!isInf) {
      for (const t of targetArr) {
        if (t && t.block === srcSlot.block && t.count < 64) {
          const room = 64 - t.count;
          const move = Math.min(room, srcSlot.count);
          t.count += move;
          srcSlot.count -= move;
          if (srcSlot.count <= 0) return true;
        }
      }
    }
    // Then first empty
    for (let i = 0; i < targetArr.length; i++) {
      if (!targetArr[i]) {
        if (isInf) {
          targetArr[i] = { block: srcSlot.block, count: 1 };
          // Don't drain creative source
          return true;
        }
        const move = Math.min(64, srcSlot.count);
        targetArr[i] = { block: srcSlot.block, count: move };
        srcSlot.count -= move;
        if (srcSlot.count <= 0) return true;
      }
    }
    return srcSlot.count <= 0;
  }

  fillCreativeInventory() {
    // Hotbar: first 9 placeable blocks
    for (let i = 0; i < this.inventory.length; i++) {
      this.inventory[i] = i < this.creativeBlocks.length
        ? { block: this.creativeBlocks[i], count: Infinity } : null;
    }
    // Main inventory: any remaining placeable blocks at the top, rest empty
    for (let i = 0; i < this.mainInventory.length; i++) {
      const j = i + this.inventory.length;
      this.mainInventory[i] = j < this.creativeBlocks.length
        ? { block: this.creativeBlocks[j], count: Infinity } : null;
    }
  }

  setSelected(idx) {
    if (idx < 0 || idx >= this.hotbarEls.length) return;
    this.selectedSlot = idx;
    this.refreshHotbar();
  }

  // Add picked-up block to inventory: hotbar first, then main. Returns true if stored.
  addToInventory(block, count = 1) {
    if (this.gameMode === 'creative') return true;
    let remaining = count;
    const tryArr = (arr) => {
      // Stack onto existing slots
      for (const s of arr) {
        if (s && s.block === block && s.count < 64) {
          const room = 64 - s.count;
          const add = Math.min(room, remaining);
          s.count += add;
          remaining -= add;
          if (remaining <= 0) return;
        }
      }
      // Empty slots
      for (let i = 0; i < arr.length; i++) {
        if (!arr[i]) {
          const add = Math.min(64, remaining);
          arr[i] = { block, count: add };
          remaining -= add;
          if (remaining <= 0) return;
        }
      }
    };
    tryArr(this.inventory);
    if (remaining > 0) tryArr(this.mainInventory);
    this.refreshAllSlots();
    return remaining < count;
  }

  selectedBlockType() {
    const s = this.inventory[this.selectedSlot];
    return s && s.count > 0 ? s.block : null;
  }

  consumeSelected() {
    const s = this.inventory[this.selectedSlot];
    if (!s) return false;
    if (this.gameMode === 'creative') return true;
    if (s.count <= 0) return false;
    s.count -= 1;
    if (s.count <= 0) this.inventory[this.selectedSlot] = null;
    this.refreshHotbar();
    if (this.invOpen) this.refreshAllSlots();
    return true;
  }

  // Pixel-art heart (7x6 cells), drawn at scale 2 → 14x12 px per heart with 2 px gap
  drawHearts() {
    const ctx = this.heartsCtx;
    const W = this.heartsCanvas.width;
    const H = this.heartsCanvas.height;
    ctx.clearRect(0, 0, W, H);
    if (this.gameMode !== 'survival') return;
    const PATTERN = [
      '.##.##.',
      '#######',
      '#######',
      '.#####.',
      '..###..',
      '...#...',
    ];
    const SCALE = 2;
    const HEART_W = PATTERN[0].length * SCALE; // 14
    const HEART_H = PATTERN.length * SCALE;    // 12
    const GAP = 2;
    const TOTAL = 10;
    const startX = (W - (HEART_W * TOTAL + GAP * (TOTAL - 1))) / 2;

    for (let i = 0; i < TOTAL; i++) {
      const ox = startX + i * (HEART_W + GAP);
      const oy = (H - HEART_H) / 2;
      // Empty heart background
      this._stampHeart(ctx, ox, oy, SCALE, PATTERN, '#3a0a0a', 0, PATTERN[0].length);
      // Red foreground based on remaining HP (each heart = 2 HP)
      const hp = Math.max(0, this.health - i * 2);
      if (hp >= 2) {
        this._stampHeart(ctx, ox, oy, SCALE, PATTERN, '#e8202a', 0, PATTERN[0].length);
      } else if (hp === 1) {
        // Half heart: only fill left half
        this._stampHeart(ctx, ox, oy, SCALE, PATTERN, '#e8202a', 0, Math.ceil(PATTERN[0].length / 2));
      }
    }
  }

  _stampHeart(ctx, ox, oy, scale, pattern, color, colStart, colEnd) {
    ctx.fillStyle = color;
    for (let r = 0; r < pattern.length; r++) {
      for (let c = colStart; c < colEnd; c++) {
        if (pattern[r][c] === '#') {
          ctx.fillRect(ox + c * scale, oy + r * scale, scale, scale);
        }
      }
    }
  }

  updateModeUI() {
    if (this.modeEl) this.modeEl.textContent = this.gameMode === 'survival' ? 'Survival' : 'Creative';
    if (this.heartsContainer) this.heartsContainer.classList.toggle('hidden', this.gameMode !== 'survival');
  }

  setSeed(n) {
    WORLD_SEED = (n | 0);
    try {
      const url = new URL(location.href);
      url.searchParams.set('seed', String(WORLD_SEED));
      history.replaceState(null, '', url.toString());
    } catch (_) {}
    this.reloadWorld();
    return WORLD_SEED;
  }

  newSeed() {
    return this.setSeed((Math.random() * 0x7fffffff) | 0);
  }

  reloadWorld() {
    // Remove all chunk meshes & free their geometry
    for (const c of this.world.chunks.values()) {
      if (c.mesh) {
        this.scene.remove(c.mesh);
        c.mesh.geometry.dispose();
        c.mesh = null;
      }
      if (c.waterMesh) {
        this.scene.remove(c.waterMesh);
        c.waterMesh.geometry.dispose();
        c.waterMesh = null;
      }
    }
    this.world.chunks.clear();

    // Despawn all mobs
    for (const m of this.mobs) m.destroy();
    this.mobs.length = 0;

    // Despawn all dropped items
    for (const d of this.drops) this.scene.remove(d.mesh);
    this.drops.length = 0;

    // Clear mining/selection state
    this.miningTarget = null;
    this.miningProgress = 0;
    this.crackMesh.visible = false;
    this.crackMaterial.opacity = 0;
    this.selection.visible = false;

    // Reset health
    this.health = this.maxHealth;
    this.invulnTimer = 0;
    this.drawHearts();

    // Reset inventory
    this.heldItem = null;
    if (this.gameMode === 'creative') {
      this.fillCreativeInventory();
    } else {
      this.inventory.fill(null);
      this.mainInventory.fill(null);
    }
    this.selectedSlot = 0;
    this.refreshAllSlots();

    // Regenerate spawn region & respawn player
    this.spawnPlayer();
    this.player.velocity.set(0, 0, 0);
  }

  toggleGameMode() {
    this.gameMode = this.gameMode === 'survival' ? 'creative' : 'survival';
    this.health = this.maxHealth;
    this.invulnTimer = 0;
    this.player.flying = (this.gameMode === 'creative');
    this.player.velocity.y = 0;
    this.heldItem = null;
    if (this.gameMode === 'creative') {
      this.fillCreativeInventory();
    } else {
      this.inventory.fill(null);
      this.mainInventory.fill(null);
    }
    this.refreshAllSlots();
    this.updateModeUI();
    this.drawHearts();
  }

  takeDamage(amount) {
    if (this.gameMode !== 'survival') return;
    if (this.invulnTimer > 0) return;
    this.health = Math.max(0, this.health - amount);
    this.invulnTimer = 0.5;
    this.drawHearts();
    // Brief red overlay flash via CSS background pulse on body
    document.body.style.boxShadow = 'inset 0 0 80px 30px rgba(255,0,0,0.35)';
    setTimeout(() => { document.body.style.boxShadow = ''; }, 180);
    if (this.health <= 0) this.die();
  }

  die() {
    // Respawn: full HP at the original spawn surface
    this.health = this.maxHealth;
    this.invulnTimer = 1.0;
    const h = terrainHeight(0, 0);
    this.player.position.set(0.5, h + 2, 0.5);
    this.player.velocity.set(0, 0, 0);
    this.drawHearts();
  }

  setSelectedDeprecated_unused_() {}

  spawnPlayer() {
    // Generate a small region around origin first to find spawn height
    for (let cz = -1; cz <= 1; cz++) {
      for (let cx = -1; cx <= 1; cx++) {
        const c = this.world.ensureChunk(cx, cz);
        generateChunk(c);
      }
    }
    const h = terrainHeight(0, 0);
    this.player.position.set(0.5, h + 2, 0.5);

    // Seed assorted passive mobs near spawn so the world feels alive immediately
    const seedTypes = ['pig', 'cow', 'sheep', 'chicken'];
    for (let i = 0; i < 6; i++) {
      const wx = ((Math.random() * 24) | 0) - 12;
      const wz = ((Math.random() * 24) | 0) - 12;
      const sy = this.surfaceY(wx, wz);
      if (sy >= 0) {
        const type = seedTypes[(Math.random() * seedTypes.length) | 0];
        this.mobs.push(new Mob(this.scene, this.world, wx + 0.5, sy + 1, wz + 0.5, type));
      }
    }
  }

  setupInput() {
    const overlay = document.getElementById('overlay');
    overlay.addEventListener('click', () => {
      if (this.invOpen) return;
      this.renderer.domElement.requestPointerLock();
    });
    document.addEventListener('pointerlockchange', () => {
      const locked = document.pointerLockElement === this.renderer.domElement;
      // When inventory is open, keep overlay hidden so user can interact with inventory UI
      if (this.invOpen) {
        overlay.classList.add('hidden');
      } else {
        overlay.classList.toggle('hidden', locked);
      }
    });
    document.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement !== this.renderer.domElement) return;
      const sens = 0.0025;
      this.player.yaw   -= e.movementX * sens;
      this.player.pitch -= e.movementY * sens;
      const lim = Math.PI / 2 - 0.001;
      if (this.player.pitch > lim) this.player.pitch = lim;
      if (this.player.pitch < -lim) this.player.pitch = -lim;
    });
    document.addEventListener('keydown', (e) => {
      // Inventory key works always, even when inventory is open (toggles closed)
      if (e.code === 'KeyE') {
        e.preventDefault();
        this.toggleInventory();
        return;
      }
      if (e.code === 'Escape' && this.invOpen) {
        this.closeInventory();
        return;
      }
      // Other gameplay keys are suppressed while inventory is open
      if (this.invOpen) return;
      this.keys[e.code] = true;
      if (e.code.startsWith('Digit')) {
        const n = parseInt(e.code.slice(5)) - 1;
        this.setSelected(n);
      }
      if (e.code === 'KeyF') {
        this.player.flying = !this.player.flying;
        this.player.velocity.y = 0;
      }
      if (e.code === 'KeyG') this.toggleGameMode();
      if (e.code === 'KeyR') this.reloadWorld();
      if (e.code === 'KeyN') this.newSeed();
    });
    document.addEventListener('keyup', (e) => { this.keys[e.code] = false; });
    document.addEventListener('mousedown', (e) => {
      if (document.pointerLockElement !== this.renderer.domElement) return;
      if (e.button === 0) this.mouse.left = true;
      if (e.button === 2) this.mouse.right = true;
    });
    document.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouse.left = false;
      if (e.button === 2) this.mouse.right = false;
    });
    document.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('wheel', (e) => {
      if (this.invOpen) return;
      if (document.pointerLockElement !== this.renderer.domElement) return;
      const dir = Math.sign(e.deltaY);
      let next = this.selectedSlot + dir;
      const N = this.hotbarEls.length;
      if (next < 0) next = N - 1;
      if (next >= N) next = 0;
      this.setSelected(next);
    }, { passive: true });
    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    });

    this.setupTouchControls();
  }

  // Touch / mobile controls. We map gestures to the same keys/mouse state
  // updatePlayer/updateInteraction already consume — so no other code paths
  // change.
  setupTouchControls() {
    // Only enable on devices whose primary pointer is coarse (i.e. real touch
    // devices). Desktops with touchscreens have `navigator.maxTouchPoints > 0`
    // but `(pointer: fine)`, so this avoids breaking mouse + pointer-lock on
    // those machines.
    const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    const noHover = window.matchMedia && window.matchMedia('(hover: none)').matches;
    const isTouch = coarse && noHover;
    if (!isTouch) return;
    document.body.classList.add('touch');

    // Disable pointer-lock click on overlay; we control input via touch.
    const overlay = document.getElementById('overlay');
    if (overlay) overlay.classList.add('hidden');

    // ----- Movement joystick -----
    const stick = document.getElementById('tc-stick');
    const knob  = document.getElementById('tc-stick-knob');
    let stickId = null, stickCx = 0, stickCy = 0;
    const STICK_R = 50;
    const setMoveKeys = (dx, dy) => {
      // dy is screen-down positive; forward (W) corresponds to dy<0.
      const dead = 0.25;
      this.keys['KeyW'] = dy < -dead;
      this.keys['KeyS'] = dy >  dead;
      this.keys['KeyA'] = dx < -dead;
      this.keys['KeyD'] = dx >  dead;
      // Sprint when pushed near the edge
      const mag = Math.hypot(dx, dy);
      this.keys['ShiftLeft'] = mag > 0.85;
    };
    const clearMoveKeys = () => {
      this.keys['KeyW'] = this.keys['KeyA'] = this.keys['KeyS'] = this.keys['KeyD'] = false;
      this.keys['ShiftLeft'] = false;
    };
    stick.addEventListener('touchstart', (e) => {
      e.preventDefault();
      const t = e.changedTouches[0];
      stickId = t.identifier;
      const r = stick.getBoundingClientRect();
      stickCx = r.left + r.width / 2;
      stickCy = r.top + r.height / 2;
      knob.style.transform = 'translate(0,0)';
    }, { passive: false });
    stick.addEventListener('touchmove', (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier !== stickId) continue;
        e.preventDefault();
        let dx = t.clientX - stickCx;
        let dy = t.clientY - stickCy;
        const mag = Math.hypot(dx, dy);
        if (mag > STICK_R) { dx = dx / mag * STICK_R; dy = dy / mag * STICK_R; }
        knob.style.transform = `translate(${dx}px, ${dy}px)`;
        setMoveKeys(dx / STICK_R, dy / STICK_R);
        return;
      }
    }, { passive: false });
    const stickEnd = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier !== stickId) continue;
        stickId = null;
        knob.style.transform = 'translate(0,0)';
        clearMoveKeys();
      }
    };
    stick.addEventListener('touchend', stickEnd);
    stick.addEventListener('touchcancel', stickEnd);

    // ----- Look pane (right half) — drag to rotate camera, tap to break -----
    const look = document.getElementById('tc-look');
    let lookId = null, lookLastX = 0, lookLastY = 0, lookStartT = 0, lookMoved = 0;
    const LOOK_SENS = 0.005;
    look.addEventListener('touchstart', (e) => {
      if (lookId !== null) return;
      const t = e.changedTouches[0];
      lookId = t.identifier;
      lookLastX = t.clientX;
      lookLastY = t.clientY;
      lookStartT = performance.now();
      lookMoved = 0;
      e.preventDefault();
    }, { passive: false });
    look.addEventListener('touchmove', (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier !== lookId) continue;
        const dx = t.clientX - lookLastX;
        const dy = t.clientY - lookLastY;
        lookLastX = t.clientX; lookLastY = t.clientY;
        lookMoved += Math.abs(dx) + Math.abs(dy);
        this.player.yaw   -= dx * LOOK_SENS;
        this.player.pitch -= dy * LOOK_SENS;
        const lim = Math.PI / 2 - 0.001;
        if (this.player.pitch >  lim) this.player.pitch =  lim;
        if (this.player.pitch < -lim) this.player.pitch = -lim;
        e.preventDefault();
        return;
      }
    }, { passive: false });
    const lookEnd = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier !== lookId) continue;
        const dt = performance.now() - lookStartT;
        // Tap (short, low movement) → quick break pulse so tapping a block destroys it.
        if (dt < 250 && lookMoved < 8) {
          this.mouse.left = true;
          setTimeout(() => { this.mouse.left = false; }, 50);
        }
        lookId = null;
      }
    };
    look.addEventListener('touchend', lookEnd);
    look.addEventListener('touchcancel', lookEnd);

    // ----- Buttons -----
    const holdBtn = (id, set) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('touchstart', (e) => { e.preventDefault(); el.classList.add('active'); set(true);  }, { passive: false });
      const off = (e) => { el.classList.remove('active'); set(false); };
      el.addEventListener('touchend', off);
      el.addEventListener('touchcancel', off);
    };
    holdBtn('tc-break', (v) => { this.mouse.left  = v; });
    holdBtn('tc-place', (v) => { this.mouse.right = v; });
    holdBtn('tc-jump',  (v) => { this.keys['Space'] = v; });

    // Tap-toggle buttons
    const tapBtn = (id, fn) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('touchstart', (e) => {
        e.preventDefault();
        el.classList.add('active');
        fn();
        setTimeout(() => el.classList.remove('active'), 120);
      }, { passive: false });
    };
    tapBtn('tc-fly', () => {
      this.player.flying = !this.player.flying;
      this.player.velocity.y = 0;
    });
    tapBtn('tc-inv', () => this.toggleInventory());

    // Stop touchmove on body from scrolling the page
    document.body.addEventListener('touchmove', (e) => {
      if (e.target.closest('#inventory-screen')) return;
      e.preventDefault();
    }, { passive: false });
  }

  updateChunks() {
    const pcx = Math.floor(this.player.position.x / CHUNK_SIZE);
    const pcz = Math.floor(this.player.position.z / CHUNK_SIZE);
    const r = RENDER_DISTANCE;

    // Queue chunks to load (closest first). Generate one extra ring beyond
    // render distance so boundary chunks have neighbors for mesh culling.
    const needed = [];
    const genR = r + 1;
    for (let dz = -genR; dz <= genR; dz++) {
      for (let dx = -genR; dx <= genR; dx++) {
        const cx = pcx + dx, cz = pcz + dz;
        const dist = dx * dx + dz * dz;
        if (dist > genR * genR) continue;
        const c = this.world.getChunk(cx, cz);
        if (!c || !c.generated) needed.push({ cx, cz, dist });
      }
    }
    needed.sort((a, b) => a.dist - b.dist);
    // Generate up to N per frame to avoid stalls
    const genBudget = 4;
    for (let i = 0; i < Math.min(genBudget, needed.length); i++) {
      const { cx, cz } = needed[i];
      const c = this.world.ensureChunk(cx, cz);
      if (!c.generated) {
        generateChunk(c);
        // Mark neighbors dirty so their boundary faces re-cull correctly
        for (const [dx, dz] of [[1,0],[-1,0],[0,1],[0,-1]]) {
          const n = this.world.getChunk(cx + dx, cz + dz);
          if (n && n.generated) n.dirty = true;
        }
        // Chance to spawn passive mobs in newly-generated chunks
        this.tryChunkSpawn(c);
      }
    }

    // Build/refresh meshes for dirty chunks within range, but only when all
    // 4 horizontal neighbors are generated to avoid visible chunk-boundary walls.
    let meshBudget = 4;
    const dirtyList = [];
    for (const c of this.world.chunks.values()) {
      const d = (c.cx - pcx) ** 2 + (c.cz - pcz) ** 2;
      if (d > r * r) continue;
      if (!c.generated || !c.dirty) continue;
      const nbrsReady =
        this.world.getChunk(c.cx + 1, c.cz)?.generated &&
        this.world.getChunk(c.cx - 1, c.cz)?.generated &&
        this.world.getChunk(c.cx, c.cz + 1)?.generated &&
        this.world.getChunk(c.cx, c.cz - 1)?.generated;
      if (!nbrsReady) continue;
      dirtyList.push({ c, d });
    }
    dirtyList.sort((a, b) => a.d - b.d);
    for (const { c } of dirtyList) {
      if (meshBudget-- <= 0) break;
      const mesh = buildChunkMesh(this.world, c, this.material, 'opaque');
      if (mesh && !mesh.parent) this.scene.add(mesh);
      const wmesh = buildChunkMesh(this.world, c, this.waterMaterial, 'water');
      if (wmesh && !wmesh.parent) this.scene.add(wmesh);
      c.dirty = false;
    }

    // Unload distant chunks (slightly larger radius to avoid thrash)
    const unloadR = (genR + 2) * (genR + 2);
    for (const [key, c] of this.world.chunks) {
      const d = (c.cx - pcx) ** 2 + (c.cz - pcz) ** 2;
      if (d > unloadR) {
        if (c.mesh) {
          this.scene.remove(c.mesh);
          c.mesh.geometry.dispose();
          c.mesh = null;
        }
        if (c.waterMesh) {
          this.scene.remove(c.waterMesh);
          c.waterMesh.geometry.dispose();
          c.waterMesh = null;
        }
        this.world.chunks.delete(key);
      }
    }
  }

  updatePlayer(dt) {
    const p = this.player;
    // Detect if the player's body is intersecting any water voxel.
    const inWater = this._playerInWater();
    p.inWater = inWater;
    const baseSpeed = (this.keys['ShiftLeft'] || this.keys['ShiftRight']) ? 7.5 : 4.5;
    const speed = inWater ? baseSpeed * 0.55 : baseSpeed;
    const fwdX = -Math.sin(p.yaw);
    const fwdZ = -Math.cos(p.yaw);
    const rightX = Math.cos(p.yaw);
    const rightZ = -Math.sin(p.yaw);
    let mx = 0, mz = 0;
    if (this.keys['KeyW']) { mx += fwdX; mz += fwdZ; }
    if (this.keys['KeyS']) { mx -= fwdX; mz -= fwdZ; }
    if (this.keys['KeyA']) { mx -= rightX; mz -= rightZ; }
    if (this.keys['KeyD']) { mx += rightX; mz += rightZ; }
    const len = Math.hypot(mx, mz);
    if (len > 0) { mx /= len; mz /= len; }

    if (p.flying) {
      p.velocity.x = mx * speed * 1.6;
      p.velocity.z = mz * speed * 1.6;
      p.velocity.y = 0;
      if (this.keys['Space']) p.velocity.y = speed * 1.4;
      if (this.keys['ShiftLeft'] || this.keys['ControlLeft']) p.velocity.y = -speed * 1.4;
    } else if (inWater) {
      // Swim: dampened gravity, hold Space to swim up.
      p.velocity.x = mx * speed;
      p.velocity.z = mz * speed;
      p.velocity.y -= 7 * dt;          // gentle sinking
      p.velocity.y *= 0.86;            // strong drag
      if (this.keys['Space']) p.velocity.y = 4.2;
      if (p.velocity.y < -3) p.velocity.y = -3;
    } else {
      p.velocity.x = mx * speed;
      p.velocity.z = mz * speed;
      p.velocity.y -= 28 * dt;
      if (p.velocity.y < -55) p.velocity.y = -55;
      if (this.keys['Space'] && p.onGround) {
        p.velocity.y = 9.2;
        p.onGround = false;
      }
    }

    // Integrate with axis-separated collision; substep so high velocities can't tunnel.
    const prevVy = p.velocity.y;
    // Track fall distance (only while genuinely falling, not flying or in water).
    if (p.flying || inWater || p.onGround) {
      // Do nothing here; we'll either reset (water/onGround) below, or hold steady (flying).
    } else if (p.velocity.y < 0) {
      p.fallDistance += -p.velocity.y * dt;
    }
    if (inWater) p.fallDistance = 0;

    const fullVel = new THREE.Vector3(p.velocity.x * dt, p.velocity.y * dt, p.velocity.z * dt);
    const maxStep = 0.35; // < 1 block; safe vs tunneling
    const maxComp = Math.max(Math.abs(fullVel.x), Math.abs(fullVel.y), Math.abs(fullVel.z));
    const subSteps = Math.max(1, Math.ceil(maxComp / maxStep));
    const stepVel = new THREE.Vector3(fullVel.x / subSteps, fullVel.y / subSteps, fullVel.z / subSteps);
    let landedThisFrame = false;
    let hitYAny = false;
    for (let s = 0; s < subSteps; s++) {
      const sx = stepVel.x, sy = stepVel.y, sz = stepVel.z;
      const ax = new THREE.Vector3(sx, 0, 0);
      const ay = new THREE.Vector3(0, sy, 0);
      const az = new THREE.Vector3(0, 0, sz);
      collideAxis(this.world, p.position, ax, 'x');
      const hitY = collideAxis(this.world, p.position, ay, 'y');
      collideAxis(this.world, p.position, az, 'z');
      if (hitY) {
        hitYAny = true;
        if (sy < 0) landedThisFrame = true;
        // Stop further Y travel this frame
        stepVel.y = 0;
      }
    }
    // Safety: if we somehow ended up inside a block (e.g. spawn or chunk pop-in), push up.
    this._unstickPlayer();
    if (hitYAny) {
      if (landedThisFrame) p.onGround = true;
      p.velocity.y = 0;
      // Minecraft-style fall damage: dmg = max(0, fallDistance - 3).
      // Skipped if landing in/under water, flying, or in creative.
      if (landedThisFrame && this.gameMode === 'survival' && !p.flying && !inWater) {
        const dmg = Math.floor(p.fallDistance - 3);
        if (dmg > 0) this.takeDamage(dmg);
      }
      if (landedThisFrame) p.fallDistance = 0;
    } else {
      p.onGround = false;
    }

    p.applyCameraRotation();
  }

  // Returns true if any voxel intersecting the player's AABB is water.
  _playerInWater() {
    const p = this.player;
    const r = p.radius;
    const x0 = Math.floor(p.position.x - r), x1 = Math.floor(p.position.x + r);
    const z0 = Math.floor(p.position.z - r), z1 = Math.floor(p.position.z + r);
    const y0 = Math.floor(p.position.y),     y1 = Math.floor(p.position.y + p.height);
    for (let x = x0; x <= x1; x++)
      for (let y = y0; y <= y1; y++)
        for (let z = z0; z <= z1; z++)
          if (this.world.getBlock(x, y, z) === BLOCK.WATER) return true;
    return false;
  }

  // If the player AABB intersects a solid block, push the player upward until clear.
  _unstickPlayer() {
    const p = this.player;
    const r = p.radius, h = p.height;
    const intersects = () => {
      const minX = p.position.x - r, maxX = p.position.x + r;
      const minY = p.position.y,     maxY = p.position.y + h;
      const minZ = p.position.z - r, maxZ = p.position.z + r;
      const x0 = Math.floor(minX), x1 = Math.floor(maxX);
      const y0 = Math.floor(minY), y1 = Math.floor(maxY);
      const z0 = Math.floor(minZ), z1 = Math.floor(maxZ);
      for (let x = x0; x <= x1; x++)
        for (let y = y0; y <= y1; y++)
          for (let z = z0; z <= z1; z++)
            if (this.world.isSolid(x, y, z)) return true;
      return false;
    };
    let guard = 0;
    while (intersects() && guard++ < 16) {
      p.position.y = Math.floor(p.position.y) + 1 + 1e-4;
    }
    if (guard > 0) p.velocity.y = 0;
  }

  // Find the topmost solid block at (wx, wz) within already-generated chunks.
  surfaceY(wx, wz) {
    const cx = Math.floor(wx / CHUNK_SIZE), cz = Math.floor(wz / CHUNK_SIZE);
    const c = this.world.getChunk(cx, cz);
    if (!c || !c.generated) return -1;
    const lx = wx - cx * CHUNK_SIZE, lz = wz - cz * CHUNK_SIZE;
    for (let y = CHUNK_HEIGHT - 1; y >= 0; y--) {
      if (c.blocks[blockIndex(lx, y, lz)] !== BLOCK.AIR) return y;
    }
    return -1;
  }

  countMobs(type) {
    let n = 0;
    for (const m of this.mobs) if (!m.dead && m.type === type) n++;
    return n;
  }

  tryChunkSpawn(chunk) {
    const r = Math.random();
    // Helper: find a valid surface spawn point in chunk
    const passiveGroup = (type, max, surfaceCheck) => {
      if (this.countMobs(type) >= max) return false;
      const groupSize = 1 + ((Math.random() * 3) | 0);
      const cxBase = chunk.cx * CHUNK_SIZE + 4 + ((Math.random() * 8) | 0);
      const czBase = chunk.cz * CHUNK_SIZE + 4 + ((Math.random() * 8) | 0);
      let spawned = 0;
      for (let i = 0; i < groupSize; i++) {
        const wx = cxBase + ((Math.random() * 4) | 0) - 2;
        const wz = czBase + ((Math.random() * 4) | 0) - 2;
        const sy = this.surfaceY(wx, wz);
        if (sy < 0) continue;
        const top = chunk.blocks[blockIndex(
          ((wx % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE, sy,
          ((wz % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE
        )];
        if (!surfaceCheck(top)) continue;
        this.mobs.push(new Mob(this.scene, this.world, wx + 0.5, sy + 1, wz + 0.5, type));
        spawned++;
      }
      return spawned > 0;
    };
    const hostileSpawn = (type, max) => {
      if (this.countMobs(type) >= max) return false;
      const wx = chunk.cx * CHUNK_SIZE + ((Math.random() * CHUNK_SIZE) | 0);
      const wz = chunk.cz * CHUNK_SIZE + ((Math.random() * CHUNK_SIZE) | 0);
      const sy = this.surfaceY(wx, wz);
      if (sy < 0) return false;
      const dx = wx + 0.5 - this.player.position.x;
      const dz = wz + 0.5 - this.player.position.z;
      if (dx * dx + dz * dz <= 100) return false;
      // Only spawn hostile mobs in dark areas (Minecraft rule: light <= 7).
      // Effective light = max(blockLight, skyLight - skyDim) where skyDim grows
      // at night. Use the spawn block (one above the surface) as the sample.
      const skyLight = this.computeSkyLight(wx, sy + 1, wz);
      const skyDim = Math.round((1 - this.brightness) * 11);
      const effective = Math.max(0, skyLight - skyDim);
      if (effective > 7) return false;
      this.mobs.push(new Mob(this.scene, this.world, wx + 0.5, sy + 1, wz + 0.5, type));
      return true;
    };

    const grassy = (b) => b === BLOCK.GRASS || b === BLOCK.SNOW;
    const grassOnly = (b) => b === BLOCK.GRASS;

    // Passive mobs always have a chance. Hostile mobs only roll when night/dark
    // — but when they do roll, weight is concentrated rather than wasted.
    if (r < 0.10) passiveGroup('pig', this.maxPigs, grassy);
    else if (r < 0.18) passiveGroup('cow', this.maxCows, grassOnly);
    else if (r < 0.26) passiveGroup('sheep', this.maxSheep, grassy);
    else if (r < 0.34) passiveGroup('chicken', this.maxChickens, grassy);
    else if (r < 0.65) {
      // Hostile slot: pick one of the three. hostileSpawn itself will reject
      // if the chosen tile is too bright, which is exactly what we want.
      const h = Math.random();
      if      (h < 0.40) hostileSpawn('zombie',   this.maxZombies);
      else if (h < 0.70) hostileSpawn('skeleton', this.maxSkeletons);
      else               hostileSpawn('creeper',  this.maxCreepers);
    }
  }

  updateMobs(dt) {
    const px = this.player.position.x, pz = this.player.position.z;
    const despawnSq = 96 * 96;
    for (let i = this.mobs.length - 1; i >= 0; i--) {
      const m = this.mobs[i];
      // Remove if dead from fire
      if (m._fireDeathQueued || m.hp <= 0) {
        m.destroy();
        this.mobs.splice(i, 1);
        continue;
      }
      const dx = m.pos.x - px, dz = m.pos.z - pz;
      if (dx * dx + dz * dz > despawnSq) {
        m.destroy();
        this.mobs.splice(i, 1);
        continue;
      }
      m.update(dt, this.player);

      // Zombie melee damage in survival
      if (m.type === 'zombie' && this.gameMode === 'survival') {
        const dxp = this.player.position.x - m.pos.x;
        const dzp = this.player.position.z - m.pos.z;
        const dyp = (this.player.position.y + this.player.eyeOffset * 0.5) - (m.pos.y + 1.0);
        const distSq = dxp * dxp + dyp * dyp + dzp * dzp;
        m.attackCd = (m.attackCd || 0) - dt;
        if (distSq < 1.5 * 1.5 && m.attackCd <= 0 && this.invulnTimer <= 0) {
          this.takeDamage(2); // 1 heart
          // Knockback away from zombie
          const flatDist = Math.hypot(dxp, dzp) || 1;
          this.player.velocity.x += (dxp / flatDist) * 5;
          this.player.velocity.z += (dzp / flatDist) * 5;
          this.player.velocity.y = 4.5;
          m.attackCd = 0.8;
        }
      }

      // Skeleton "shoots" the player (instant ranged hit, slow cooldown)
      if (m.type === 'skeleton' && this.gameMode === 'survival') {
        const dxp = this.player.position.x - m.pos.x;
        const dzp = this.player.position.z - m.pos.z;
        const dyp = (this.player.position.y + this.player.eyeOffset * 0.5) - (m.pos.y + 1.6);
        const distSq = dxp * dxp + dzp * dzp;
        m.shootCd = (m.shootCd || 1.5) - dt;
        if (distSq < 16 * 16 && distSq > 4 && m.shootCd <= 0 && this.invulnTimer <= 0) {
          // Line-of-sight check via voxel raycast
          const dist = Math.sqrt(distSq + dyp * dyp);
          const dir = new THREE.Vector3(dxp / dist, dyp / dist, dzp / dist);
          const origin = new THREE.Vector3(m.pos.x, m.pos.y + 1.6, m.pos.z);
          const hit = raycastVoxel(this.world, origin, dir, dist);
          if (!hit) {
            this.takeDamage(2);
            m.shootCd = 1.8;
          } else {
            m.shootCd = 0.5;
          }
        }
      }

      // Creeper explosion
      if (m._explodeQueued && !m._exploded) {
        m._exploded = true;
        this._creeperExplode(m);
        m.hp = 0;
      }
    }
  }

  // Carve out a small spherical crater & damage the player if close.
  _creeperExplode(m) {
    const cx = Math.floor(m.pos.x);
    const cy = Math.floor(m.pos.y + 0.5);
    const cz = Math.floor(m.pos.z);
    const R = 3;
    for (let dx = -R; dx <= R; dx++) {
      for (let dy = -R; dy <= R; dy++) {
        for (let dz = -R; dz <= R; dz++) {
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 > R * R) continue;
          const x = cx + dx, y = cy + dy, z = cz + dz;
          if (this.world.isSolid(x, y, z)) {
            this.world.setBlock(x, y, z, BLOCK.AIR);
          }
        }
      }
    }
    // Damage player by proximity
    if (this.gameMode === 'survival' && this.invulnTimer <= 0) {
      const px = this.player.position.x, py = this.player.position.y + 1, pz = this.player.position.z;
      const dpx = px - m.pos.x, dpy = py - m.pos.y, dpz = pz - m.pos.z;
      const d = Math.sqrt(dpx * dpx + dpy * dpy + dpz * dpz);
      if (d < 6) {
        const dmg = Math.max(1, Math.floor((6 - d) * 2.5));
        this.takeDamage(dmg);
        // Knockback
        const k = (1 - d / 6) * 12;
        const inv = 1 / Math.max(0.1, d);
        this.player.velocity.x += dpx * inv * k;
        this.player.velocity.y += Math.abs(dpy * inv) * k * 0.6 + 4;
        this.player.velocity.z += dpz * inv * k;
      }
    }
  }

  getBlockGeometry(blockType) {
    let g = this.blockGeomCache.get(blockType);
    if (!g) {
      g = makeBlockGeometry(blockType);
      this.blockGeomCache.set(blockType, g);
    }
    return g;
  }

  spawnDrop(x, y, z, blockType) {
    const geom = this.getBlockGeometry(blockType);
    const mesh = new THREE.Mesh(geom, this.material);
    mesh.scale.setScalar(0.3);
    mesh.position.set(x, y, z);
    this.scene.add(mesh);
    this.drops.push({
      pos: new THREE.Vector3(x, y, z),
      vel: new THREE.Vector3(
        (Math.random() - 0.5) * 1.5,
        2.8 + Math.random() * 0.8,
        (Math.random() - 0.5) * 1.5
      ),
      age: 0,
      blockType,
      mesh,
    });
  }

  updateDrops(dt) {
    const halfW = 0.15; // drop is 0.3 cube, half-extent
    const px = this.player.position.x;
    const py = this.player.position.y + 0.9;
    const pz = this.player.position.z;

    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i];
      d.age += dt;

      // Pickup attraction (only after a brief delay so newly-spawned items pop out first)
      if (d.age > 0.5) {
        const dx = px - d.pos.x, dy = py - d.pos.y, dz = pz - d.pos.z;
        const distSq = dx * dx + dy * dy + dz * dz;
        if (distSq < 2.25) {
          if (distSq < 0.36) {
            // Pick up: add to inventory then despawn
            this.addToInventory(d.blockType, 1);
            this.scene.remove(d.mesh);
            this.drops.splice(i, 1);
            continue;
          }
          const dist = Math.sqrt(distSq) || 1;
          const pull = 18;
          d.vel.x += (dx / dist) * pull * dt;
          d.vel.y += (dy / dist) * pull * dt;
          d.vel.z += (dz / dist) * pull * dt;
        }
      }

      // Gravity
      d.vel.y -= 22 * dt;
      if (d.vel.y < -35) d.vel.y = -35;

      // Integrate position
      d.pos.x += d.vel.x * dt;
      d.pos.y += d.vel.y * dt;
      d.pos.z += d.vel.z * dt;

      // Ground collision: if the block at the drop's foot is solid, rest on top.
      const footY = d.pos.y - halfW;
      const bx = Math.floor(d.pos.x);
      const by = Math.floor(footY);
      const bz = Math.floor(d.pos.z);
      if (this.world.isSolid(bx, by, bz)) {
        const topY = by + 1 + halfW;
        if (d.pos.y < topY) {
          d.pos.y = topY;
          if (d.vel.y < 0) d.vel.y = 0;
          // Friction
          d.vel.x *= Math.pow(0.05, dt);
          d.vel.z *= Math.pow(0.05, dt);
        }
      }

      // Snap-to-zero when nearly stopped
      if (Math.abs(d.vel.x) < 0.02) d.vel.x = 0;
      if (Math.abs(d.vel.z) < 0.02) d.vel.z = 0;

      // Visual: bob and rotate around Y
      const bob = Math.sin(d.age * 3.2) * 0.07;
      d.mesh.position.set(d.pos.x, d.pos.y + bob, d.pos.z);
      d.mesh.rotation.y = d.age * 1.8;

      // Despawn after a long time (avoid leaks)
      if (d.age > 60) {
        this.scene.remove(d.mesh);
        this.drops.splice(i, 1);
      }
    }
  }

  blockBreakTime(blockType) {
    if (this.gameMode === 'creative') return 0.05;
    switch (blockType) {
      case BLOCK.STONE: return 1.2;
      case BLOCK.WOOD:  return 0.8;
      case BLOCK.LEAVES: return 0.25;
      default: return 0.5;
    }
  }

  updateInteraction(dt) {
    // Raycast from camera
    const origin = new THREE.Vector3(
      this.player.position.x,
      this.player.position.y + this.player.eyeOffset,
      this.player.position.z
    );
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    const hit = raycastVoxel(this.world, origin, dir, 6);

    if (hit.hit) {
      this.selection.visible = true;
      this.selection.position.set(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5);
    } else {
      this.selection.visible = false;
    }

    // ----- Mining (hold left mouse) -----
    if (this.mouse.left && hit.hit) {
      const sameTarget = this.miningTarget &&
        this.miningTarget.x === hit.x &&
        this.miningTarget.y === hit.y &&
        this.miningTarget.z === hit.z;
      if (!sameTarget) {
        this.miningTarget = { x: hit.x, y: hit.y, z: hit.z };
        this.miningProgress = 0;
      }
      const block = this.world.getBlock(hit.x, hit.y, hit.z);
      const breakTime = this.blockBreakTime(block);
      this.miningProgress += dt;

      this.crackMesh.visible = true;
      this.crackMesh.position.set(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5);
      this.crackMaterial.opacity = Math.min(0.85, this.miningProgress / breakTime);

      if (this.miningProgress >= breakTime) {
        if (this.gameMode === 'survival') {
          this.spawnDrop(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5, block);
        }
        this.world.setBlock(hit.x, hit.y, hit.z, BLOCK.AIR);
        this.miningProgress = 0;
        this.miningTarget = null;
        this.crackMesh.visible = false;
        this.crackMaterial.opacity = 0;
      }
    } else {
      this.miningTarget = null;
      this.miningProgress = 0;
      this.crackMesh.visible = false;
      this.crackMaterial.opacity = 0;
    }

    // ----- Placing (right click, with cooldown) -----
    this.placeCooldown -= dt;
    if (this.mouse.right && hit.hit && this.placeCooldown <= 0 && hit.face) {
      const px = hit.x + hit.face[0];
      const py = hit.y + hit.face[1];
      const pz = hit.z + hit.face[2];
      const r = 0.3, h = 1.75;
      const minX = this.player.position.x - r, maxX = this.player.position.x + r;
      const minY = this.player.position.y,     maxY = this.player.position.y + h;
      const minZ = this.player.position.z - r, maxZ = this.player.position.z + r;
      const inside = (px + 1 > minX && px < maxX &&
                      py + 1 > minY && py < maxY &&
                      pz + 1 > minZ && pz < maxZ);
      if (!inside && this.world.getBlock(px, py, pz) === BLOCK.AIR) {
        const blockToPlace = this.selectedBlockType();
        if (blockToPlace !== null && this.consumeSelected()) {
          this.world.setBlock(px, py, pz, blockToPlace);
          this.placeCooldown = 0.2;
        }
      }
    }
  }

  updateHUD(now) {
    this.frameCount++;
    if (now - this.fpsTime > 500) {
      const fps = Math.round((this.frameCount * 1000) / (now - this.fpsTime));
      document.getElementById('fps').textContent = fps;
      this.fpsTime = now;
      this.frameCount = 0;
      const p = this.player.position;
      document.getElementById('pos').textContent =
        `${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)}`;
      document.getElementById('chunks').textContent = this.world.chunks.size;
      // Clock: dayTime 0=dawn, 0.25=noon, 0.5=dusk, 0.75=midnight
      const hours = (this.dayTime * 24 + 6) % 24;  // shift so 0 = 6am
      const hh = Math.floor(hours).toString().padStart(2, '0');
      const mm = Math.floor((hours % 1) * 60).toString().padStart(2, '0');
      const phase = this.isDay ? '☀' : (this.brightness > 0.4 ? '🌅' : '🌙');
      document.getElementById('time').textContent = `${hh}:${mm} ${phase}`;
      // Light level at player's eye position (Minecraft-style 0-15)
      const lx = Math.floor(p.x);
      const ly = Math.floor(p.y + 1.6);
      const lz = Math.floor(p.z);
      const skyLight = this.computeSkyLight(lx, ly, lz);
      const blockLight = 0; // no light-emitting blocks yet
      // Sky dimming by time of day: full day → 0, midnight → 11
      const skyDim = Math.round((1 - this.brightness) * 11);
      const effective = Math.max(blockLight, Math.max(0, skyLight - skyDim));
      document.getElementById('light').textContent =
        `${effective} (sky ${skyLight}, block ${blockLight})`;
    }
    const seedEl = document.getElementById('seed');
    if (seedEl) seedEl.textContent = String(WORLD_SEED);
  }

  updateDayNight(dt) {
    this.dayTime = (this.dayTime + dt / this.dayLength) % 1;
    // Sun height: noon=1, midnight=-1
    const sunY = Math.sin(this.dayTime * Math.PI * 2);
    // Brightness curve with smooth dawn/dusk
    let b;
    if (sunY > 0.15) b = 1.0;
    else if (sunY < -0.2) b = 0.28;
    else b = 0.28 + (sunY + 0.2) * (0.72 / 0.35);
    this.brightness = b;
    this.isDay = sunY > 0.18;

    // Sky/fog color: night → dusk near horizon → day
    const t = (sunY + 1) * 0.5; // 0..1
    if (sunY > 0.1) {
      this._tmpSky.copy(this.skyDay);
    } else if (sunY > -0.15) {
      // Dusk/dawn band
      const k = (sunY + 0.15) / 0.25; // 0 at full dusk, 1 nearing day
      this._tmpSky.copy(this.skyDusk).lerp(this.skyDay, k);
    } else {
      const k = Math.max(0, Math.min(1, (sunY + 0.5) / 0.35)); // night→dusk
      this._tmpSky.copy(this.skyNight).lerp(this.skyDusk, k);
    }
    this.scene.background.copy(this._tmpSky);
    this.scene.fog.color.copy(this._tmpSky);

    // Tint world material (multiplies into vertex colors)
    this.material.color.setRGB(b, b, b * (b > 0.6 ? 1 : 1.05)); // slight blue at night
    if (this.crackMaterial) this.crackMaterial.color.setRGB(b, b, b);

    // Tint mob materials
    const tint = { r: b, g: b, b: b * (b > 0.6 ? 1 : 1.05) };
    for (const m of this.mobs) {
      if (m.applyTint) m.applyTint(tint);
    }
  }

  // Compute sky light at (x,y,z) by BFS through air cells (max radius 15).
  // Returns 0..15 — 15 if directly exposed to sky, decreasing with distance.
  computeSkyLight(x, y, z) {
    const W = this.world;
    if (W.isSolid(x, y, z)) return 0;
    // Quick path: directly exposed straight up
    let direct = true;
    for (let yy = y + 1; yy < CHUNK_HEIGHT; yy++) {
      if (W.isSolid(x, yy, z)) { direct = false; break; }
    }
    if (direct) return 15;
    // BFS
    const key = (a, b, c) => `${a},${b},${c}`;
    const visited = new Set();
    visited.add(key(x, y, z));
    let frontier = [[x, y, z]];
    const dirs = [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
    let best = 0;
    for (let d = 1; d <= 15; d++) {
      const next = [];
      for (const [cx, cy, cz] of frontier) {
        for (const [dx, dy, dz] of dirs) {
          const nx = cx + dx, ny = cy + dy, nz = cz + dz;
          if (ny < 0 || ny >= CHUNK_HEIGHT) continue;
          const k = key(nx, ny, nz);
          if (visited.has(k)) continue;
          visited.add(k);
          if (W.isSolid(nx, ny, nz)) continue;
          // Check sky exposure
          let exposed = true;
          for (let yy = ny + 1; yy < CHUNK_HEIGHT; yy++) {
            if (W.isSolid(nx, yy, nz)) { exposed = false; break; }
          }
          if (exposed) {
            best = Math.max(best, 15 - d);
            if (best === 15) return 15;
          }
          next.push([nx, ny, nz]);
        }
      }
      if (best >= 15 - d) {
        // Can't beat current best at deeper layers
        // (each further step strictly reduces 15-d)
      }
      frontier = next;
      if (frontier.length === 0) break;
    }
    return best;
  }

  // Is mob's head exposed to sky? (no solid block above head)
  _exposedToSky(m) {
    const x = Math.floor(m.pos.x);
    const z = Math.floor(m.pos.z);
    const headY = Math.floor(m.pos.y + m.height);
    for (let y = headY + 1; y < CHUNK_HEIGHT; y++) {
      if (this.world.isSolid(x, y, z)) return false;
    }
    return true;
  }

  updateMobBurning(dt) {
    if (!this.fireTex) return;
    const FIRE_FRAMES = 4;
    const frameDur = 0.09;
    for (const m of this.mobs) {
      if (m.dead) continue;
      const shouldBurn = m.burnsInSun && this.isDay && this._exposedToSky(m);
      if (shouldBurn) {
        if (!m.onFire) {
          m.onFire = true;
          m.fireTime = 0;
          m.attachFireSprite(this.fireTex);
        }
        m.fireTime += dt;
        // Damage tick (~1 hp/sec)
        m.burnDamageAcc += dt;
        if (m.burnDamageAcc >= 0.5) {
          m.hp -= 1;
          m.burnDamageAcc -= 0.5;
        }
      } else if (m.onFire) {
        m.onFire = false;
        m.detachFireSprite();
      }

      // Animate flame sprite (cycle frames + flicker)
      if (m.fireSprite) {
        const tex = m.fireSprite.material.map;
        const frame = Math.floor((m.fireTime || 0) / frameDur) % FIRE_FRAMES;
        tex.offset.x = frame / FIRE_FRAMES;
        // Flicker intensity
        const flick = 0.85 + Math.random() * 0.3;
        m.fireSprite.material.opacity = 0.95 * flick;
      }

      // Zombie death by fire
      if (m.burnsInSun && m.hp <= 0 && !m._fireDeathQueued) {
        m._fireDeathQueued = true;
      }
    }
  }

  animate(now) {
    requestAnimationFrame(this.animate);
    const dt = Math.min(0.05, (now - this.lastTime) / 1000);
    this.lastTime = now;
    if (this.invulnTimer > 0) this.invulnTimer -= dt;

    this.updateDayNight(dt);
    this.updateChunks();
    this.updatePlayer(dt);
    this.updateInteraction(dt);
    this.updateDrops(dt);
    this.updateMobs(dt);
    this.updateMobBurning(dt);
    if (this.multiplayer) this.multiplayer.tick(dt);
    this.renderer.render(this.scene, this.camera);
    this.updateHUD(now);
  }

  // Convenience for multiplayer module
  getSeed() { return WORLD_SEED; }
}

// ============================================================
// Multiplayer wiring
// ============================================================
function setupMultiplayer(game) {
  const mp = new Multiplayer(game);
  game.multiplayer = mp;
  window.__mp = mp;

  const $status  = document.getElementById('mp-status');
  const $peers   = document.getElementById('mp-peers');
  const $actions = document.getElementById('mp-actions');
  const $room    = document.getElementById('mp-room');
  const $url     = document.getElementById('mp-url');
  const $qr      = document.getElementById('mp-qr');
  const $hostBtn = document.getElementById('mp-host-btn');
  const $joinBtn = document.getElementById('mp-join-btn');

  function showRoom() {
    const url = mp.getJoinUrl();
    if (!url) return;
    $url.textContent = url;
    $room.classList.remove('mp-hidden');
    $actions.classList.add('mp-hidden');
    $qr.innerHTML = '';
    if (window.QRCode) {
      // qrcodejs renders into the container element.
      new QRCode($qr, { text: url, width: 156, height: 156, correctLevel: QRCode.CorrectLevel.M });
    }
  }

  $url.addEventListener('click', () => {
    navigator.clipboard?.writeText($url.textContent).then(() => {
      $url.style.background = 'rgba(120,220,120,0.25)';
      setTimeout(() => $url.style.background = '', 400);
    });
  });

  $hostBtn.addEventListener('click', async () => {
    $hostBtn.disabled = true;
    try { await mp.host(); showRoom(); }
    catch (e) { $hostBtn.disabled = false; alert('Host failed: ' + e); }
  });
  $joinBtn.addEventListener('click', async () => {
    const id = prompt('Enter room id (or paste full URL with ?join=...)');
    if (!id) return;
    let target = id.trim();
    const m = target.match(/[?&]join=([^&]+)/);
    if (m) target = decodeURIComponent(m[1]);
    $joinBtn.disabled = true;
    try { await mp.join(target); }
    catch (e) { $joinBtn.disabled = false; alert('Join failed: ' + e); }
  });

  document.addEventListener('mp-status', (e) => {
    const s = e.detail.status;
    $status.className = s;
    $status.textContent = s;
    if (s === 'host' || s === 'joined') {
      $actions.classList.add('mp-hidden');
      if (s === 'host') showRoom();
    }
  });

  // Periodic peer-count refresh
  setInterval(() => {
    if (mp.status === 'host' || mp.status === 'joined') {
      const n = mp.peerCount();
      const others = mp.remote.size;
      $peers.textContent = `Peers: ${others} player${others === 1 ? '' : 's'} online`;
    } else {
      $peers.textContent = '';
    }
  }, 1000);

  // Auto-join from ?join=ID
  try {
    const join = new URL(location.href).searchParams.get('join');
    if (join) {
      $joinBtn.disabled = true; $hostBtn.disabled = true;
      mp.join(join).catch(e => { $joinBtn.disabled = false; $hostBtn.disabled = false; });
    }
  } catch (_) {}
}

window.__game = new Game();
window.__Mob = Mob;
setupMultiplayer(window.__game);

// ============================================================
// MinecraftAI — extensible API for an AI agent to play the game
// ============================================================
// Usage from console / agent:
//   const obs = MinecraftAI.observe();           // full state snapshot
//   MinecraftAI.setIntent({ forward: true });    // sticky movement (release with .stop())
//   MinecraftAI.lookAt(x, y, z);                 // aim camera at world point
//   MinecraftAI.breakBlock(x, y, z);             // instant break (drops in survival)
//   MinecraftAI.placeBlock(x, y, z, blockId);    // place a specific block
//   MinecraftAI.attackTarget();                  // hit mob in front (1 hp)
//   MinecraftAI.findBlocks(blockId, radius);     // search nearby
//   MinecraftAI.findMobs(type|null, radius);
window.MinecraftAI = (function () {
  const G = () => window.__game;

  // Sticky AI movement intent — merged into game.keys each frame.
  const intent = {
    forward: false, back: false, left: false, right: false,
    jump: false, sprint: false, sneak: false, descend: false,
  };

  function applyIntent() {
    const g = G(); if (!g) return;
    const k = g.keys;
    if (intent.forward) k['KeyW'] = true; else if (k['KeyW'] === 'ai') k['KeyW'] = false;
    if (intent.back)    k['KeyS'] = true; else if (k['KeyS'] === 'ai') k['KeyS'] = false;
    if (intent.left)    k['KeyA'] = true; else if (k['KeyA'] === 'ai') k['KeyA'] = false;
    if (intent.right)   k['KeyD'] = true; else if (k['KeyD'] === 'ai') k['KeyD'] = false;
    if (intent.jump)    k['Space'] = true;
    if (intent.sprint)  k['ShiftLeft'] = true;
    if (intent.descend) k['ControlLeft'] = true;
  }
  // Hook into the game animation loop
  function installHook() {
    const g = G(); if (!g || g._aiHooked) return;
    const orig = g.updatePlayer.bind(g);
    g.updatePlayer = function (dt) { applyIntent(); orig(dt); };
    g._aiHooked = true;
  }

  function blockNameOf(id) {
    return BLOCK_NAMES[id] ? BLOCK_NAMES[id].toLowerCase() : `id_${id}`;
  }

  // Build name→id map for convenience
  const NAME_TO_ID = {};
  for (let i = 0; i < BLOCK_NAMES.length; i++) NAME_TO_ID[BLOCK_NAMES[i].toLowerCase()] = i;

  // ---------- Observation ----------
  function observe(opts) {
    installHook();
    const g = G(); if (!g) return null;
    const p = g.player;
    const dir = new THREE.Vector3();
    g.camera.getWorldDirection(dir);
    const eye = new THREE.Vector3(p.position.x, p.position.y + p.eyeOffset, p.position.z);
    const targetDist = (opts && opts.reach) || 6;
    const hit = raycastVoxel(g.world, eye, dir, targetDist);
    let target = null;
    if (hit && hit.hit) {
      target = {
        x: hit.x, y: hit.y, z: hit.z,
        block: g.world.getBlock(hit.x, hit.y, hit.z),
        blockName: blockNameOf(g.world.getBlock(hit.x, hit.y, hit.z)),
        face: hit.face, dist: hit.dist || null,
      };
    }
    // Mobs nearby
    const mobs = [];
    for (const m of g.mobs) {
      if (m.dead) continue;
      const mx = m.pos.x - p.position.x;
      const my = m.pos.y - p.position.y;
      const mz = m.pos.z - p.position.z;
      const d = Math.sqrt(mx * mx + my * my + mz * mz);
      mobs.push({
        type: m.type, hp: m.hp,
        x: +m.pos.x.toFixed(2), y: +m.pos.y.toFixed(2), z: +m.pos.z.toFixed(2),
        dist: +d.toFixed(2), yaw: +m.yaw.toFixed(2),
        onFire: !!m.onFire,
        hostile: !!m.hostile,
      });
    }
    mobs.sort((a, b) => a.dist - b.dist);

    // Inventory snapshot
    const inv = g.inventory.map(s => s ? {
      block: s.block, name: blockNameOf(s.block),
      count: s.count === Infinity ? -1 : s.count
    } : null);

    // Light + time
    const lx = Math.floor(p.position.x);
    const ly = Math.floor(p.position.y + 1.6);
    const lz = Math.floor(p.position.z);
    const skyLight = g.computeSkyLight(lx, ly, lz);
    const skyDim = Math.round((1 - g.brightness) * 11);
    const effectiveLight = Math.max(0, skyLight - skyDim);

    return {
      tick: performance.now() | 0,
      player: {
        x: +p.position.x.toFixed(3), y: +p.position.y.toFixed(3), z: +p.position.z.toFixed(3),
        yaw: +p.yaw.toFixed(3), pitch: +p.pitch.toFixed(3),
        vx: +p.velocity.x.toFixed(2), vy: +p.velocity.y.toFixed(2), vz: +p.velocity.z.toFixed(2),
        onGround: !!p.onGround, flying: !!p.flying, inWater: !!p.inWater,
        fallDistance: +(p.fallDistance || 0).toFixed(2),
        hp: g.health != null ? g.health : null,
        maxHp: g.maxHealth != null ? g.maxHealth : null,
        gameMode: g.gameMode,
      },
      look: { dx: +dir.x.toFixed(3), dy: +dir.y.toFixed(3), dz: +dir.z.toFixed(3) },
      target,
      time: { dayTime: +g.dayTime.toFixed(3), isDay: !!g.isDay, brightness: +g.brightness.toFixed(2) },
      light: { sky: skyLight, effective: effectiveLight },
      inventory: { selected: g.selectedSlot, slots: inv },
      mobs,
      world: { chunks: g.world.chunks.size, seed: WORLD_SEED },
    };
  }

  // Sample block ids in a (2*r+1)^3 cube around the player. Returns flat array.
  function scan(radius) {
    const g = G(); if (!g) return null;
    const r = Math.max(1, Math.min(8, radius || 3));
    const p = g.player;
    const cx = Math.floor(p.position.x);
    const cy = Math.floor(p.position.y + 0.5);
    const cz = Math.floor(p.position.z);
    const blocks = [];
    for (let dy = -r; dy <= r; dy++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          const x = cx + dx, y = cy + dy, z = cz + dz;
          const id = g.world.getBlock(x, y, z);
          if (id !== 0) blocks.push({ x, y, z, id, name: blockNameOf(id) });
        }
      }
    }
    return { center: { x: cx, y: cy, z: cz }, radius: r, blocks };
  }

  function findBlocks(blockId, radius) {
    const g = G(); if (!g) return [];
    const r = Math.max(1, Math.min(24, radius || 8));
    const p = g.player;
    const cx = Math.floor(p.position.x);
    const cy = Math.floor(p.position.y + 1);
    const cz = Math.floor(p.position.z);
    const out = [];
    for (let dy = -r; dy <= r; dy++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          const x = cx + dx, y = cy + dy, z = cz + dz;
          if (g.world.getBlock(x, y, z) === blockId) {
            out.push({ x, y, z, dist: +Math.sqrt(dx * dx + dy * dy + dz * dz).toFixed(2) });
          }
        }
      }
    }
    out.sort((a, b) => a.dist - b.dist);
    return out;
  }

  function findMobs(type, radius) {
    const g = G(); if (!g) return [];
    const r = radius || 32;
    const p = g.player;
    const out = [];
    for (const m of g.mobs) {
      if (m.dead) continue;
      if (type && m.type !== type) continue;
      const dx = m.pos.x - p.position.x;
      const dy = m.pos.y - p.position.y;
      const dz = m.pos.z - p.position.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d <= r) out.push({ type: m.type, hp: m.hp, x: m.pos.x, y: m.pos.y, z: m.pos.z, dist: +d.toFixed(2), ref: m });
    }
    out.sort((a, b) => a.dist - b.dist);
    return out;
  }

  // ---------- Actions ----------
  function setIntent(partial) {
    installHook();
    Object.assign(intent, partial || {});
    // Clear non-set keys when explicitly false
    return { ...intent };
  }
  function stop() {
    installHook();
    for (const k of Object.keys(intent)) intent[k] = false;
    const g = G(); if (g) {
      g.keys['KeyW'] = false; g.keys['KeyS'] = false;
      g.keys['KeyA'] = false; g.keys['KeyD'] = false;
      g.keys['Space'] = false;
    }
    return true;
  }
  function setLook(yaw, pitch) {
    const g = G(); if (!g) return false;
    if (typeof yaw === 'number') g.player.yaw = yaw;
    if (typeof pitch === 'number') {
      g.player.pitch = Math.max(-Math.PI / 2 + 0.001, Math.min(Math.PI / 2 - 0.001, pitch));
    }
    return true;
  }
  function lookAt(x, y, z) {
    const g = G(); if (!g) return false;
    const p = g.player;
    const dx = x - p.position.x;
    const dy = y - (p.position.y + p.eyeOffset);
    const dz = z - p.position.z;
    const horiz = Math.hypot(dx, dz);
    // Match camera convention: yaw rotates +Y, three.js camera looks down -Z, but
    // the project uses sin(yaw)/cos(yaw) for forward = (-sin, *, -cos).
    const yaw = Math.atan2(-dx, -dz);
    const pitch = Math.atan2(dy, horiz);
    return setLook(yaw, pitch);
  }
  function selectSlot(idx) {
    const g = G(); if (!g) return false;
    g.setSelected(idx);
    return true;
  }
  function setGamemode(mode) {
    const g = G(); if (!g) return false;
    if (mode !== g.gameMode) g.toggleGameMode();
    return g.gameMode === mode;
  }
  function setFly(on) {
    const g = G(); if (!g) return false;
    g.player.flying = !!on;
    return g.player.flying;
  }

  // Instant break — bypasses mining time. Honors survival drops.
  function breakBlock(x, y, z) {
    const g = G(); if (!g) return false;
    const id = g.world.getBlock(x, y, z);
    if (id === 0) return false;
    if (g.gameMode === 'survival') {
      g.spawnDrop(x + 0.5, y + 0.5, z + 0.5, id);
    }
    g.world.setBlock(x, y, z, 0);
    return true;
  }
  function breakTarget() {
    const g = G(); if (!g) return false;
    const eye = new THREE.Vector3(g.player.position.x, g.player.position.y + g.player.eyeOffset, g.player.position.z);
    const dir = new THREE.Vector3(); g.camera.getWorldDirection(dir);
    const hit = raycastVoxel(g.world, eye, dir, 6);
    if (!hit || !hit.hit) return false;
    return breakBlock(hit.x, hit.y, hit.z);
  }
  function placeBlock(x, y, z, blockId) {
    const g = G(); if (!g) return false;
    if (g.world.getBlock(x, y, z) !== 0) return false;
    // Don't place inside the player
    const p = g.player, r = 0.3, h = 1.75;
    const inside = (x + 1 > p.position.x - r && x < p.position.x + r &&
                    y + 1 > p.position.y     && y < p.position.y + h &&
                    z + 1 > p.position.z - r && z < p.position.z + r);
    if (inside) return false;
    const id = (typeof blockId === 'number') ? blockId : (g.selectedBlockType ? g.selectedBlockType() : null);
    if (id == null || id === 0) return false;
    g.world.setBlock(x, y, z, id);
    return true;
  }
  function attackTarget() {
    const g = G(); if (!g) return null;
    // Find nearest mob within 4 blocks in front
    const eye = new THREE.Vector3(g.player.position.x, g.player.position.y + g.player.eyeOffset, g.player.position.z);
    const dir = new THREE.Vector3(); g.camera.getWorldDirection(dir);
    let best = null, bestT = 999;
    for (const m of g.mobs) {
      if (m.dead) continue;
      const cx = m.pos.x, cy = m.pos.y + m.height * 0.5, cz = m.pos.z;
      const dx = cx - eye.x, dy = cy - eye.y, dz = cz - eye.z;
      const t = dx * dir.x + dy * dir.y + dz * dir.z;
      if (t < 0 || t > 4) continue;
      const px = eye.x + dir.x * t, py = eye.y + dir.y * t, pz = eye.z + dir.z * t;
      const off = Math.hypot(px - cx, py - cy, pz - cz);
      if (off < (m.radius + 0.3) && t < bestT) { best = m; bestT = t; }
    }
    if (!best) return null;
    best.hp -= 2;
    // Knockback
    const dx = best.pos.x - g.player.position.x;
    const dz = best.pos.z - g.player.position.z;
    const d = Math.hypot(dx, dz) || 1;
    best.vel.x += (dx / d) * 4;
    best.vel.z += (dz / d) * 4;
    best.vel.y = 4;
    return { type: best.type, hp: best.hp, dead: best.hp <= 0 };
  }

  function teleport(x, y, z) {
    const g = G(); if (!g) return false;
    g.player.position.set(x, y, z);
    g.player.velocity.set(0, 0, 0);
    if (g._unstickPlayer) g._unstickPlayer();
    return true;
  }
  function setTime(dayTime01) {
    const g = G(); if (!g) return false;
    g.dayTime = ((dayTime01 % 1) + 1) % 1;
    return true;
  }
  function getSeed() { return WORLD_SEED; }
  function setSeed(n) {
    const g = G(); if (!g) return false;
    return g.setSeed(n);
  }
  function newSeed() {
    const g = G(); if (!g) return false;
    return g.newSeed();
  }
  function reload() {
    const g = G(); if (!g) return false;
    g.reloadWorld();
    return true;
  }

  installHook();
  return {
    BLOCK: NAME_TO_ID,
    BLOCK_NAMES,
    observe, scan, findBlocks, findMobs,
    setIntent, stop, setLook, lookAt, selectSlot, setGamemode, setFly,
    breakBlock, breakTarget, placeBlock, attackTarget,
    teleport, setTime,
    getSeed, setSeed, newSeed, reload,
    _game: G,
  };
})();
