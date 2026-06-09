// Genome encoding + decoding for the evolutionary layout solver.
//
// A genome is one seed per room: { x, y } in world meters plus a growth
// weight. Decoding performs capacity-constrained multi-source region growing
// over the cell grid: every room floods outward from its seed through a
// shared priority queue; expansion gets progressively more expensive once a
// room exceeds its target cell count. The result is a full partition of the
// interior into contiguous rooms whose areas track the program targets while
// the seed positions (the evolved part) control the topology.
import { INSIDE, nearestInsideCell, worldToCell, cellCenter } from './grid.js';

export function randomGenome(grid, rooms, rng) {
  return rooms.map(() => {
    const cell = randomInsideCell(grid, rng);
    const c = cellCenter(grid, cell);
    return { x: c.x, y: c.y, w: 0.7 + rng() * 0.6 };
  });
}

function randomInsideCell(grid, rng) {
  for (let tries = 0; tries < 200; tries++) {
    const idx = (rng() * grid.kinds.length) | 0;
    if (grid.kinds[idx] === INSIDE) return idx;
  }
  return grid.kinds.indexOf(INSIDE);
}

export function mutateGenome(genome, grid, rng, { sigma = 1.4, pJitter = 0.6, pSwap = 0.15, lockedIndex = -1 } = {}) {
  const g = genome.map((s) => ({ ...s }));
  for (let i = 0; i < g.length; i++) {
    if (i === lockedIndex) continue;
    if (rng() < pJitter) {
      g[i].x += gaussian(rng) * sigma;
      g[i].y += gaussian(rng) * sigma;
    }
    if (rng() < 0.3) {
      g[i].w = clamp(g[i].w * Math.exp(gaussian(rng) * 0.2), 0.4, 2.0);
    }
  }
  if (g.length > 1 && rng() < pSwap) {
    let a = (rng() * g.length) | 0;
    let b = (rng() * g.length) | 0;
    if (a !== b && a !== lockedIndex && b !== lockedIndex) {
      const tx = g[a].x, ty = g[a].y;
      g[a].x = g[b].x; g[a].y = g[b].y;
      g[b].x = tx; g[b].y = ty;
    }
  }
  clampToGrid(g, grid);
  return g;
}

export function crossoverGenomes(a, b, rng) {
  return a.map((s, i) => (rng() < 0.5 ? { ...s } : { ...b[i] }));
}

export function clampToGrid(genome, grid) {
  const minX = grid.ox, maxX = grid.ox + grid.W * grid.cellSize;
  const minY = grid.oy, maxY = grid.oy + grid.H * grid.cellSize;
  for (const s of genome) {
    s.x = clamp(s.x, minX, maxX);
    s.y = clamp(s.y, minY, maxY);
  }
}

export function genomeDistance(a, b) {
  if (!a || !b || a.length !== b.length) return Infinity;
  let d = 0;
  for (let i = 0; i < a.length; i++) d += Math.hypot(a[i].x - b[i].x, a[i].y - b[i].y);
  return d / a.length;
}

/**
 * Decode a genome into a cell→room assignment.
 * @returns { labels: Int16Array (-1 = not a room cell), sizes: Int32Array }
 */
export function decodeGenome(genome, grid, capacities) {
  const { W, H, kinds } = grid;
  const R = genome.length;
  const labels = new Int16Array(W * H).fill(-1);
  const sizes = new Int32Array(R);
  const heap = new MinHeap();

  // Seed rooms on distinct cells (nearest free interior cell to the gene).
  const taken = new Set();
  for (let r = 0; r < R; r++) {
    const cell = nearestInsideCell(grid, genome[r].x, genome[r].y, taken);
    if (cell < 0) continue;
    taken.add(cell);
    heap.push(r * 1e-7, cell, r); // tiny deterministic tie-break by room order
  }

  while (heap.size > 0) {
    const { cost, cell, room } = heap.pop();
    if (labels[cell] !== -1) continue;
    labels[cell] = room;
    sizes[room]++;

    // Step cost: inverse growth weight, inflated once the room is over target
    // so under-filled rooms win contested cells.
    const cap = Math.max(1, capacities[room]);
    const over = sizes[room] / cap;
    const overPenalty = over <= 1 ? 1 : 1 + 6 * (over - 1) * (over - 1);
    const step = (1 / genome[room].w) * overPenalty;

    const i = cell % W;
    const j = (cell / W) | 0;
    if (i > 0 && kinds[cell - 1] === INSIDE && labels[cell - 1] === -1) heap.push(cost + step, cell - 1, room);
    if (i < W - 1 && kinds[cell + 1] === INSIDE && labels[cell + 1] === -1) heap.push(cost + step, cell + 1, room);
    if (j > 0 && kinds[cell - W] === INSIDE && labels[cell - W] === -1) heap.push(cost + step, cell - W, room);
    if (j < H - 1 && kinds[cell + W] === INSIDE && labels[cell + W] === -1) heap.push(cost + step, cell + W, room);
  }

  return { labels, sizes };
}

/** Fraction of interior cells assigned differently between two decoded layouts. */
export function labelDifference(a, b) {
  if (!a || !b || a.length !== b.length) return 1;
  let diff = 0, total = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] === -1 && b[i] === -1) continue;
    total++;
    if (a[i] !== b[i]) diff++;
  }
  return total === 0 ? 0 : diff / total;
}

// ---------- utilities ----------

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

export function gaussian(rng) {
  let u = 0, v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Deterministic PRNG (mulberry32) so runs are reproducible per seed. */
export function makeRng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class MinHeap {
  constructor() {
    this.costs = [];
    this.cells = [];
    this.rooms = [];
    this.size = 0;
  }
  push(cost, cell, room) {
    let i = this.size++;
    this.costs[i] = cost; this.cells[i] = cell; this.rooms[i] = room;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.costs[p] <= this.costs[i]) break;
      this.swap(i, p);
      i = p;
    }
  }
  pop() {
    const top = { cost: this.costs[0], cell: this.cells[0], room: this.rooms[0] };
    this.size--;
    if (this.size > 0) {
      this.costs[0] = this.costs[this.size];
      this.cells[0] = this.cells[this.size];
      this.rooms[0] = this.rooms[this.size];
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < this.size && this.costs[l] < this.costs[m]) m = l;
        if (r < this.size && this.costs[r] < this.costs[m]) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }
  swap(a, b) {
    [this.costs[a], this.costs[b]] = [this.costs[b], this.costs[a]];
    [this.cells[a], this.cells[b]] = [this.cells[b], this.cells[a]];
    [this.rooms[a], this.rooms[b]] = [this.rooms[b], this.rooms[a]];
  }
}
