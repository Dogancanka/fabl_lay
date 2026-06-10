// Architectural 2D plan drawing, shared by the main canvas, thumbnails and
// the compare view. Renders floor tints, walls with real thickness, door
// swings, window symbols and furniture symbols from the synthesized plan.
// All drawing goes through P(x, y) -> screen point and `s` (px per meter).

import { wallRect } from './solver/walls.js';
export { wallRect };

const WALL_COLOR = '#23262c';
const PAPER = '#ffffff';

export function lighten(hex, amt = 0.5) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const mix = (c) => Math.round(c + (255 - c) * amt);
  return `rgb(${mix(r)},${mix(g)},${mix(b)})`;
}

export function drawPlan(ctx, sol, grid, rooms, P, s, opts = {}) {
  const { W, H, ox, oy, cellSize: cs } = grid;
  const hidden = opts.hiddenFamilies;

  // --- floor tints from the straightened cell labels
  if (opts.rooms !== false) {
    for (let j = 0; j < H; j++) {
      for (let i = 0; i < W; i++) {
        const idx = j * W + i;
        const r = sol.labels[idx];
        const kind = grid.kinds[idx];
        if (r < 0 && kind !== 2) continue;
        const p = P(ox + i * cs, oy + j * cs);
        ctx.fillStyle = kind === 2 ? '#565d6b' : lighten(rooms[r]?.color || '#999', 0.55);
        ctx.fillRect(p.x, p.y, cs * s + 0.6, cs * s + 0.6);
      }
    }
  }

  // --- walls with thickness (exterior drawn inward, interior centered)
  if (opts.walls !== false) {
    ctx.fillStyle = WALL_COLOR;
    for (const w of sol.walls || []) {
      const rect = wallRect(w);
      const a = P(rect.x, rect.y);
      ctx.fillRect(a.x, a.y, rect.w * s, rect.h * s);
    }
    // openings: erase the wall, then draw the symbol
    if (opts.doors !== false) for (const d of sol.doors || []) drawDoor(ctx, d, P, s);
    if (opts.windows !== false) for (const win of sol.windows || []) drawWindow(ctx, win, P, s);
  }

  // --- furniture
  if (opts.furniture !== false) {
    for (const f of sol.furniture || []) {
      if (hidden && hidden.has(f.familyId)) continue;
      drawFurniture(ctx, f, P, s);
    }
  }
}

function openingSpanRect(o) {
  const wr = wallRect(o.wall);
  const half = o.width / 2;
  if (o.wall.horizontal) {
    return { x: o.wall.x1 + o.t - half, y: wr.y - 0.01, w: o.width, h: wr.h + 0.02 };
  }
  return { x: wr.x - 0.01, y: o.wall.y1 + o.t - half, w: wr.w + 0.02, h: o.width };
}

function drawDoor(ctx, d, P, s) {
  const span = openingSpanRect(d);
  const a = P(span.x, span.y);
  ctx.fillStyle = PAPER;
  ctx.fillRect(a.x, a.y, span.w * s, span.h * s);

  if (d.kind === 'opening') {
    // cased opening: dashed lines across the gap
    ctx.strokeStyle = WALL_COLOR;
    ctx.lineWidth = Math.max(0.75, 0.02 * s);
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    if (d.wall.horizontal) {
      const y = P(0, d.wall.y1).y;
      ctx.moveTo(a.x, y); ctx.lineTo(a.x + span.w * s, y);
    } else {
      const x = P(d.wall.x1, 0).x;
      ctx.moveTo(x, a.y); ctx.lineTo(x, a.y + span.h * s);
    }
    ctx.stroke();
    ctx.setLineDash([]);
    return;
  }

  // leaf + quarter-circle swing arc
  const w = d.wall;
  const width = d.width;
  ctx.strokeStyle = '#3a3f49';
  ctx.lineWidth = Math.max(1, 0.035 * s);
  if (w.horizontal) {
    const swingUp = d.clearance.y < w.y1; // opens toward smaller y
    const hingeX = w.x1 + d.t - width / 2;
    const hinge = P(hingeX, w.y1);
    const dir = swingUp ? -1 : 1;
    ctx.beginPath();
    ctx.moveTo(hinge.x, hinge.y);
    ctx.lineTo(hinge.x, hinge.y + dir * width * s);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(hinge.x, hinge.y, width * s, dir > 0 ? 0 : -Math.PI / 2, dir > 0 ? Math.PI / 2 : 0);
    ctx.stroke();
  } else {
    const swingLeft = d.clearance.x < w.x1;
    const hingeY = w.y1 + d.t - width / 2;
    const hinge = P(w.x1, hingeY);
    const dir = swingLeft ? -1 : 1;
    ctx.beginPath();
    ctx.moveTo(hinge.x, hinge.y);
    ctx.lineTo(hinge.x + dir * width * s, hinge.y);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(hinge.x, hinge.y, width * s, dir > 0 ? 0 : Math.PI / 2, dir > 0 ? Math.PI / 2 : Math.PI);
    ctx.stroke();
  }
}

function drawWindow(ctx, win, P, s) {
  const span = openingSpanRect(win);
  const a = P(span.x, span.y);
  ctx.fillStyle = PAPER;
  ctx.fillRect(a.x, a.y, span.w * s, span.h * s);
  ctx.strokeStyle = '#3a6ea8';
  ctx.lineWidth = Math.max(0.75, 0.02 * s);
  ctx.beginPath();
  if (win.wall.horizontal) {
    for (const f of [0.15, 0.5, 0.85]) {
      const y = a.y + span.h * s * f;
      ctx.moveTo(a.x, y); ctx.lineTo(a.x + span.w * s, y);
    }
  } else {
    for (const f of [0.15, 0.5, 0.85]) {
      const x = a.x + span.w * s * f;
      ctx.moveTo(x, a.y); ctx.lineTo(x, a.y + span.h * s);
    }
  }
  ctx.stroke();
}

// ---------- furniture symbols ----------

const FAMILY_SYMBOLS = new Map(); // filled lazily from catalog by the caller
export function setSymbolCatalog(catalog) {
  FAMILY_SYMBOLS.clear();
  for (const [id, fam] of catalog) FAMILY_SYMBOLS.set(id, fam);
}

function drawFurniture(ctx, f, P, s) {
  const fam = FAMILY_SYMBOLS.get(f.familyId);
  const r = f.rect;
  const a = P(r.x, r.y);
  const w = r.w * s, h = r.h * s;
  ctx.fillStyle = fam ? lighten(fam.color, 0.25) : '#ddd';
  ctx.strokeStyle = '#4a505b';
  ctx.lineWidth = Math.max(0.75, 0.022 * s);
  ctx.fillRect(a.x, a.y, w, h);
  ctx.strokeRect(a.x, a.y, w, h);

  const sym = fam?.symbol || 'generic';
  const horizFace = f.facing.ny !== 0; // faces up/down
  ctx.beginPath();
  switch (sym) {
    case 'bed': {
      // pillow strip at the head (opposite the facing side)
      const ph = 0.35 * s;
      if (f.facing.ny > 0) ctx.rect(a.x + 2, a.y + 2, w - 4, ph);
      else if (f.facing.ny < 0) ctx.rect(a.x + 2, a.y + h - ph - 2, w - 4, ph);
      else if (f.facing.nx > 0) ctx.rect(a.x + 2, a.y + 2, ph, h - 4);
      else ctx.rect(a.x + w - ph - 2, a.y + 2, ph, h - 4);
      ctx.stroke();
      break;
    }
    case 'sofa': {
      const bh = 0.22 * s;
      if (f.facing.ny > 0) ctx.rect(a.x, a.y, w, bh);
      else if (f.facing.ny < 0) ctx.rect(a.x, a.y + h - bh, w, bh);
      else if (f.facing.nx > 0) ctx.rect(a.x, a.y, bh, h);
      else ctx.rect(a.x + w - bh, a.y, bh, h);
      ctx.stroke();
      break;
    }
    case 'tv':
      ctx.moveTo(a.x + w * 0.15, a.y + h / 2);
      ctx.lineTo(a.x + w * 0.85, a.y + h / 2);
      ctx.stroke();
      break;
    case 'table': {
      ctx.stroke();
      // chairs on the long sides
      const n = Math.max(1, Math.round((horizFace ? w : h) / (0.65 * s)));
      ctx.fillStyle = 'rgba(74,80,91,0.25)';
      for (let k = 0; k < n; k++) {
        const cw = 0.4 * s;
        if (horizFace) {
          const cx = a.x + ((k + 0.5) / n) * w - cw / 2;
          ctx.fillRect(cx, a.y - cw - 1, cw, cw);
          ctx.fillRect(cx, a.y + h + 1, cw, cw);
        } else {
          const cy = a.y + ((k + 0.5) / n) * h - cw / 2;
          ctx.fillRect(a.x - cw - 1, cy, cw, cw);
          ctx.fillRect(a.x + w + 1, cy, cw, cw);
        }
      }
      break;
    }
    case 'toilet': {
      ctx.stroke();
      const cx = a.x + w / 2, cy = a.y + h / 2;
      ctx.beginPath();
      ctx.ellipse(cx + f.facing.nx * w * 0.12, cy + f.facing.ny * h * 0.12,
        Math.min(w, h) * 0.32, Math.min(w, h) * 0.42,
        f.facing.nx !== 0 ? Math.PI / 2 : 0, 0, Math.PI * 2);
      ctx.stroke();
      break;
    }
    case 'sink':
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(a.x + w / 2, a.y + h / 2, w * 0.3, h * 0.3, 0, 0, Math.PI * 2);
      ctx.stroke();
      break;
    case 'shower':
      ctx.moveTo(a.x, a.y); ctx.lineTo(a.x + w, a.y + h);
      ctx.moveTo(a.x + w, a.y); ctx.lineTo(a.x, a.y + h);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(a.x + w / 2, a.y + h / 2, Math.min(w, h) * 0.12, 0, Math.PI * 2);
      ctx.stroke();
      break;
    case 'wardrobe':
      ctx.moveTo(a.x, a.y + h / 2); ctx.lineTo(a.x + w, a.y + h / 2);
      if (horizFace) { ctx.moveTo(a.x + w / 2, a.y); ctx.lineTo(a.x + w / 2, a.y + h); }
      ctx.stroke();
      break;
    case 'counter': {
      ctx.stroke();
      // modules along the run: sink, hob, fridge
      const along = r.w >= r.h; // counter runs along x
      for (const m of f.modules || []) {
        const t = m.t * s;
        const cx = along ? a.x + t : a.x + w / 2;
        const cy = along ? a.y + h / 2 : a.y + t;
        ctx.beginPath();
        if (m.type === 'sink') {
          ctx.rect(cx - 0.22 * s, cy - 0.18 * s, 0.44 * s, 0.36 * s);
        } else if (m.type === 'hob') {
          for (const [dx, dy] of [[-0.12, -0.1], [0.12, -0.1], [-0.12, 0.1], [0.12, 0.1]]) {
            ctx.moveTo(cx + dx * s + 0.07 * s, cy + dy * s);
            ctx.arc(cx + dx * s, cy + dy * s, 0.07 * s, 0, Math.PI * 2);
          }
        } else if (m.type === 'fridge') {
          ctx.rect(cx - 0.28 * s, cy - 0.25 * s, 0.56 * s, 0.5 * s);
          ctx.moveTo(cx - 0.28 * s, cy - 0.25 * s);
          ctx.lineTo(cx + 0.28 * s, cy + 0.25 * s);
        }
        ctx.stroke();
      }
      break;
    }
    case 'desk': {
      ctx.stroke();
      ctx.fillStyle = 'rgba(74,80,91,0.25)';
      const cw = 0.42 * s;
      const cx = a.x + w / 2 + f.facing.nx * (w / 2 + 2);
      const cy = a.y + h / 2 + f.facing.ny * (h / 2 + 2);
      ctx.fillRect(cx - cw / 2 + (f.facing.nx > 0 ? cw / 2 : f.facing.nx < 0 ? -cw / 2 : 0) * 0,
        cy - cw / 2, cw, cw);
      break;
    }
    default:
      ctx.moveTo(a.x, a.y); ctx.lineTo(a.x + w, a.y + h);
      ctx.stroke();
  }
}
