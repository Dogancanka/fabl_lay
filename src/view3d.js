// Dependency-free 3D validation view: axonometric projection of the
// synthesized plan — walls at real height with door/window openings, room
// floor slabs, cores and furniture volumes — rendered with a painter's
// algorithm on Canvas 2D. One finger/mouse orbits, wheel or pinch zooms.
import { wallRect, lighten } from './render-plan.js';
import { WALL_HEIGHT, DOOR_HEIGHT, WINDOW_SILL, WINDOW_HEAD } from './solver/walls.js';

export const cam3d = { yaw: 0.7, pitch: 1.05, zoom: 28, panX: 0, panY: 40 };

let sceneCache = null;
let sceneKey = null;

export function invalidateScene() { sceneKey = null; }

export function renderView3D(canvas, sol, grid, rooms, catalog) {
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const wpx = canvas.clientWidth, hpx = canvas.clientHeight;
  if (canvas.width !== wpx * dpr || canvas.height !== hpx * dpr) {
    canvas.width = wpx * dpr;
    canvas.height = hpx * dpr;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#101216';
  ctx.fillRect(0, 0, wpx, hpx);

  if (!sol || !grid) {
    ctx.fillStyle = '#9aa1ad';
    ctx.font = '13px sans-serif';
    ctx.fillText('No solution yet — sketch an envelope in 2D.', 20, 30);
    return;
  }

  if (sceneKey !== sol) {
    sceneCache = buildScene(sol, grid, rooms, catalog);
    sceneKey = sol;
  }

  const { faces, center } = sceneCache;
  const cy = Math.cos(cam3d.yaw), sy = Math.sin(cam3d.yaw);
  const cp = Math.cos(cam3d.pitch), sp = Math.sin(cam3d.pitch);
  const z = cam3d.zoom;
  const cx0 = wpx / 2 + cam3d.panX, cy0 = hpx / 2 + cam3d.panY;

  const project = (p) => {
    const x = p[0] - center.x, y = p[1] - center.y;
    const rx = x * cy - y * sy;
    const ry = x * sy + y * cy;
    return {
      x: cx0 + rx * z,
      y: cy0 + ry * cp * z - p[2] * sp * z,
      d: ry * sp + p[2] * cp,
    };
  };

  // project + sort back-to-front
  const drawList = [];
  for (const f of faces) {
    const pts = f.pts.map(project);
    let d = 0;
    for (const p of pts) d += p.d;
    drawList.push({ pts, d: d / pts.length, color: f.color, alpha: f.alpha, stroke: f.stroke });
  }
  drawList.sort((a, b) => a.d - b.d);

  for (const f of drawList) {
    ctx.beginPath();
    f.pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.closePath();
    ctx.globalAlpha = f.alpha ?? 1;
    ctx.fillStyle = f.color;
    ctx.fill();
    if (f.stroke) {
      ctx.strokeStyle = f.stroke;
      ctx.lineWidth = 0.75;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
}

// ---------- scene construction ----------

function buildScene(sol, grid, rooms, catalog) {
  const faces = [];
  const { W, H, ox, oy, cellSize: cs } = grid;

  // room floor slabs: merge cell rows into quads
  for (let j = 0; j < H; j++) {
    let runStart = -1, runRoom = -1;
    for (let i = 0; i <= W; i++) {
      const r = i < W ? sol.labels[j * W + i] : -1;
      if (r === runRoom) continue;
      if (runRoom >= 0) {
        const x1 = ox + runStart * cs, x2 = ox + i * cs;
        const y1 = oy + j * cs, y2 = oy + (j + 1) * cs;
        faces.push({
          pts: [[x1, y1, 0], [x2, y1, 0], [x2, y2, 0], [x1, y2, 0]],
          color: lighten(rooms[runRoom]?.color || '#999', 0.45),
        });
      }
      runStart = i; runRoom = r;
    }
  }

  // walls with openings
  for (const w of sol.walls || []) {
    const rect = wallRect(w);
    const openings = [
      ...(sol.doors || []).filter((d) => d.wall === w).map((d) => ({
        t0: d.t - d.width / 2, t1: d.t + d.width / 2,
        z0: 0, z1: d.kind === 'opening' ? DOOR_HEIGHT : DOOR_HEIGHT, window: false,
      })),
      ...(sol.windows || []).filter((win) => win.wall === w).map((win) => ({
        t0: win.t - win.width / 2, t1: win.t + win.width / 2,
        z0: WINDOW_SILL, z1: WINDOW_HEAD, window: true,
      })),
    ].sort((a, b) => a.t0 - b.t0);

    const color = w.type === 'exterior' ? '#dadde2' : w.type === 'core' ? '#8b93a3' : '#e8e8e4';
    const segs = [];
    let cursor = 0;
    const L = w.len;
    for (const o of openings) {
      if (o.t0 > cursor + 0.02) segs.push({ t0: cursor, t1: o.t0, z0: 0, z1: WALL_HEIGHT });
      if (o.z0 > 0.02) segs.push({ t0: o.t0, t1: o.t1, z0: 0, z1: o.z0 });        // sill below window
      segs.push({ t0: o.t0, t1: o.t1, z0: o.z1, z1: WALL_HEIGHT });                // lintel above
      if (o.window) segs.push({ t0: o.t0, t1: o.t1, z0: o.z0, z1: o.z1, glass: true });
      cursor = Math.max(cursor, o.t1);
    }
    if (cursor < L - 0.02) segs.push({ t0: cursor, t1: L, z0: 0, z1: WALL_HEIGHT });

    for (const s of segs) {
      const box = w.horizontal
        ? { x: w.x1 + s.t0, y: rect.y, w: s.t1 - s.t0, h: rect.h }
        : { x: rect.x, y: w.y1 + s.t0, w: rect.w, h: s.t1 - s.t0 };
      if (s.glass) {
        addBox(faces, box, s.z0, s.z1, 'rgba(120,180,220,0.45)', null, 0.45);
      } else {
        addBox(faces, box, s.z0, s.z1, color, '#4a505b');
      }
    }
  }

  // core volumes from the grid
  for (let j = 0; j < H; j++) {
    let runStart = -1;
    for (let i = 0; i <= W; i++) {
      const isCore = i < W && grid.kinds[j * W + i] === 2;
      if (isCore && runStart < 0) runStart = i;
      if (!isCore && runStart >= 0) {
        addBox(faces, {
          x: ox + runStart * cs, y: oy + j * cs,
          w: (i - runStart) * cs, h: cs,
        }, 0, WALL_HEIGHT, '#6b7382', null);
        runStart = -1;
      }
    }
  }

  // furniture volumes
  for (const f of sol.furniture || []) {
    const fam = catalog.get(f.familyId);
    addBox(faces, f.rect, 0, fam ? fam.h : 0.7, fam ? fam.color : '#c9c9c9', '#3c424c');
  }

  // scene center for orbiting
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      if (sol.labels[j * W + i] >= 0 || grid.kinds[j * W + i] === 2) {
        minx = Math.min(minx, ox + i * cs); maxx = Math.max(maxx, ox + (i + 1) * cs);
        miny = Math.min(miny, oy + j * cs); maxy = Math.max(maxy, oy + (j + 1) * cs);
      }
    }
  }
  return { faces, center: { x: (minx + maxx) / 2, y: (miny + maxy) / 2 } };
}

function addBox(faces, r, z0, z1, color, stroke, alpha) {
  const shade = (f) => shadeColor(color, f, alpha);
  const x1 = r.x, y1 = r.y, x2 = r.x + r.w, y2 = r.y + r.h;
  // top
  faces.push({ pts: [[x1, y1, z1], [x2, y1, z1], [x2, y2, z1], [x1, y2, z1]], color: shade(1), stroke, alpha });
  // sides
  faces.push({ pts: [[x1, y1, z0], [x2, y1, z0], [x2, y1, z1], [x1, y1, z1]], color: shade(0.72), stroke, alpha });
  faces.push({ pts: [[x1, y2, z0], [x2, y2, z0], [x2, y2, z1], [x1, y2, z1]], color: shade(0.82), stroke, alpha });
  faces.push({ pts: [[x1, y1, z0], [x1, y2, z0], [x1, y2, z1], [x1, y1, z1]], color: shade(0.62), stroke, alpha });
  faces.push({ pts: [[x2, y1, z0], [x2, y2, z0], [x2, y2, z1], [x2, y1, z1]], color: shade(0.9), stroke, alpha });
}

function shadeColor(color, f, alpha) {
  if (color.startsWith('rgba')) return color;
  const n = parseInt(color.slice(1), 16);
  const r = Math.round(((n >> 16) & 255) * f);
  const g = Math.round(((n >> 8) & 255) * f);
  const b = Math.round((n & 255) * f);
  return alpha !== undefined ? `rgba(${r},${g},${b},${alpha})` : `rgb(${r},${g},${b})`;
}

// ---------- interaction ----------

export function initView3D(canvas) {
  const pointers = new Map();
  let pinch0 = null;

  canvas.addEventListener('pointerdown', (e) => {
    try { canvas.setPointerCapture(e.pointerId); } catch { /* synthetic */ }
    pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch0 = { d: Math.hypot(a.x - b.x, a.y - b.y), zoom: cam3d.zoom };
    }
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    const prev = pointers.get(e.pointerId);
    pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
    if (pointers.size === 2 && pinch0) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      cam3d.zoom = Math.max(6, Math.min(120, pinch0.zoom * (d / Math.max(20, pinch0.d))));
      return;
    }
    if (pointers.size === 1) {
      cam3d.yaw += (e.offsetX - prev.x) * 0.008;
      cam3d.pitch = Math.max(0.35, Math.min(1.45, cam3d.pitch + (e.offsetY - prev.y) * 0.005));
    }
  });
  const up = (e) => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch0 = null;
  };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    cam3d.zoom = Math.max(6, Math.min(120, cam3d.zoom * Math.exp(-e.deltaY * 0.0012)));
  }, { passive: false });
}
