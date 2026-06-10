// Doors and windows as rule-carrying objects. A door knows its wall, the two
// rooms it connects, its swing side and the clearance it needs; a window
// knows its exterior wall, the room it daylights, and its dimensions.
import { roomInterfaces } from './walls.js';

const DOOR_MARGIN = 0.25;   // keep from wall ends / corners
const WINDOW_MARGIN = 0.45;

function doorWidthFor(room) {
  return room.type === 'bathroom' || room.type === 'wc' || room.type === 'storage' ? 0.8 : 0.9;
}

/**
 * Place doors: a BFS tree over the room-interface graph rooted at the hall
 * gives every room exactly one entry door; required-adjacency pairs that are
 * connected but not on the tree get a wide cased opening instead. Also places
 * the entrance door on the hall's exterior wall.
 *
 * @returns { doors, issues }
 *   door: { wall, t (center offset along wall, m), width, rooms:[from,to],
 *           swingRoom, hinge: 0|1, kind:'door'|'opening'|'entrance', clearance:{x,y,w,h} }
 */
export function placeDoors(walls, rooms, adjacency, circulationIndex, entrance, pairKeyFn) {
  const R = rooms.length;
  const interfaces = roomInterfaces(walls, R);
  const doors = [];
  const issues = [];

  // adjacency graph among rooms with a door-able interface
  const adj = Array.from({ length: R }, () => []);
  for (const [key, segs] of interfaces) {
    const a = (key / R) | 0, b = key % R;
    const need = Math.max(doorWidthFor(rooms[a]), doorWidthFor(rooms[b])) + 2 * DOOR_MARGIN;
    if (segs[0].len >= need) {
      adj[a].push(b);
      adj[b].push(a);
    }
  }

  // BFS tree from the hall
  const start = circulationIndex >= 0 ? circulationIndex : 0;
  const parent = new Array(R).fill(-2);
  parent[start] = -1;
  const queue = [start];
  while (queue.length) {
    const cur = queue.shift();
    for (const nb of adj[cur]) {
      if (parent[nb] === -2) { parent[nb] = cur; queue.push(nb); }
    }
  }

  const treeEdges = new Set();
  for (let r = 0; r < R; r++) {
    if (r === start) continue;
    if (parent[r] === -2) {
      issues.push(`${rooms[r].name}: no door-able connection to the hall`);
      continue;
    }
    const door = makeDoorOnInterface(interfaces, R, parent[r], r, doorWidthFor(rooms[r]), 'door');
    if (door) {
      doors.push(door);
      treeEdges.add(pairIdx(parent[r], r, R));
    } else {
      issues.push(`${rooms[r].name}: shared wall too short for a door`);
    }
  }

  // required adjacencies not on the tree -> cased openings
  for (const key of Object.keys(adjacency)) {
    if (adjacency[key] !== 1) continue;
    const [idA, idB] = key.split(':').map(Number);
    const a = rooms.findIndex((r) => r.id === idA);
    const b = rooms.findIndex((r) => r.id === idB);
    if (a < 0 || b < 0 || treeEdges.has(pairIdx(a, b, R))) continue;
    const opening = makeDoorOnInterface(interfaces, R, a, b, 1.4, 'opening');
    if (opening) doors.push(opening);
  }

  // entrance door on the hall's exterior wall, nearest the entrance marker
  const hallExterior = walls.filter((w) => w.type === 'exterior' && (w.sideA === start || w.sideB === start));
  if (hallExterior.length > 0) {
    let best = null, bestD = Infinity;
    for (const w of hallExterior) {
      if (w.len < 1.0 + 2 * DOOR_MARGIN) continue;
      const mid = entrance || { x: (w.x1 + w.x2) / 2, y: (w.y1 + w.y2) / 2 };
      const t = clampT(w, mid, 1.0);
      if (t === null) continue;
      const cx = w.horizontal ? w.x1 + t : w.x1;
      const cy = w.horizontal ? w.y1 : w.y1 + t;
      const d = entrance ? Math.hypot(cx - entrance.x, cy - entrance.y) : w.len;
      if (d < bestD) { bestD = d; best = { wall: w, t }; }
    }
    if (best) {
      doors.push(buildDoor(best.wall, best.t, 1.0, [-1, start], start, 'entrance'));
    } else {
      issues.push('Hall: exterior wall too short for an entrance door');
    }
  } else {
    issues.push('Hall: no exterior wall for an entrance door');
  }

  return { doors, issues };
}

function pairIdx(a, b, R) { return a < b ? a * R + b : b * R + a; }

function makeDoorOnInterface(interfaces, R, a, b, width, kind) {
  const segs = interfaces.get(pairIdx(a, b, R));
  if (!segs) return null;
  for (const w of segs) {
    if (w.len >= width + 2 * DOOR_MARGIN) {
      // door swings into the room it serves (b), centered on the segment
      return buildDoor(w, w.len / 2, width, [a, b], b, kind);
    }
  }
  // fall back to a narrower door on the longest segment
  const w = segs[0];
  const fallback = Math.min(width, w.len - 2 * DOOR_MARGIN);
  if (fallback >= 0.7 && kind === 'door') return buildDoor(w, w.len / 2, fallback, [a, b], b, kind);
  return null;
}

function clampT(wall, point, width) {
  const along = wall.horizontal ? point.x - wall.x1 : point.y - wall.y1;
  const t = Math.max(width / 2 + DOOR_MARGIN, Math.min(wall.len - width / 2 - DOOR_MARGIN, along));
  return wall.len < width + 2 * DOOR_MARGIN ? null : t;
}

function buildDoor(wall, t, width, roomsPair, swingRoom, kind) {
  // clearance: a width×width square on the swing side of the wall
  const half = width / 2;
  let clearance;
  if (wall.horizontal) {
    const cx = wall.x1 + t;
    const swingUp = wall.sideA === swingRoom; // sideA is above (smaller y)
    clearance = { x: cx - half, y: swingUp ? wall.y1 - width : wall.y1, w: width, h: width };
  } else {
    const cy = wall.y1 + t;
    const swingLeft = wall.sideA === swingRoom;
    clearance = { x: swingLeft ? wall.x1 - width : wall.x1, y: cy - half, w: width, h: width };
  }
  return { wall, t, width, rooms: roomsPair, swingRoom, hinge: 0, kind, clearance };
}

/**
 * Place windows on exterior walls of daylight rooms. Glazing target ~12% of
 * the room's floor area; windows are 0.6–2.2 m wide, distributed over the
 * longest facade runs, keeping clear of corners and the entrance door.
 *
 * @returns { windows, issues }  window: { wall, t, width, room, sill, head }
 */
export function placeWindows(walls, rooms, areas, doors) {
  const windows = [];
  const issues = [];
  const entranceDoors = doors.filter((d) => d.kind === 'entrance');

  for (let r = 0; r < rooms.length; r++) {
    if (!rooms[r].daylight) continue;
    const runs = walls
      .filter((w) => w.type === 'exterior' && (w.sideA === r || w.sideB === r))
      .sort((a, b) => b.len - a.len);
    if (runs.length === 0) {
      if (areas[r] > 0) issues.push(`${rooms[r].name}: needs daylight but has no facade`);
      continue;
    }
    let need = Math.max(0.9, (0.12 * areas[r]) / 1.2); // total window width, m
    for (const w of runs) {
      if (need <= 0) break;
      let usable = w.len - 2 * WINDOW_MARGIN;
      // avoid the entrance door if it sits on this wall
      const blocked = entranceDoors.filter((d) => d.wall === w);
      if (usable < 0.6) continue;
      const width = Math.min(2.2, Math.max(0.6, Math.min(need, usable)));
      let t = w.len / 2;
      if (blocked.length > 0) {
        const d = blocked[0];
        // shift window to the larger free side of the door
        const leftSpace = d.t - d.width / 2 - WINDOW_MARGIN;
        const rightSpace = w.len - (d.t + d.width / 2) - WINDOW_MARGIN;
        if (Math.max(leftSpace, rightSpace) < width + WINDOW_MARGIN) continue;
        t = leftSpace > rightSpace
          ? WINDOW_MARGIN + (leftSpace - width) / 2 + width / 2
          : d.t + d.width / 2 + WINDOW_MARGIN + (rightSpace - width) / 2 + width / 2;
      }
      windows.push({ wall: w, t, width, room: r, sill: 0.9, head: 2.1 });
      need -= width;
    }
    if (need > 0.3) issues.push(`${rooms[r].name}: facade too short for full daylight target`);
  }

  return { windows, issues };
}

/** Axis-aligned world rect of an opening's span on its wall (for conflicts). */
export function openingRect(opening, depth = 0.35) {
  const w = opening.wall;
  const half = opening.width / 2;
  if (w.horizontal) {
    return { x: w.x1 + opening.t - half, y: w.y1 - depth, w: opening.width, h: depth * 2 };
  }
  return { x: w.x1 - depth, y: w.y1 + opening.t - half, w: depth * 2, h: opening.width };
}
