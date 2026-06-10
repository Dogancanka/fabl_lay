// Manual plan editing ("Plan" tool): drag interior walls perpendicular to
// move room boundaries (the strip of cells is reassigned and the plan is
// re-synthesized), slide doors/windows along their walls, double-click a
// door to flip its swing, drag furniture (with live validation against
// rooms, other furniture and door clearances), double-click furniture to
// rotate it 90°.
import { state } from './state.js';
import { editor, worldFromScreen } from './editor.js';
import { distToSegment } from './geometry.js';
import { setOpeningT, flipDoorSwing } from './solver/openings.js';
import { synthesize } from './solver/synthesize.js';
import { evaluate } from './solver/fitness.js';
import { combinedScore } from './program.js';
import { INSIDE, OUTSIDE, CORE } from './solver/grid.js';

export const planEditor = {
  hover: null,   // { kind: 'furniture'|'door'|'window'|'wall', ... }
  drag: null,
  getCatalog: () => new Map(),
  onPlanEdited: () => {},
};

export function initPlanEditor(canvas, { getCatalog, onPlanEdited }) {
  planEditor.getCatalog = getCatalog;
  planEditor.onPlanEdited = onPlanEdited;
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('dblclick', onDbl);
}

const active = () => state.tool === 'plan' && state.solutions[state.selectedAlt] && state.grid;
const sol = () => state.solutions[state.selectedAlt];

// ---------- hit testing ----------

function hitTest(w) {
  const s = sol();
  const tol = (editor.touch ? 16 : 10) / editor.camera.scale;

  for (let i = s.furniture.length - 1; i >= 0; i--) {
    const r = s.furniture[i].rect;
    if (w.x >= r.x - 0.05 && w.x <= r.x + r.w + 0.05 && w.y >= r.y - 0.05 && w.y <= r.y + r.h + 0.05) {
      return { kind: 'furniture', index: i };
    }
  }
  for (let i = 0; i < s.doors.length; i++) {
    if (distToOpening(w, s.doors[i]) < Math.max(tol, 0.3)) return { kind: 'door', index: i };
  }
  for (let i = 0; i < s.windows.length; i++) {
    if (distToOpening(w, s.windows[i]) < Math.max(tol, 0.3)) return { kind: 'window', index: i };
  }
  for (let i = 0; i < s.walls.length; i++) {
    const wall = s.walls[i];
    if (wall.type !== 'interior') continue;
    if (distToSegment(w, { x: wall.x1, y: wall.y1 }, { x: wall.x2, y: wall.y2 }) < tol) {
      return { kind: 'wall', index: i };
    }
  }
  return null;
}

function distToOpening(w, o) {
  const cx = o.wall.horizontal ? o.wall.x1 + o.t : o.wall.x1;
  const cy = o.wall.horizontal ? o.wall.y1 : o.wall.y1 + o.t;
  return Math.hypot(w.x - cx, w.y - cy);
}

// ---------- pointer handlers ----------

function onDown(e) {
  if (!active() || e.button !== 0) return;
  const w = worldFromScreen(e.offsetX, e.offsetY);
  const hit = hitTest(w);
  if (!hit) return;
  editor.drag = null; // cancel the geometry editor's pan (touch has no hover)

  const s = sol();
  if (hit.kind === 'furniture') {
    const item = s.furniture[hit.index];
    planEditor.drag = {
      ...hit, start: w,
      rect0: { ...item.rect },
      valid: true,
    };
  } else if (hit.kind === 'door' || hit.kind === 'window') {
    planEditor.drag = { ...hit };
  } else if (hit.kind === 'wall') {
    planEditor.drag = { ...hit, offset: 0 };
  }
}

function onMove(e) {
  if (!active()) { planEditor.hover = null; return; }
  const w = worldFromScreen(e.offsetX, e.offsetY);

  if (!planEditor.drag) {
    planEditor.hover = hitTest(w);
    editor.canvas.style.cursor = planEditor.hover ? 'move' : 'default';
    return;
  }
  e.stopImmediatePropagation();

  const s = sol();
  const d = planEditor.drag;
  if (d.kind === 'furniture') {
    const item = s.furniture[d.index];
    const snap = (v) => Math.round(v / 0.1) * 0.1;
    item.rect.x = snap(d.rect0.x + (w.x - d.start.x));
    item.rect.y = snap(d.rect0.y + (w.y - d.start.y));
    d.valid = furnitureValid(s, d.index);
  } else if (d.kind === 'door') {
    const door = s.doors[d.index];
    setOpeningT(door, alongWall(door.wall, w));
  } else if (d.kind === 'window') {
    const win = s.windows[d.index];
    setOpeningT(win, alongWall(win.wall, w));
  } else if (d.kind === 'wall') {
    const wall = s.walls[d.index];
    const cs = state.grid.cellSize;
    const raw = wall.horizontal ? w.y - wall.y1 : w.x - wall.x1;
    d.offset = Math.round(raw / cs) * cs;
  }
}

function onUp() {
  const d = planEditor.drag;
  planEditor.drag = null;
  if (!d || !active()) return;
  const s = sol();

  if (d.kind === 'furniture') {
    if (!d.valid) s.furniture[d.index].rect = d.rect0; // revert invalid drops
    s.edited = true;
    planEditor.onPlanEdited({ light: true });
  } else if (d.kind === 'door' || d.kind === 'window') {
    s.edited = true;
    planEditor.onPlanEdited({ light: true });
  } else if (d.kind === 'wall' && d.offset !== 0) {
    moveWall(s, s.walls[d.index], d.offset);
  }
}

function onDbl(e) {
  if (!active()) return;
  const w = worldFromScreen(e.offsetX, e.offsetY);
  const hit = hitTest(w);
  if (!hit) return;
  e.stopImmediatePropagation();
  const s = sol();
  if (hit.kind === 'door' && s.doors[hit.index].kind !== 'opening') {
    flipDoorSwing(s.doors[hit.index]);
    s.edited = true;
    planEditor.onPlanEdited({ light: true });
  } else if (hit.kind === 'furniture') {
    const item = s.furniture[hit.index];
    const r = item.rect;
    const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
    item.rect = { x: cx - r.h / 2, y: cy - r.w / 2, w: r.h, h: r.w };
    item.facing = { nx: -item.facing.ny, ny: item.facing.nx };
    s.edited = true;
    planEditor.onPlanEdited({ light: true });
  }
}

function alongWall(wall, w) {
  return wall.horizontal ? w.x - wall.x1 : w.y - wall.y1;
}

// ---------- furniture validation ----------

function furnitureValid(s, index) {
  const item = s.furniture[index];
  const r = item.rect;
  const grid = state.grid;
  // inside its room
  const pts = [
    [r.x + 0.03, r.y + 0.03], [r.x + r.w - 0.03, r.y + 0.03],
    [r.x + 0.03, r.y + r.h - 0.03], [r.x + r.w - 0.03, r.y + r.h - 0.03],
  ];
  for (const [x, y] of pts) {
    const i = Math.floor((x - grid.ox) / grid.cellSize);
    const j = Math.floor((y - grid.oy) / grid.cellSize);
    if (i < 0 || j < 0 || i >= grid.W || j >= grid.H) return false;
    if (s.labels[j * grid.W + i] !== item.room) return false;
  }
  const hits = (a, b) =>
    a.x < b.x + b.w - 0.01 && a.x + a.w > b.x + 0.01 && a.y < b.y + b.h - 0.01 && a.y + a.h > b.y + 0.01;
  for (let k = 0; k < s.furniture.length; k++) {
    if (k !== index && hits(r, s.furniture[k].rect)) return false;
  }
  for (const door of s.doors) {
    if (hits(r, door.clearance)) return false;
  }
  return true;
}

// ---------- wall moving: reassign the cell strip and re-synthesize ----------

function moveWall(s, wall, offset) {
  const grid = state.grid;
  const cs = grid.cellSize;
  const { W } = grid;
  const k = Math.round(Math.abs(offset) / cs);
  if (k === 0) return;
  const labels = s.labels; // straightened labels are the working layout

  const i0 = Math.round((wall.x1 - grid.ox) / cs);
  const j0 = Math.round((wall.y1 - grid.oy) / cs);
  const span = Math.round(wall.len / cs);

  // moving toward positive axis grows sideA (the room on the smaller side)
  const into = offset > 0 ? wall.sideB : wall.sideA;
  const gain = offset > 0 ? wall.sideA : wall.sideB;
  for (let step = 0; step < k; step++) {
    for (let u = 0; u < span; u++) {
      let i, j;
      if (wall.horizontal) {
        i = i0 + u;
        j = offset > 0 ? j0 + step : j0 - 1 - step;
      } else {
        i = offset > 0 ? i0 + step : i0 - 1 - step;
        j = j0 + u;
      }
      if (i < 0 || j < 0 || i >= grid.W || j >= grid.H) continue;
      const idx = j * W + i;
      if (grid.kinds[idx] !== INSIDE) continue;
      if (labels[idx] === into) labels[idx] = gain;
    }
  }

  resynthesize(s);
}

/** Re-run synthesis + scoring locally on the (edited) labels of a solution. */
export function resynthesize(s) {
  const grid = ensureDerived(state.grid);
  const rooms = state.program.rooms;
  const totalTarget = rooms.reduce((sum, r) => sum + Math.max(1, r.area), 0);
  const ctx = {
    grid, rooms,
    adjacency: state.program.adjacency || {},
    capacities: rooms.map((r) => Math.max(2, Math.round((grid.insideCount * Math.max(1, r.area)) / totalTarget))),
    circulationIndex: rooms.findIndex((r) => r.circulation),
    entrance: state.entrance,
    catalog: planEditor.getCatalog(),
    hasCore: state.cores.length > 0,
    hasEntrance: !!state.entrance,
  };

  const plan = synthesize(s.labels, ctx);
  const sizes = new Int32Array(rooms.length);
  for (const l of plan.labels) if (l >= 0) sizes[l]++;
  const res = evaluate(plan.labels, sizes, ctx, state.weights);

  Object.assign(s, plan, {
    breakdown: { ...res.breakdown, ...plan.ext },
    edited: true,
  });
  s.score = combinedScore(s.breakdown, state.weights);
  planEditor.onPlanEdited({ light: false });
}

/** state.grid comes from the worker without facade/coreAdj — derive once. */
function ensureDerived(grid) {
  if (grid.facade) return grid;
  const { W, H, kinds } = grid;
  const facade = new Uint8Array(W * H);
  const coreAdj = new Uint8Array(W * H);
  let insideCount = 0;
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const idx = j * W + i;
      if (kinds[idx] !== INSIDE) continue;
      insideCount++;
      const n = j > 0 ? kinds[idx - W] : OUTSIDE;
      const sKind = j < H - 1 ? kinds[idx + W] : OUTSIDE;
      const wKind = i > 0 ? kinds[idx - 1] : OUTSIDE;
      const eKind = i < W - 1 ? kinds[idx + 1] : OUTSIDE;
      if (n === OUTSIDE || sKind === OUTSIDE || wKind === OUTSIDE || eKind === OUTSIDE) facade[idx] = 1;
      if (n === CORE || sKind === CORE || wKind === CORE || eKind === CORE) coreAdj[idx] = 1;
    }
  }
  grid.facade = facade;
  grid.coreAdj = coreAdj;
  grid.insideCount = insideCount;
  return grid;
}
