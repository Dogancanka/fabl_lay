// Architectural wall model: straightens the cell-level room assignment and
// extracts real wall segments (with thickness and classification) plus the
// room-interface graph used for door placement.
import { INSIDE, CORE, OUTSIDE } from './grid.js';

export const SIDE_OUT = -1;  // outside the envelope
export const SIDE_CORE = -2; // structural core

export const WALL_THICKNESS = { exterior: 0.3, core: 0.2, interior: 0.1 };
export const WALL_HEIGHT = 2.7;
export const DOOR_HEIGHT = 2.1;
export const WINDOW_SILL = 0.9;
export const WINDOW_HEAD = 2.1;

/**
 * Boundary relaxation: flips boundary cells to the majority neighbor label
 * when that removes a corner, keeping rooms contiguous (simple-point test)
 * and areas roughly stable. Straightens the staircase artifacts of the
 * region-growing decode into buildable walls.
 */
export function straightenLabels(labels, grid, iterations = 3) {
  const { W, H, kinds } = grid;
  const out = labels.slice();
  const counts = new Map();
  for (let i = 0; i < out.length; i++) {
    if (out[i] >= 0) counts.set(out[i], (counts.get(out[i]) || 0) + 1);
  }

  for (let it = 0; it < iterations; it++) {
    let changed = 0;
    for (let j = 1; j < H - 1; j++) {
      for (let i = 1; i < W - 1; i++) {
        const idx = j * W + i;
        if (kinds[idx] !== INSIDE) continue;
        const me = out[idx];
        const n = out[idx - W], s = out[idx + W], w = out[idx - 1], e = out[idx + 1];
        let sameN = 0;
        const tally = {};
        for (const v of [n, s, w, e]) {
          if (v === me) sameN++;
          else if (v >= 0) tally[v] = (tally[v] || 0) + 1;
        }
        let best = -1, bestN = 0;
        for (const k of Object.keys(tally)) {
          if (tally[k] > bestN) { bestN = tally[k]; best = Number(k); }
        }
        if (best < 0 || bestN < sameN) continue;         // never lengthen the boundary
        if ((counts.get(me) || 0) <= 4) continue;        // don't erase tiny rooms
        if (!isSimplePoint(out, W, idx, me)) continue;   // keep room connected
        if (bestN === sameN) {
          // tie on boundary length: flip only if it removes corners
          const before = cornersAround(out, W, i, j);
          out[idx] = best;
          const after = cornersAround(out, W, i, j);
          if (after >= before) { out[idx] = me; continue; }
        } else {
          out[idx] = best;
        }
        counts.set(me, counts.get(me) - 1);
        counts.set(best, (counts.get(best) || 0) + 1);
        changed++;
      }
    }
    if (changed === 0) break;
  }
  return out;
}

/** Corner count at the 4 lattice vertices of cell (i, j). */
function cornersAround(labels, W, i, j) {
  let corners = 0;
  for (const [vi, vj] of [[i, j], [i + 1, j], [i, j + 1], [i + 1, j + 1]]) {
    const tl = labels[(vj - 1) * W + vi - 1], tr = labels[(vj - 1) * W + vi];
    const bl = labels[vj * W + vi - 1], br = labels[vj * W + vi];
    const up = tl !== tr, down = bl !== br, left = tl !== bl, right = tr !== br;
    const ne = up + down + left + right;
    if (ne >= 2 && !((up && down && ne === 2) || (left && right && ne === 2))) corners++;
  }
  return corners;
}

/** True if removing idx from its label-region keeps the region locally connected. */
function isSimplePoint(labels, W, idx, label) {
  // 8-neighborhood ring, clockwise
  const ring = [idx - W - 1, idx - W, idx - W + 1, idx + 1, idx + W + 1, idx + W, idx + W - 1, idx - 1];
  let transitions = 0;
  for (let k = 0; k < 8; k++) {
    const a = labels[ring[k]] === label ? 1 : 0;
    const b = labels[ring[(k + 1) % 8]] === label ? 1 : 0;
    if (a !== b) transitions++;
  }
  return transitions <= 2; // single connected arc of same-label neighbors
}

function sideValue(labels, grid, i, j) {
  if (i < 0 || j < 0 || i >= grid.W || j >= grid.H) return SIDE_OUT;
  const idx = j * grid.W + i;
  if (grid.kinds[idx] === OUTSIDE) return SIDE_OUT;
  if (grid.kinds[idx] === CORE) return SIDE_CORE;
  return labels[idx];
}

/**
 * Extract maximal straight wall segments from a (straightened) label map.
 * @returns walls: [{ x1,y1,x2,y2, horizontal, sideA, sideB, type, thickness, len }]
 *   sideA/sideB: room index, SIDE_OUT or SIDE_CORE. For horizontal walls A is
 *   above (smaller y), B below; for vertical walls A is left, B right.
 */
export function extractWalls(labels, grid) {
  const { W, H, ox, oy, cellSize: cs } = grid;
  const walls = [];

  // vertical walls along x = ox + i*cs
  for (let i = 0; i <= W; i++) {
    let run = null;
    for (let j = 0; j <= H; j++) {
      const a = j < H ? sideValue(labels, grid, i - 1, j) : null;
      const b = j < H ? sideValue(labels, grid, i, j) : null;
      const boundary = j < H && a !== b && !(a === SIDE_OUT && b === SIDE_OUT);
      if (boundary && run && run.sideA === a && run.sideB === b) {
        run.j1 = j;
      } else {
        if (run) walls.push(finishRun(run, false, ox, oy, cs));
        run = boundary ? { i, j0: j, j1: j, sideA: a, sideB: b } : null;
      }
    }
    if (run) walls.push(finishRun(run, false, ox, oy, cs));
  }

  // horizontal walls along y = oy + j*cs
  for (let j = 0; j <= H; j++) {
    let run = null;
    for (let i = 0; i <= W; i++) {
      const a = i < W ? sideValue(labels, grid, i, j - 1) : null;
      const b = i < W ? sideValue(labels, grid, i, j) : null;
      const boundary = i < W && a !== b && !(a === SIDE_OUT && b === SIDE_OUT);
      if (boundary && run && run.sideA === a && run.sideB === b) {
        run.j1 = i;
      } else {
        if (run) walls.push(finishRun(run, true, ox, oy, cs));
        run = boundary ? { i: j, j0: i, j1: i, sideA: a, sideB: b } : null;
      }
    }
    if (run) walls.push(finishRun(run, true, ox, oy, cs));
  }

  return walls;
}

function finishRun(run, horizontal, ox, oy, cs) {
  const type =
    run.sideA === SIDE_OUT || run.sideB === SIDE_OUT ? 'exterior' :
    run.sideA === SIDE_CORE || run.sideB === SIDE_CORE ? 'core' : 'interior';
  const w = {
    horizontal,
    sideA: run.sideA,
    sideB: run.sideB,
    type,
    thickness: WALL_THICKNESS[type],
    len: (run.j1 - run.j0 + 1) * cs,
  };
  if (horizontal) {
    w.x1 = ox + run.j0 * cs; w.x2 = ox + (run.j1 + 1) * cs;
    w.y1 = w.y2 = oy + run.i * cs;
  } else {
    w.y1 = oy + run.j0 * cs; w.y2 = oy + (run.j1 + 1) * cs;
    w.x1 = w.x2 = ox + run.i * cs;
  }
  return w;
}

/** Group interior walls by unordered room pair -> sorted segments (longest first). */
export function roomInterfaces(walls, R) {
  const map = new Map(); // key a*R+b (a<b) -> [walls]
  for (const w of walls) {
    if (w.type !== 'interior' || w.sideA < 0 || w.sideB < 0) continue;
    const a = Math.min(w.sideA, w.sideB);
    const b = Math.max(w.sideA, w.sideB);
    const key = a * R + b;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(w);
  }
  for (const segs of map.values()) segs.sort((p, q) => q.len - p.len);
  return map;
}

/** All wall runs bounding a given room, with the inward normal for that room. */
export function roomWallRuns(walls, room) {
  const runs = [];
  for (const w of walls) {
    if (w.sideA !== room && w.sideB !== room) continue;
    // inward normal: from the wall line into the room's side
    let nx = 0, ny = 0;
    if (w.horizontal) ny = w.sideA === room ? -1 : 1;
    else nx = w.sideA === room ? -1 : 1;
    runs.push({ wall: w, nx, ny });
  }
  runs.sort((a, b) => b.wall.len - a.wall.len);
  return runs;
}

/**
 * World-space rect of a wall's poché band. Exterior walls sit fully inward
 * of the envelope line; interior and core walls are centered on it.
 */
export function wallRect(w) {
  const t = w.thickness;
  if (w.horizontal) {
    // sideA is above (smaller y)
    let y0 = w.y1 - t / 2;
    if (w.type === 'exterior') y0 = w.sideB === SIDE_OUT ? w.y1 - t : w.y1; // inward
    return { x: w.x1 - 0.05, y: y0, w: w.x2 - w.x1 + 0.1, h: t };
  }
  let x0 = w.x1 - t / 2;
  if (w.type === 'exterior') x0 = w.sideB === SIDE_OUT ? w.x1 - t : w.x1;
  return { x: x0, y: w.y1 - 0.05, w: t, h: w.y2 - w.y1 + 0.1 };
}

/** Offset from the wall centerline to its inner face on the given room side. */
export function wallFaceInset(w) {
  return w.type === 'exterior' ? w.thickness : w.thickness / 2;
}
