// All canvas drawing: background grid, generated layout, sketch geometry,
// snap guides, dimensions, adjacency-graph overlay, and offscreen rendering
// for alternative thumbnails / the compare view.
import { state } from './state.js';
import { editor, screenFromWorld } from './editor.js';
import { dist } from './geometry.js';
import { pairKey } from './program.js';
import { drawPlan } from './render-plan.js';
import { planEditor } from './plan-editor.js';

const COLOR_BG = '#101216';
const COLOR_GRID = 'rgba(255,255,255,0.045)';
const COLOR_ENVELOPE = '#e8eaee';
const COLOR_CORE = '#3a3f49';
const COLOR_GUIDE = '#4f8cff';

export function renderScene(canvas) {
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const wpx = canvas.clientWidth, hpx = canvas.clientHeight;
  if (canvas.width !== wpx * dpr || canvas.height !== hpx * dpr) {
    canvas.width = wpx * dpr;
    canvas.height = hpx * dpr;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  ctx.fillStyle = COLOR_BG;
  ctx.fillRect(0, 0, wpx, hpx);

  drawBackgroundGrid(ctx, wpx, hpx);

  const sol = state.solutions[state.selectedAlt];
  if (sol && state.grid) drawLayout(ctx, sol, state.grid);

  drawCores(ctx);
  drawEnvelope(ctx, !sol);
  if (state.layers.dims) drawDimensions(ctx);
  if (sol && state.tool === 'plan') drawPlanEditOverlay(ctx, sol);
  if (sol && state.grid && state.layers.labels) drawRoomLabels(ctx, sol);
  if (state.layers.graph && sol) drawGraph(ctx, sol);
  drawEntrance(ctx);
  drawSketch(ctx);
  drawGuides(ctx);
  drawHandles(ctx);
}

function drawBackgroundGrid(ctx, wpx, hpx) {
  const { camera } = editor;
  if (camera.scale < 12) return;
  const step = camera.scale; // 1m
  const tl = { x: camera.cx - wpx / 2 / camera.scale, y: camera.cy - hpx / 2 / camera.scale };
  const x0 = (Math.ceil(tl.x) - tl.x) * camera.scale;
  const y0 = (Math.ceil(tl.y) - tl.y) * camera.scale;
  ctx.strokeStyle = COLOR_GRID;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = x0; x < wpx; x += step) { ctx.moveTo(x, 0); ctx.lineTo(x, hpx); }
  for (let y = y0; y < hpx; y += step) { ctx.moveTo(0, y); ctx.lineTo(wpx, y); }
  ctx.stroke();
}

// ---------- generated layout ----------

function drawLayout(ctx, sol, grid) {
  drawPlan(ctx, sol, grid, state.program.rooms,
    (x, y) => screenFromWorld(x, y), editor.camera.scale,
    { ...state.layers, hiddenFamilies: state.hiddenFamilies });
}

function drawPlanEditOverlay(ctx, sol) {
  const target = planEditor.drag || planEditor.hover;
  if (!target) return;
  const dragging = !!planEditor.drag;

  if (target.kind === 'furniture') {
    const item = sol.furniture[target.index];
    if (!item) return;
    const a = screenFromWorld(item.rect.x, item.rect.y);
    const b = screenFromWorld(item.rect.x + item.rect.w, item.rect.y + item.rect.h);
    ctx.strokeStyle = dragging && planEditor.drag.valid === false ? '#e5534b' : COLOR_GUIDE;
    ctx.lineWidth = 2;
    ctx.strokeRect(a.x - 2, a.y - 2, b.x - a.x + 4, b.y - a.y + 4);
  } else if (target.kind === 'door' || target.kind === 'window') {
    const o = (target.kind === 'door' ? sol.doors : sol.windows)[target.index];
    if (!o) return;
    const cx = o.wall.horizontal ? o.wall.x1 + o.t : o.wall.x1;
    const cy = o.wall.horizontal ? o.wall.y1 : o.wall.y1 + o.t;
    const p = screenFromWorld(cx, cy);
    ctx.strokeStyle = COLOR_GUIDE;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(p.x, p.y, Math.max(10, o.width * editor.camera.scale * 0.6), 0, Math.PI * 2);
    ctx.stroke();
  } else if (target.kind === 'wall') {
    const w = sol.walls[target.index];
    if (!w) return;
    const off = dragging ? (planEditor.drag.offset || 0) : 0;
    const dx = w.horizontal ? 0 : off;
    const dy = w.horizontal ? off : 0;
    const a = screenFromWorld(w.x1 + dx, w.y1 + dy);
    const b = screenFromWorld(w.x2 + dx, w.y2 + dy);
    ctx.strokeStyle = COLOR_GUIDE;
    ctx.lineWidth = 4;
    if (dragging && off !== 0) ctx.setLineDash([7, 5]);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

function drawPlanEditOverlay(ctx, sol) {
  const target = planEditor.drag || planEditor.hover;
  if (!target) return;
  const dragging = !!planEditor.drag;

  if (target.kind === 'furniture') {
    const item = sol.furniture[target.index];
    if (!item) return;
    const a = screenFromWorld(item.rect.x, item.rect.y);
    const b = screenFromWorld(item.rect.x + item.rect.w, item.rect.y + item.rect.h);
    ctx.strokeStyle = dragging && planEditor.drag.valid === false ? '#e5534b' : COLOR_GUIDE;
    ctx.lineWidth = 2;
    ctx.strokeRect(a.x - 2, a.y - 2, b.x - a.x + 4, b.y - a.y + 4);
  } else if (target.kind === 'door' || target.kind === 'window') {
    const o = (target.kind === 'door' ? sol.doors : sol.windows)[target.index];
    if (!o) return;
    const cx = o.wall.horizontal ? o.wall.x1 + o.t : o.wall.x1;
    const cy = o.wall.horizontal ? o.wall.y1 : o.wall.y1 + o.t;
    const p = screenFromWorld(cx, cy);
    ctx.strokeStyle = COLOR_GUIDE;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(p.x, p.y, Math.max(10, o.width * editor.camera.scale * 0.6), 0, Math.PI * 2);
    ctx.stroke();
  } else if (target.kind === 'wall') {
    const w = sol.walls[target.index];
    if (!w) return;
    const off = dragging ? (planEditor.drag.offset || 0) : 0;
    const dx = w.horizontal ? 0 : off;
    const dy = w.horizontal ? off : 0;
    const a = screenFromWorld(w.x1 + dx, w.y1 + dy);
    const b = screenFromWorld(w.x2 + dx, w.y2 + dy);
    ctx.strokeStyle = COLOR_GUIDE;
    ctx.lineWidth = 4;
    if (dragging && off !== 0) ctx.setLineDash([7, 5]);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

function drawRoomLabels(ctx, sol) {
  const rooms = state.program.rooms;
  ctx.textAlign = 'center';
  for (let r = 0; r < rooms.length; r++) {
    const c = sol.centroids[r];
    if (!c) continue;
    const p = screenFromWorld(c.x, c.y);
    ctx.fillStyle = 'rgba(15,17,20,0.85)';
    ctx.font = `600 ${Math.max(10, Math.min(14, editor.camera.scale * 0.32))}px sans-serif`;
    ctx.fillText(rooms[r].name, p.x, p.y - 2);
    ctx.font = `${Math.max(9, Math.min(12, editor.camera.scale * 0.26))}px sans-serif`;
    ctx.fillText(`${sol.areas[r].toFixed(1)} m²`, p.x, p.y + 12);
  }
  ctx.textAlign = 'left';
}

function drawGraph(ctx, sol) {
  const rooms = state.program.rooms;
  const R = rooms.length;
  const adjacency = state.program.adjacency;
  const pos = sol.centroids.map((c) => (c ? screenFromWorld(c.x, c.y) : null));

  const achieved = new Set(sol.connections.map(([a, b]) => (a < b ? a * R + b : b * R + a)));

  // achieved but unconstrained connections: faint
  ctx.lineWidth = 1.5;
  for (const [a, b] of sol.connections) {
    if (!pos[a] || !pos[b]) continue;
    const key = pairKey(rooms[a].id, rooms[b].id);
    if (adjacency[key]) continue;
    ctx.strokeStyle = 'rgba(120,130,150,0.5)';
    line(ctx, pos[a], pos[b]);
  }

  // constrained pairs: green met / red missing / orange avoid-violated
  for (const key of Object.keys(adjacency)) {
    const [idA, idB] = key.split(':').map(Number);
    const a = rooms.findIndex((r) => r.id === idA);
    const b = rooms.findIndex((r) => r.id === idB);
    if (a < 0 || b < 0 || !pos[a] || !pos[b]) continue;
    const met = achieved.has(a < b ? a * R + b : b * R + a);
    if (adjacency[key] === 1) {
      ctx.strokeStyle = met ? '#4cc38a' : '#e5534b';
      ctx.lineWidth = 2.5;
      ctx.setLineDash(met ? [] : [6, 5]);
    } else {
      if (!met) continue; // avoid + separated = fine, draw nothing
      ctx.strokeStyle = '#d4a72c';
      ctx.lineWidth = 2.5;
      ctx.setLineDash([3, 4]);
    }
    line(ctx, pos[a], pos[b]);
    ctx.setLineDash([]);
  }

  for (let r = 0; r < R; r++) {
    if (!pos[r]) continue;
    ctx.fillStyle = rooms[r].color;
    ctx.strokeStyle = '#14161a';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(pos[r].x, pos[r].y, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
}

function line(ctx, a, b) {
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
}

// ---------- sketched geometry ----------

function drawEnvelope(ctx, fill) {
  if (state.envelope.length < 3) return;
  ctx.beginPath();
  state.envelope.forEach((p, i) => {
    const s = screenFromWorld(p.x, p.y);
    i === 0 ? ctx.moveTo(s.x, s.y) : ctx.lineTo(s.x, s.y);
  });
  ctx.closePath();
  if (fill) {
    ctx.fillStyle = 'rgba(232,234,238,0.06)';
    ctx.fill();
  }
  ctx.strokeStyle = COLOR_ENVELOPE;
  ctx.lineWidth = Math.max(2, editor.camera.scale * 0.22);
  ctx.lineJoin = 'miter';
  ctx.stroke();
}

function drawCores(ctx) {
  for (const c of state.cores) {
    const a = screenFromWorld(c.x, c.y);
    const b = screenFromWorld(c.x + c.w, c.y + c.h);
    ctx.fillStyle = COLOR_CORE;
    ctx.fillRect(a.x, a.y, b.x - a.x, b.y - a.y);
    ctx.strokeStyle = '#565d6b';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
    ctx.moveTo(b.x, a.y); ctx.lineTo(a.x, b.y);
    ctx.stroke();
  }
  if (editor.coreDraft) {
    const { a: ca, b: cb } = editor.coreDraft;
    const a = screenFromWorld(Math.min(ca.x, cb.x), Math.min(ca.y, cb.y));
    const b = screenFromWorld(Math.max(ca.x, cb.x), Math.max(ca.y, cb.y));
    ctx.strokeStyle = COLOR_GUIDE;
    ctx.setLineDash([5, 4]);
    ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
    ctx.setLineDash([]);
  }
}

function drawEntrance(ctx) {
  const drawMarker = (pt, ghost) => {
    const p = screenFromWorld(pt.x, pt.y);
    ctx.fillStyle = ghost ? 'rgba(79,140,255,0.5)' : '#4f8cff';
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 9px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('IN', p.x, p.y + 3);
    ctx.textAlign = 'left';
  };
  if (state.entrance) drawMarker(state.entrance, false);
  if (state.tool === 'entrance' && editor.cursor) drawMarker(editor.cursor, true);
}

function drawSketch(ctx) {
  if (state.tool !== 'envelope') return;
  const pts = editor.sketch;
  if (pts.length === 0 && !editor.cursor) return;

  ctx.strokeStyle = COLOR_GUIDE;
  ctx.lineWidth = 2;
  ctx.beginPath();
  pts.forEach((p, i) => {
    const s = screenFromWorld(p.x, p.y);
    i === 0 ? ctx.moveTo(s.x, s.y) : ctx.lineTo(s.x, s.y);
  });
  if (editor.cursor && pts.length > 0) {
    const c = screenFromWorld(editor.cursor.x, editor.cursor.y);
    ctx.lineTo(c.x, c.y);
  }
  ctx.stroke();

  for (const [i, p] of pts.entries()) {
    const s = screenFromWorld(p.x, p.y);
    ctx.fillStyle = i === 0 ? '#fff' : COLOR_GUIDE;
    ctx.beginPath();
    ctx.arc(s.x, s.y, i === 0 ? 5 : 3.5, 0, Math.PI * 2);
    ctx.fill();
  }

  // live segment length
  if (editor.cursor && pts.length > 0) {
    const last = pts[pts.length - 1];
    const len = dist(last, editor.cursor);
    const mid = screenFromWorld((last.x + editor.cursor.x) / 2, (last.y + editor.cursor.y) / 2);
    ctx.fillStyle = '#9ec1ff';
    ctx.font = '11px sans-serif';
    ctx.fillText(`${len.toFixed(2)} m`, mid.x + 8, mid.y - 8);
  }
}

function drawGuides(ctx) {
  const wpx = ctx.canvas.clientWidth, hpx = ctx.canvas.clientHeight;
  for (const g of editor.guides) {
    ctx.strokeStyle = 'rgba(79,140,255,0.55)';
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1;
    if (g.type === 'v') {
      const s = screenFromWorld(g.x, 0);
      ctx.beginPath(); ctx.moveTo(s.x, 0); ctx.lineTo(s.x, hpx); ctx.stroke();
    } else if (g.type === 'h') {
      const s = screenFromWorld(0, g.y);
      ctx.beginPath(); ctx.moveTo(0, s.y); ctx.lineTo(wpx, s.y); ctx.stroke();
    } else if (g.type === 'vertex') {
      const s = screenFromWorld(g.x, g.y);
      ctx.beginPath(); ctx.arc(s.x, s.y, 9, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.setLineDash([]);
  }
}

function drawHandles(ctx) {
  if (state.tool !== 'select') return;
  for (const [i, p] of state.envelope.entries()) {
    const s = screenFromWorld(p.x, p.y);
    const hot = (editor.hover?.kind === 'vertex' && editor.hover.index === i) ||
                (editor.selection?.kind === 'vertex' && editor.selection.index === i);
    ctx.fillStyle = hot ? COLOR_GUIDE : '#14161a';
    ctx.strokeStyle = hot ? '#fff' : COLOR_ENVELOPE;
    ctx.lineWidth = 1.5;
    ctx.fillRect(s.x - 4, s.y - 4, 8, 8);
    ctx.strokeRect(s.x - 4, s.y - 4, 8, 8);
  }
  for (const c of state.cores) {
    for (const [cx, cy] of [[c.x, c.y], [c.x + c.w, c.y], [c.x + c.w, c.y + c.h], [c.x, c.y + c.h]]) {
      const s = screenFromWorld(cx, cy);
      ctx.fillStyle = '#14161a';
      ctx.strokeStyle = '#8b93a3';
      ctx.beginPath();
      ctx.arc(s.x, s.y, 3.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }
}

function drawDimensions(ctx) {
  if (state.envelope.length < 3) return;
  ctx.fillStyle = '#8b93a3';
  ctx.font = '10.5px sans-serif';
  ctx.textAlign = 'center';
  const n = state.envelope.length;
  for (let i = 0; i < n; i++) {
    const a = state.envelope[i];
    const b = state.envelope[(i + 1) % n];
    const len = dist(a, b);
    if (len < 0.8) continue;
    // offset label outward along the edge normal
    const nx = (b.y - a.y) / len, ny = -(b.x - a.x) / len;
    const mid = { x: (a.x + b.x) / 2 + nx * 0.7, y: (a.y + b.y) / 2 + ny * 0.7 };
    const inside = isInsideEnvelope(mid);
    const m = {
      x: (a.x + b.x) / 2 + nx * (inside ? -0.7 : 0.7),
      y: (a.y + b.y) / 2 + ny * (inside ? -0.7 : 0.7),
    };
    const s = screenFromWorld(m.x, m.y);
    ctx.fillText(`${len.toFixed(1)}`, s.x, s.y + 3);
  }
  ctx.textAlign = 'left';
}

function isInsideEnvelope(p) {
  let inside = false;
  const poly = state.envelope;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    if (((poly[i].y > p.y) !== (poly[j].y > p.y)) &&
        (p.x < ((poly[j].x - poly[i].x) * (p.y - poly[i].y)) / (poly[j].y - poly[i].y) + poly[i].x)) {
      inside = !inside;
    }
  }
  return inside;
}

// ---------- offscreen rendering (thumbnails / compare) ----------

export function renderSolutionToCanvas(canvas, sol, grid, rooms, { showLabels = false, furniture = true } = {}) {
  const ctx = canvas.getContext('2d');
  const { W, H, ox, oy, cellSize } = grid;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const pad = 8;
  const scale = Math.min((canvas.width - pad * 2) / (W * cellSize), (canvas.height - pad * 2) / (H * cellSize));
  const tx = (canvas.width - W * cellSize * scale) / 2;
  const ty = (canvas.height - H * cellSize * scale) / 2;
  const P = (x, y) => ({ x: tx + (x - ox) * scale, y: ty + (y - oy) * scale });

  drawPlan(ctx, sol, grid, rooms, P, scale, { furniture });

  if (showLabels) {
    ctx.textAlign = 'center';
    for (let r = 0; r < rooms.length; r++) {
      const c = sol.centroids[r];
      if (!c) continue;
      const p = P(c.x, c.y);
      ctx.fillStyle = '#1a1d22';
      ctx.font = '600 11px sans-serif';
      ctx.fillText(rooms[r].name, p.x, p.y);
      ctx.font = '10px sans-serif';
      ctx.fillText(`${sol.areas[r].toFixed(1)} m²`, p.x, p.y + 12);
    }
    ctx.textAlign = 'left';
  }
}
