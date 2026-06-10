// Canvas interaction layer: camera, sketching tools (envelope / core /
// entrance), and direct manipulation of existing geometry with snapping.
import { state, snapshotGeometry, geometryChanged } from './state.js';
import { snapPoint, dist, distToSegment, closestPointOnSegment, polygonBounds } from './geometry.js';
import { planEditor } from './plan-editor.js';

const GRID = 0.5;            // snap grid in meters
const CLOSE_RADIUS = 0.6;    // click distance to close the polygon (m)

export const editor = {
  camera: { cx: 10, cy: 7, scale: 42 }, // world center + px per meter
  sketch: [],          // in-progress envelope points
  cursor: null,        // snapped cursor (world)
  guides: [],
  hover: null,         // { kind, index, sub }
  selection: null,
  drag: null,
  coreDraft: null,     // { a: {x,y}, b: {x,y} } while dragging a new core
  touch: false,        // last input was a touch pointer (bigger hit targets)
  canvas: null,
};

// multi-touch tracking for pinch-zoom / two-finger pan
const pointers = new Map(); // pointerId -> { x, y } (screen px)
let pinch = null;           // { d0, scale0, w0 } gesture-start reference

export function initEditor(canvas) {
  editor.canvas = canvas;

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
  canvas.addEventListener('dblclick', onDoubleClick);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  window.addEventListener('keydown', onKeyDown);
  fitView();
}

// ---------- camera ----------

export function worldFromScreen(px, py) {
  const { camera, canvas } = editor;
  return {
    x: camera.cx + (px - canvas.clientWidth / 2) / camera.scale,
    y: camera.cy + (py - canvas.clientHeight / 2) / camera.scale,
  };
}

export function screenFromWorld(x, y) {
  const { camera, canvas } = editor;
  return {
    x: canvas.clientWidth / 2 + (x - camera.cx) * camera.scale,
    y: canvas.clientHeight / 2 + (y - camera.cy) * camera.scale,
  };
}

export function fitView() {
  if (state.envelope.length < 3 || !editor.canvas) return;
  const b = polygonBounds(state.envelope);
  const { canvas, camera } = editor;
  camera.cx = (b.minx + b.maxx) / 2;
  camera.cy = (b.miny + b.maxy) / 2;
  const pad = 4;
  camera.scale = Math.min(
    canvas.clientWidth / (b.maxx - b.minx + pad),
    canvas.clientHeight / (b.maxy - b.miny + pad),
  );
}

// ---------- helpers ----------

function snapVertices(excludeEnvelopeIndex = -1) {
  const verts = [];
  state.envelope.forEach((p, i) => { if (i !== excludeEnvelopeIndex) verts.push(p); });
  for (const c of state.cores) {
    verts.push({ x: c.x, y: c.y }, { x: c.x + c.w, y: c.y }, { x: c.x, y: c.y + c.h }, { x: c.x + c.w, y: c.y + c.h });
  }
  return verts;
}

function hitTest(w) {
  const tol = (editor.touch ? 16 : 9) / editor.camera.scale; // px in world units

  // entrance marker
  if (state.entrance && dist(w, state.entrance) < tol * 1.4) {
    return { kind: 'entrance' };
  }
  // envelope vertices
  for (let i = 0; i < state.envelope.length; i++) {
    if (dist(w, state.envelope[i]) < tol) return { kind: 'vertex', index: i };
  }
  // core corners, then bodies
  for (let i = state.cores.length - 1; i >= 0; i--) {
    const c = state.cores[i];
    const corners = [
      { x: c.x, y: c.y }, { x: c.x + c.w, y: c.y },
      { x: c.x + c.w, y: c.y + c.h }, { x: c.x, y: c.y + c.h },
    ];
    for (let k = 0; k < 4; k++) {
      if (dist(w, corners[k]) < tol) return { kind: 'core-corner', index: i, sub: k };
    }
  }
  for (let i = state.cores.length - 1; i >= 0; i--) {
    const c = state.cores[i];
    if (w.x >= c.x && w.x <= c.x + c.w && w.y >= c.y && w.y <= c.y + c.h) {
      return { kind: 'core', index: i };
    }
  }
  // envelope edges
  for (let i = 0; i < state.envelope.length; i++) {
    const a = state.envelope[i];
    const b = state.envelope[(i + 1) % state.envelope.length];
    if (distToSegment(w, a, b) < tol) return { kind: 'edge', index: i };
  }
  return null;
}

function projectToEnvelope(w, maxDist = 2.0) {
  let best = null, bestD = maxDist;
  for (let i = 0; i < state.envelope.length; i++) {
    const a = state.envelope[i];
    const b = state.envelope[(i + 1) % state.envelope.length];
    const p = closestPointOnSegment(w, a, b);
    const d = dist(w, p);
    if (d < bestD) { bestD = d; best = { x: p.x, y: p.y }; }
  }
  return best;
}

function reprojectEntrance() {
  if (!state.entrance || state.envelope.length < 3) return;
  const p = projectToEnvelope(state.entrance, Infinity);
  if (p) state.entrance = p;
}

const snapTo = (v) => Math.round(v / GRID) * GRID;

// ---------- pointer handlers ----------

function onPointerDown(e) {
  try { editor.canvas.setPointerCapture(e.pointerId); } catch { /* synthetic events have no active pointer */ }
  editor.touch = e.pointerType === 'touch';
  pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY });

  // second finger down: switch to pinch-zoom / two-finger pan
  if (pointers.size === 2) {
    editor.drag = null;
    editor.coreDraft = null;
    const [p1, p2] = [...pointers.values()];
    const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
    pinch = {
      d0: Math.max(20, Math.hypot(p1.x - p2.x, p1.y - p2.y)),
      scale0: editor.camera.scale,
      w0: worldFromScreen(mid.x, mid.y), // world point to keep under the fingers
    };
    return;
  }
  if (pinch) return;

  const w = worldFromScreen(e.offsetX, e.offsetY);

  if (e.button === 1 || e.button === 2) {
    editor.drag = { kind: 'pan', sx: e.offsetX, sy: e.offsetY, cx: editor.camera.cx, cy: editor.camera.cy };
    return;
  }

  switch (state.tool) {
    case 'plan':
      // element hits are handled by the plan editor's own listener;
      // empty space pans
      if (!planEditor.hover) {
        editor.drag = { kind: 'pan', sx: e.offsetX, sy: e.offsetY, cx: editor.camera.cx, cy: editor.camera.cy };
      }
      break;
    case 'envelope': envelopeClick(w); break;
    case 'core':
      editor.coreDraft = { a: { x: snapTo(w.x), y: snapTo(w.y) }, b: { x: snapTo(w.x), y: snapTo(w.y) } };
      editor.drag = { kind: 'core-draft' };
      break;
    case 'entrance': {
      const p = projectToEnvelope(w);
      if (p) {
        snapshotGeometry();
        state.entrance = p;
        geometryChanged();
      }
      break;
    }
    case 'select': {
      const hit = hitTest(w);
      editor.selection = hit;
      if (!hit) {
        editor.drag = { kind: 'pan', sx: e.offsetX, sy: e.offsetY, cx: editor.camera.cx, cy: editor.camera.cy };
        return;
      }
      snapshotGeometry();
      if (hit.kind === 'vertex') {
        editor.drag = { kind: 'vertex', index: hit.index };
      } else if (hit.kind === 'edge') {
        const i = hit.index;
        const j = (i + 1) % state.envelope.length;
        editor.drag = {
          kind: 'edge', i, j, start: w,
          a0: { ...state.envelope[i] }, b0: { ...state.envelope[j] },
        };
      } else if (hit.kind === 'core') {
        editor.drag = { kind: 'core', index: hit.index, start: w, c0: { ...state.cores[hit.index] } };
      } else if (hit.kind === 'core-corner') {
        editor.drag = { kind: 'core-corner', index: hit.index, sub: hit.sub };
      } else if (hit.kind === 'entrance') {
        editor.drag = { kind: 'entrance' };
      }
      break;
    }
  }
}

function onPointerMove(e) {
  if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY });

  if (pinch) {
    if (pointers.size >= 2) {
      const [p1, p2] = [...pointers.values()];
      const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
      const d = Math.max(20, Math.hypot(p1.x - p2.x, p1.y - p2.y));
      const { camera, canvas } = editor;
      camera.scale = Math.max(6, Math.min(220, pinch.scale0 * (d / pinch.d0)));
      camera.cx = pinch.w0.x - (mid.x - canvas.clientWidth / 2) / camera.scale;
      camera.cy = pinch.w0.y - (mid.y - canvas.clientHeight / 2) / camera.scale;
    }
    return;
  }

  const w = worldFromScreen(e.offsetX, e.offsetY);
  editor.guides = [];

  if (editor.drag) {
    handleDrag(w, e);
    return;
  }

  // hover feedback + sketch preview
  if (state.tool === 'envelope') {
    const prev = editor.sketch[editor.sketch.length - 1] || null;
    const snapped = snapPoint(w, { grid: GRID, vertices: snapVertices(), prev });
    editor.cursor = snapped;
    editor.guides = snapped.guides;
  } else if (state.tool === 'entrance') {
    editor.cursor = projectToEnvelope(w);
  } else {
    editor.cursor = null;
    editor.hover = state.tool === 'select' ? hitTest(w) : null;
    editor.canvas.style.cursor =
      editor.hover ? 'pointer' : (state.tool === 'select' ? 'default' : 'crosshair');
  }
}

function handleDrag(w, e) {
  const d = editor.drag;
  switch (d.kind) {
    case 'pan': {
      editor.camera.cx = d.cx - (e.offsetX - d.sx) / editor.camera.scale;
      editor.camera.cy = d.cy - (e.offsetY - d.sy) / editor.camera.scale;
      return; // no geometry change
    }
    case 'vertex': {
      const snapped = snapPoint(w, { grid: GRID, vertices: snapVertices(d.index) });
      state.envelope[d.index] = { x: snapped.x, y: snapped.y };
      editor.guides = snapped.guides;
      reprojectEntrance();
      break;
    }
    case 'edge': {
      const dx = snapTo(w.x - d.start.x);
      const dy = snapTo(w.y - d.start.y);
      state.envelope[d.i] = { x: d.a0.x + dx, y: d.a0.y + dy };
      state.envelope[d.j] = { x: d.b0.x + dx, y: d.b0.y + dy };
      reprojectEntrance();
      break;
    }
    case 'core': {
      const c = state.cores[d.index];
      c.x = snapTo(d.c0.x + (w.x - d.start.x));
      c.y = snapTo(d.c0.y + (w.y - d.start.y));
      break;
    }
    case 'core-corner': {
      const c = state.cores[d.index];
      const x2 = c.x + c.w, y2 = c.y + c.h;
      const nx = snapTo(w.x), ny = snapTo(w.y);
      // sub: 0 tl, 1 tr, 2 br, 3 bl
      if (d.sub === 0) { c.w = Math.max(1, x2 - nx); c.h = Math.max(1, y2 - ny); c.x = x2 - c.w; c.y = y2 - c.h; }
      if (d.sub === 1) { c.w = Math.max(1, nx - c.x); c.h = Math.max(1, y2 - ny); c.y = y2 - c.h; }
      if (d.sub === 2) { c.w = Math.max(1, nx - c.x); c.h = Math.max(1, ny - c.y); }
      if (d.sub === 3) { c.w = Math.max(1, x2 - nx); c.h = Math.max(1, ny - c.y); c.x = x2 - c.w; }
      break;
    }
    case 'entrance': {
      const p = projectToEnvelope(w, Infinity);
      if (p) state.entrance = p;
      break;
    }
    case 'core-draft': {
      editor.coreDraft.b = { x: snapTo(w.x), y: snapTo(w.y) };
      return; // committed on pointerup
    }
  }
  geometryChanged();
}

function onPointerUp(e) {
  pointers.delete(e.pointerId);
  if (pinch) {
    if (pointers.size < 2) pinch = null;
    return;
  }
  const d = editor.drag;
  editor.drag = null;
  if (d && d.kind === 'core-draft' && editor.coreDraft) {
    const { a, b } = editor.coreDraft;
    const rect = {
      x: Math.min(a.x, b.x), y: Math.min(a.y, b.y),
      w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y),
    };
    editor.coreDraft = null;
    if (rect.w >= 1 && rect.h >= 1) {
      snapshotGeometry();
      state.cores.push(rect);
      geometryChanged();
    }
  }
}

function onDoubleClick(e) {
  if (state.tool === 'plan') return; // plan editor handles its own dblclick
  const w = worldFromScreen(e.offsetX, e.offsetY);
  if (state.tool === 'envelope') {
    finishEnvelope();
    return;
  }
  if (state.tool === 'select') {
    const hit = hitTest(w);
    if (hit && hit.kind === 'edge') {
      snapshotGeometry();
      const p = closestPointOnSegment(w, state.envelope[hit.index], state.envelope[(hit.index + 1) % state.envelope.length]);
      state.envelope.splice(hit.index + 1, 0, { x: snapTo(p.x), y: snapTo(p.y) });
      geometryChanged();
    }
  }
}

function onWheel(e) {
  e.preventDefault();
  const { camera } = editor;
  const before = worldFromScreen(e.offsetX, e.offsetY);
  const factor = Math.exp(-e.deltaY * 0.0012);
  camera.scale = Math.max(6, Math.min(220, camera.scale * factor));
  const after = worldFromScreen(e.offsetX, e.offsetY);
  camera.cx += before.x - after.x;
  camera.cy += before.y - after.y;
}

// ---------- envelope sketching ----------

function envelopeClick(w) {
  const prev = editor.sketch[editor.sketch.length - 1] || null;
  const snapped = snapPoint(w, { grid: GRID, vertices: snapVertices(), prev });
  const pt = { x: snapped.x, y: snapped.y };

  if (editor.sketch.length >= 3 && dist(pt, editor.sketch[0]) < CLOSE_RADIUS) {
    finishEnvelope();
    return;
  }
  if (prev && dist(pt, prev) < 0.05) return; // ignore double-click duplicate
  editor.sketch.push(pt);
}

function finishEnvelope() {
  if (editor.sketch.length >= 3) {
    snapshotGeometry();
    state.envelope = editor.sketch.slice();
    reprojectEntrance();
    geometryChanged();
  }
  editor.sketch = [];
  setTool('select');
}

// ---------- keyboard ----------

function onKeyDown(e) {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    import('./state.js').then((m) => m.undoGeometry());
    return;
  }

  switch (e.key) {
    case 'Escape':
      editor.sketch = [];
      editor.coreDraft = null;
      editor.selection = null;
      break;
    case 'Enter':
      if (state.tool === 'envelope') finishEnvelope();
      break;
    case 'Delete':
    case 'Backspace':
      deleteSelection();
      break;
    case 'v': case 'V': setTool('select'); break;
    case 'p': case 'P': setTool('plan'); break;
    case 'e': case 'E': setTool('envelope'); break;
    case 'c': case 'C': setTool('core'); break;
    case 'n': case 'N': setTool('entrance'); break;
    case 'g': case 'G': state.events.emit('toggle', 'graph'); break;
    case 'd': case 'D': state.events.emit('toggle', 'dims'); break;
    case 'f': case 'F': state.events.emit('toggle', 'furniture'); break;
    case ' ':
      e.preventDefault();
      state.events.emit('toggle', 'pause');
      break;
  }
}

function deleteSelection() {
  const sel = editor.selection;
  if (!sel) return;
  snapshotGeometry();
  if (sel.kind === 'vertex' && state.envelope.length > 3) {
    state.envelope.splice(sel.index, 1);
    reprojectEntrance();
  } else if (sel.kind === 'core' || sel.kind === 'core-corner') {
    state.cores.splice(sel.index, 1);
  } else if (sel.kind === 'entrance') {
    state.entrance = null;
  } else {
    state._undo.pop(); // nothing deleted, drop the snapshot
    return;
  }
  editor.selection = null;
  geometryChanged();
}

export function setTool(tool) {
  state.tool = tool;
  editor.sketch = [];
  editor.coreDraft = null;
  editor.selection = null;
  editor.cursor = null;
  state.events.emit('tool', tool);
}
