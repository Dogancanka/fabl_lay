// Layout evaluation: turns a decoded cell assignment into per-criterion
// penalties (each normalized to [0,1]) and an overall 0–100 score.
import { INSIDE } from './grid.js';
import { pairKey } from '../program.js';

const DOOR_EDGES = 2; // shared cell edges needed for a usable door connection

/**
 * Analyze a decoded layout: per-room stats + room↔room shared boundary edges.
 */
export function analyzeLayout(labels, grid, R) {
  const { W, H, kinds, facade, coreAdj } = grid;
  const stats = [];
  for (let r = 0; r < R; r++) {
    stats.push({
      size: 0, facade: 0, coreAdj: 0,
      minI: Infinity, maxI: -Infinity, minJ: Infinity, maxJ: -Infinity,
      sumI: 0, sumJ: 0,
    });
  }
  // shared boundary edge counts, key = a * R + b with a < b
  const shared = new Map();

  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const idx = j * W + i;
      const r = labels[idx];
      if (r < 0) continue;
      const s = stats[r];
      s.size++;
      s.sumI += i; s.sumJ += j;
      if (i < s.minI) s.minI = i;
      if (i > s.maxI) s.maxI = i;
      if (j < s.minJ) s.minJ = j;
      if (j > s.maxJ) s.maxJ = j;
      if (facade[idx]) s.facade++;
      if (coreAdj[idx]) s.coreAdj++;

      if (i < W - 1 && kinds[idx + 1] === INSIDE) {
        const o = labels[idx + 1];
        if (o >= 0 && o !== r) bump(shared, r, o, R);
      }
      if (j < H - 1 && kinds[idx + W] === INSIDE) {
        const o = labels[idx + W];
        if (o >= 0 && o !== r) bump(shared, r, o, R);
      }
    }
  }

  return { stats, shared };
}

function bump(map, a, b, R) {
  const key = a < b ? a * R + b : b * R + a;
  map.set(key, (map.get(key) || 0) + 1);
}

/**
 * Evaluate a decoded layout.
 * @param ctx { grid, rooms, adjacency, capacities, circulationIndex, hasCore, hasEntrance }
 * @returns { score, breakdown, analysis, connections }
 */
export function evaluate(labels, sizes, ctx, weights) {
  const { grid, rooms, adjacency, capacities, circulationIndex } = ctx;
  const R = rooms.length;
  const analysis = analyzeLayout(labels, grid, R);
  const { stats, shared } = analysis;

  // --- area: mean relative deviation from (normalized) targets
  let areaPen = 0;
  for (let r = 0; r < R; r++) {
    const cap = Math.max(1, capacities[r]);
    areaPen += Math.min(1, Math.abs(stats[r].size - cap) / cap);
    if (stats[r].size === 0) areaPen += 1; // vanished room: extra punishment
  }
  areaPen = Math.min(1, areaPen / R);

  // --- adjacency rules
  let required = 0, requiredMet = 0, avoided = 0, avoidViolated = 0;
  const connections = []; // achieved door-able connections [a, b, edges]
  for (const [key, edges] of shared) {
    if (edges >= DOOR_EDGES) connections.push([(key / R) | 0, key % R, edges]);
  }
  for (const key of Object.keys(adjacency)) {
    const [idA, idB] = key.split(':').map(Number);
    const a = rooms.findIndex((r) => r.id === idA);
    const b = rooms.findIndex((r) => r.id === idB);
    if (a < 0 || b < 0) continue;
    const edges = shared.get(a < b ? a * R + b : b * R + a) || 0;
    if (adjacency[key] === 1) {
      required++;
      if (edges >= DOOR_EDGES) requiredMet++;
    } else if (adjacency[key] === -1) {
      avoided++;
      if (edges > 0) avoidViolated++;
    }
  }
  const rules = required + avoided;
  const adjPen = rules === 0 ? 0 : ((required - requiredMet) + avoidViolated) / rules;

  // --- daylight: rooms that need facade but have none
  let needSun = 0, dark = 0;
  for (let r = 0; r < R; r++) {
    if (!rooms[r].daylight) continue;
    needSun++;
    if (stats[r].size > 0 && stats[r].facade === 0) dark++;
  }
  const dayPen = needSun === 0 ? 0 : dark / needSun;

  // --- compactness: bounding-box fill ratio + aspect penalty
  let compPen = 0;
  for (let r = 0; r < R; r++) {
    const s = stats[r];
    if (s.size === 0) { compPen += 1; continue; }
    const bw = s.maxI - s.minI + 1;
    const bh = s.maxJ - s.minJ + 1;
    const fill = s.size / (bw * bh);
    const aspect = Math.max(bw, bh) / Math.max(1, Math.min(bw, bh));
    compPen += (1 - fill) * 0.75 + Math.min(1, Math.max(0, aspect - 2.6) / 3) * 0.25;
  }
  compPen = Math.min(1, compPen / R);

  // --- circulation: hall anchored to entrance/core, all rooms reachable
  let circPen = 0;
  if (circulationIndex >= 0 && R > 1) {
    const reach = reachableFrom(circulationIndex, R, shared);
    let unreachable = 0;
    for (let r = 0; r < R; r++) {
      if (r !== circulationIndex && stats[r].size > 0 && !reach[r]) unreachable++;
    }
    circPen += unreachable / (R - 1);
    if (ctx.hasCore && stats[circulationIndex].size > 0 && stats[circulationIndex].coreAdj === 0) {
      circPen += 0.5; // hall should hug the core (stairs/elevator)
    }
    circPen = Math.min(1, circPen);
  }

  // --- construction logic: corner/junction density of interior walls.
  // Straight continuous walls are buildable; staircase walls are not.
  let corners = 0, wallEdges = 0;
  const { W: gw, H: gh } = grid;
  const lab = (i, j) => (i < 0 || j < 0 || i >= gw || j >= gh) ? -1 : labels[j * gw + i];
  const interiorEdgeV = (i, j) => { const a = lab(i - 1, j), b = lab(i, j); return a >= 0 && b >= 0 && a !== b; };
  const interiorEdgeH = (i, j) => { const a = lab(i, j - 1), b = lab(i, j); return a >= 0 && b >= 0 && a !== b; };
  for (let j = 0; j <= gh; j++) {
    for (let i = 0; i <= gw; i++) {
      const up = j > 0 && interiorEdgeV(i, j - 1);
      const down = j < gh && interiorEdgeV(i, j);
      const left = i > 0 && interiorEdgeH(i - 1, j);
      const right = i < gw && interiorEdgeH(i, j);
      const n = up + down + left + right;
      if (up || down) wallEdges++;
      if (n >= 2 && !((up && down && n === 2) || (left && right && n === 2))) corners++;
    }
  }
  const constructionPen = Math.min(1, (corners / Math.max(1, wallEdges)) * 2);

  const breakdown = {
    area: 1 - areaPen,
    adjacency: 1 - adjPen,
    daylight: 1 - dayPen,
    compactness: 1 - compPen,
    circulation: 1 - circPen,
    construction: 1 - constructionPen,
  };

  let weighted = 0, totalW = 0;
  for (const k of Object.keys(breakdown)) {
    const w = weights[k] ?? 1;
    weighted += w * (1 - breakdown[k]);
    totalW += w;
  }
  const score = totalW === 0 ? 100 : Math.max(0, 100 * (1 - weighted / totalW));

  return { score, breakdown, analysis, connections };
}

function reachableFrom(start, R, shared) {
  const adj = Array.from({ length: R }, () => []);
  for (const [key, edges] of shared) {
    if (edges < DOOR_EDGES) continue;
    const a = (key / R) | 0, b = key % R;
    adj[a].push(b);
    adj[b].push(a);
  }
  const seen = new Array(R).fill(false);
  const queue = [start];
  seen[start] = true;
  while (queue.length) {
    const cur = queue.pop();
    for (const nb of adj[cur]) {
      if (!seen[nb]) { seen[nb] = true; queue.push(nb); }
    }
  }
  return seen;
}
