// Rule-based auto-furnishing: places each room's required furniture families
// against walls / in corners / freestanding, honoring clearances, door swing
// zones, window conflicts and snap preferences (wet walls, windows, pairing).
import { INSIDE } from './grid.js';
import { ROOM_TYPES } from '../program.js';
import { openingRect } from './openings.js';
import { roomWallRuns, wallRect, wallFaceInset } from './walls.js';

const STEP = 0.3; // candidate spacing along walls, m

/**
 * @returns { items, scorePerRoom, issues }
 *   item: { familyId, room, rect:{x,y,w,h}, facing:{nx,ny}, modules? }
 */
export function furnish(labels, grid, rooms, walls, doors, windows, catalog) {
  const items = [];
  const issues = [];
  const scorePerRoom = [];

  // global blocked zones: door clearances + a passage strip on the other side
  const doorZones = doors.map((d) => d.clearance).concat(
    doors.map((d) => openingRect(d, 0.45)),
  );

  for (let r = 0; r < rooms.length; r++) {
    const type = ROOM_TYPES[rooms[r].type] || ROOM_TYPES.living;
    const wanted = type.furniture
      .map((id) => catalog.get(id))
      .filter(Boolean);
    if (wanted.length === 0) { scorePerRoom.push(1); continue; }

    const ctx = {
      room: r, labels, grid, rooms,
      runs: roomWallRuns(walls, r),
      doorZones,
      wallRects: walls
        .filter((w) => w.sideA === r || w.sideB === r)
        .map((w) => wallRect(w)),
      windows: windows.filter((w) => w.room === r),
      solids: [],      // placed furniture rects
      clearzones: [],  // their required front clearances
      placed: [],
    };

    let placedCount = 0;
    for (const fam of wanted) {
      const item = fam.id === 'kitchen-run'
        ? placeKitchenRun(fam, ctx)
        : placeFamily(fam, ctx);
      if (item) {
        items.push(item);
        ctx.placed.push(item);
        placedCount++;
      } else {
        issues.push(`${rooms[r].name}: no valid spot for ${fam.name.toLowerCase()}`);
      }
    }
    scorePerRoom.push(placedCount / wanted.length);
  }

  return { items, scorePerRoom, issues };
}

// ---------- generic placement ----------

function placeFamily(fam, ctx) {
  let best = null, bestScore = -Infinity;

  if (fam.placement === 'free') {
    const cand = freeCandidates(fam, ctx);
    for (const c of cand) {
      const s = scoreCandidate(fam, c, ctx);
      if (s > bestScore && validPose(fam, c, ctx)) { bestScore = s; best = c; }
    }
  } else {
    const endGap = fam.endGap ?? 0.05;
    for (const run of ctx.runs) {
      const L = run.wall.len;
      if (L < fam.w + 2 * endGap) continue;
      const positions = fam.placement === 'corner'
        ? [endGap, L - fam.w - endGap]
        : rangePositions(L, fam.w, endGap);
      for (const t of positions) {
        if (t < 0) continue;
        const c = poseOnRun(run, t, fam);
        const s = scoreCandidate(fam, c, ctx) + runPreference(fam, run, ctx);
        if (s > bestScore && validPose(fam, c, ctx)) { bestScore = s; best = c; }
      }
    }
  }

  if (!best) return null;
  const item = {
    familyId: fam.id, room: ctx.room,
    rect: best.rect, facing: best.facing,
  };
  ctx.solids.push(best.rect);
  ctx.clearzones.push(frontRect(best, fam.clearFront));
  return item;
}

function rangePositions(L, w, endGap = 0.05) {
  const out = [];
  for (let t = endGap; t <= L - w - endGap; t += STEP) out.push(t);
  return out;
}

/** Pose for family back against a wall run at offset t (at the wall's inner
 *  face plus the family's optional wallGap). */
function poseOnRun(run, t, fam) {
  const w = run.wall;
  const inset = wallFaceInset(w) + (fam.wallGap || 0);
  let rect;
  if (w.horizontal) {
    const y = run.ny > 0 ? w.y1 + inset : w.y1 - inset - fam.d;
    rect = { x: w.x1 + t, y, w: fam.w, h: fam.d };
  } else {
    const x = run.nx > 0 ? w.x1 + inset : w.x1 - inset - fam.d;
    rect = { x, y: w.y1 + t, w: fam.d, h: fam.w };
  }
  return { rect, facing: { nx: run.nx, ny: run.ny }, run, t };
}

function freeCandidates(fam, ctx) {
  const out = [];
  // near:<id> companion: directly in front of the referenced item
  const nearPref = fam.prefer.find((p) => p.startsWith('near:'));
  if (nearPref) {
    const target = ctx.placed.find((p) => p.familyId === nearPref.slice(5));
    if (target) {
      const gap = 0.45;
      const cx = target.rect.x + target.rect.w / 2 + target.facing.nx * (target.rect.w / 2 + gap + fam.d / 2);
      const cy = target.rect.y + target.rect.h / 2 + target.facing.ny * (target.rect.h / 2 + gap + fam.d / 2);
      const horiz = target.facing.ny !== 0;
      out.push({
        rect: horiz
          ? { x: cx - fam.w / 2, y: cy - fam.d / 2, w: fam.w, h: fam.d }
          : { x: cx - fam.d / 2, y: cy - fam.w / 2, w: fam.d, h: fam.w },
        facing: { nx: -target.facing.nx, ny: -target.facing.ny },
      });
    }
  }
  // coarse scan over the room
  const { grid } = ctx;
  const cs = grid.cellSize;
  for (let j = 0; j < grid.H; j += 2) {
    for (let i = 0; i < grid.W; i += 2) {
      if (ctx.labels[j * grid.W + i] !== ctx.room) continue;
      const cx = grid.ox + (i + 0.5) * cs;
      const cy = grid.oy + (j + 0.5) * cs;
      out.push({ rect: { x: cx - fam.w / 2, y: cy - fam.d / 2, w: fam.w, h: fam.d }, facing: { nx: 0, ny: 1 } });
    }
  }
  return out;
}

function frontRect(pose, depth) {
  const r = pose.rect, f = pose.facing;
  if (f.ny > 0) return { x: r.x, y: r.y + r.h, w: r.w, h: depth };
  if (f.ny < 0) return { x: r.x, y: r.y - depth, w: r.w, h: depth };
  if (f.nx > 0) return { x: r.x + r.w, y: r.y, w: depth, h: r.h };
  return { x: r.x - depth, y: r.y, w: depth, h: r.h };
}

/** The two strips beside the item along its wall axis (free-space-at-sides rule). */
function sideStrips(pose, side) {
  const r = pose.rect, f = pose.facing;
  if (side <= 0) return [];
  if (f.ny !== 0) {
    return [
      { x: r.x - side, y: r.y, w: side, h: r.h },
      { x: r.x + r.w, y: r.y, w: side, h: r.h },
    ];
  }
  return [
    { x: r.x, y: r.y - side, w: r.w, h: side },
    { x: r.x, y: r.y + r.h, w: r.w, h: side },
  ];
}

function validPose(fam, pose, ctx) {
  const r = pose.rect;
  if (!rectInRoom(r, ctx)) return false;
  const fr = frontRect(pose, fam.clearFront);
  const strips = sideStrips(pose, fam.clearSide);

  // never intersect the wall poché itself (exterior walls sit inward of the
  // line); required side gaps must be wall-free too — no jamming into corners
  for (const wr of ctx.wallRects) {
    if (overlap(r, wr)) return false;
    for (const strip of strips) {
      if (overlap(strip, wr)) return false;
    }
  }
  // required free space must lie inside the room (keeps beds out of corners,
  // passage in front of wardrobes, etc.)
  if (fr && fam.clearFront > 0.05 && !rectInRoom(shrink(fr, 0.02), ctx)) return false;
  for (const strip of strips) {
    if (!rectInRoom(shrink(strip, 0.02), ctx)) return false;
  }

  for (const z of ctx.doorZones) {
    if (overlap(r, z)) return false;             // never block a door
    if (fr && overlap(fr, z)) return false;      // keep approach free
  }
  for (const s of ctx.solids) {
    if (overlap(r, s)) return false;
    if (fr && overlap(fr, s)) return false;
    for (const strip of strips) {
      if (overlap(strip, s)) return false;
    }
  }
  for (const c of ctx.clearzones) {
    if (overlap(r, c)) return false;             // don't sit in others' clearance
  }
  // tall furniture cannot stand in front of a window
  if (fam.h > 0.95) {
    for (const win of ctx.windows) {
      if (overlap(r, openingRect(win, 0.3))) return false;
    }
  }
  return true;
}

function shrink(r, by) {
  return { x: r.x + by, y: r.y + by, w: Math.max(0.01, r.w - 2 * by), h: Math.max(0.01, r.h - 2 * by) };
}

function rectInRoom(r, ctx) {
  const { grid, labels, room } = ctx;
  const pts = [
    [r.x + 0.03, r.y + 0.03], [r.x + r.w - 0.03, r.y + 0.03],
    [r.x + 0.03, r.y + r.h - 0.03], [r.x + r.w - 0.03, r.y + r.h - 0.03],
    [r.x + r.w / 2, r.y + r.h / 2],
  ];
  for (const [x, y] of pts) {
    const i = Math.floor((x - grid.ox) / grid.cellSize);
    const j = Math.floor((y - grid.oy) / grid.cellSize);
    if (i < 0 || j < 0 || i >= grid.W || j >= grid.H) return false;
    const idx = j * grid.W + i;
    if (grid.kinds[idx] !== INSIDE || labels[idx] !== room) return false;
  }
  return true;
}

function overlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function scoreCandidate(fam, pose, ctx) {
  let s = 0;
  const c = center(pose.rect);
  // distance to nearest door (capped) — most furniture prefers to be away
  let dMin = Infinity;
  for (const z of ctx.doorZones) {
    dMin = Math.min(dMin, Math.hypot(c.x - (z.x + z.w / 2), c.y - (z.y + z.h / 2)));
  }
  if (fam.prefer.includes('far-from-door')) s += Math.min(dMin, 3.5);
  else s += Math.min(dMin, 1.5) * 0.3;

  // faces:<id> pairing (tv ↔ sofa): reward facing alignment at 2–4.5 m
  const facesPref = fam.prefer.find((p) => p.startsWith('faces:'));
  if (facesPref) {
    const target = ctx.placed.find((p) => p.familyId === facesPref.slice(6));
    if (target) {
      const tc = center(target.rect);
      const d = Math.hypot(c.x - tc.x, c.y - tc.y);
      const opposite = pose.facing.nx === -target.facing.nx && pose.facing.ny === -target.facing.ny;
      const lateral = target.facing.ny !== 0 ? Math.abs(c.x - tc.x) : Math.abs(c.y - tc.y);
      if (opposite && d > 1.8 && d < 5) s += 6 - lateral * 2;
      else s -= 4;
    }
  }
  return s;
}

function runPreference(fam, run, ctx) {
  let s = run.wall.len * 0.15; // longer walls are calmer
  const wet = isWetWall(run.wall, ctx.rooms);
  const hasWin = ctx.windows.some((w) => w.wall === run.wall);
  for (const p of fam.prefer) {
    if (p === 'wet-wall' && wet) s += 4;
    if (p === 'window' && hasWin) s += 3;
    if (p === 'no-window' && hasWin) s -= 3;
  }
  return s;
}

function isWetWall(wall, rooms) {
  for (const side of [wall.sideA, wall.sideB]) {
    if (side === -2) return true; // core: shafts live here
    if (side >= 0) {
      const t = ROOM_TYPES[rooms[side].type];
      if (t && t.wet) return true;
    }
  }
  return false;
}

function center(r) { return { x: r.x + r.w / 2, y: r.y + r.h / 2 }; }

// ---------- kitchen run (straight or L-shaped counter) ----------

function placeKitchenRun(fam, ctx) {
  const need = fam.runLength || 3.0;
  const runs = ctx.runs
    .filter((run) => run.wall.len >= 1.2)
    .sort((a, b) => (runPreference(fam, b, ctx) + b.wall.len) - (runPreference(fam, a, ctx) + a.wall.len));

  for (const run of runs) {
    const L = Math.min(run.wall.len - 0.1, Math.max(need, 1.8));
    const pose = poseOnRun(run, Math.max(0.05, (run.wall.len - L) / 2), { ...fam, w: L });
    pose.rect = run.wall.horizontal
      ? { ...pose.rect, w: L, h: fam.d }
      : { ...pose.rect, w: fam.d, h: L };
    if (!validPose({ ...fam, w: L }, pose, ctx)) continue;

    ctx.solids.push(pose.rect);
    ctx.clearzones.push(frontRect(pose, fam.clearFront));

    // work-zone modules along the counter: sink (under window if any), hob, fridge
    const win = ctx.windows.find((w) => w.wall === run.wall);
    const sinkT = win ? Math.max(0.3, Math.min(L - 0.6, win.t - pose.t)) : L * 0.25;
    const modules = [
      { type: 'sink', t: sinkT },
      { type: 'hob', t: Math.min(L - 0.7, sinkT + Math.max(1.0, L * 0.35)) },
      { type: 'fridge', t: L - 0.35 },
    ];
    return { familyId: fam.id, room: ctx.room, rect: pose.rect, facing: pose.facing, modules, runT: pose.t };
  }
  return null;
}
