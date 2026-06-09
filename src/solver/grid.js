// Rasterizes the sketched envelope + cores into a uniform cell grid that the
// layout solver operates on. Cell kinds: 0 = outside, 1 = assignable interior,
// 2 = core (structure / vertical circulation, not assignable).
import { pointInPolygon, pointInRect, polygonBounds } from '../geometry.js';

export const OUTSIDE = 0;
export const INSIDE = 1;
export const CORE = 2;

export function rasterize(envelope, cores, cellSize) {
  const b = polygonBounds(envelope);
  const ox = b.minx - cellSize;
  const oy = b.miny - cellSize;
  const W = Math.max(1, Math.ceil((b.maxx - b.minx) / cellSize) + 2);
  const H = Math.max(1, Math.ceil((b.maxy - b.miny) / cellSize) + 2);

  const kinds = new Uint8Array(W * H);
  const facade = new Uint8Array(W * H);   // interior cell touching outside
  const coreAdj = new Uint8Array(W * H);  // interior cell touching a core
  let insideCount = 0;

  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const cx = ox + (i + 0.5) * cellSize;
      const cy = oy + (j + 0.5) * cellSize;
      if (!pointInPolygon(cx, cy, envelope)) continue;
      let kind = INSIDE;
      for (const c of cores) {
        if (pointInRect(cx, cy, c)) { kind = CORE; break; }
      }
      kinds[j * W + i] = kind;
      if (kind === INSIDE) insideCount++;
    }
  }

  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const idx = j * W + i;
      if (kinds[idx] !== INSIDE) continue;
      const n = j > 0 ? kinds[idx - W] : OUTSIDE;
      const s = j < H - 1 ? kinds[idx + W] : OUTSIDE;
      const w = i > 0 ? kinds[idx - 1] : OUTSIDE;
      const e = i < W - 1 ? kinds[idx + 1] : OUTSIDE;
      if (n === OUTSIDE || s === OUTSIDE || w === OUTSIDE || e === OUTSIDE) facade[idx] = 1;
      if (n === CORE || s === CORE || w === CORE || e === CORE) coreAdj[idx] = 1;
    }
  }

  return { W, H, ox, oy, cellSize, kinds, facade, coreAdj, insideCount };
}

export function worldToCell(grid, x, y) {
  const i = Math.floor((x - grid.ox) / grid.cellSize);
  const j = Math.floor((y - grid.oy) / grid.cellSize);
  if (i < 0 || j < 0 || i >= grid.W || j >= grid.H) return -1;
  return j * grid.W + i;
}

export function cellCenter(grid, idx) {
  const i = idx % grid.W;
  const j = (idx / grid.W) | 0;
  return {
    x: grid.ox + (i + 0.5) * grid.cellSize,
    y: grid.oy + (j + 0.5) * grid.cellSize,
  };
}

/** Nearest INSIDE cell to a world point, optionally excluding already-taken cells. */
export function nearestInsideCell(grid, x, y, taken = null) {
  const { W, H } = grid;
  const start = worldToCell(grid, x, y);
  const si = start >= 0 ? start % W : Math.max(0, Math.min(W - 1, Math.floor((x - grid.ox) / grid.cellSize)));
  const sj = start >= 0 ? (start / W) | 0 : Math.max(0, Math.min(H - 1, Math.floor((y - grid.oy) / grid.cellSize)));

  const maxR = Math.max(W, H);
  for (let r = 0; r <= maxR; r++) {
    let best = -1;
    let bestD = Infinity;
    for (let j = Math.max(0, sj - r); j <= Math.min(H - 1, sj + r); j++) {
      for (let i = Math.max(0, si - r); i <= Math.min(W - 1, si + r); i++) {
        if (Math.max(Math.abs(i - si), Math.abs(j - sj)) !== r) continue; // ring only
        const idx = j * W + i;
        if (grid.kinds[idx] !== INSIDE) continue;
        if (taken && taken.has(idx)) continue;
        const d = (i - si) * (i - si) + (j - sj) * (j - sj);
        if (d < bestD) { bestD = d; best = idx; }
      }
    }
    if (best >= 0) return best;
  }
  return -1;
}
