// Room program model: room types, default program, adjacency rules.
// Shared between the UI (main thread) and the solver (worker).

export const ROOM_PALETTE = [
  '#9b7bd4', '#6fb3e0', '#8fcf8a', '#e8b04f', '#e08a8a',
  '#5fc6b8', '#c98fd1', '#b3c45f', '#7f95e0', '#d99a66',
];

export const CIRCULATION_COLOR = '#d7d9de';

// Architectural room types: defaults for daylight, wet walls and the
// furniture families the auto-furnisher must fit into the room.
export const ROOM_TYPES = {
  living:   { label: 'Living',   color: '#9b7bd4', daylight: true,  wet: false, furniture: ['sofa', 'tv-unit', 'coffee-table'] },
  dining:   { label: 'Dining',   color: '#b3c45f', daylight: true,  wet: false, furniture: ['dining-table'] },
  kitchen:  { label: 'Kitchen',  color: '#6fb3e0', daylight: true,  wet: true,  furniture: ['kitchen-run'] },
  bedroom:  { label: 'Bedroom',  color: '#8fcf8a', daylight: true,  wet: false, furniture: ['bed-double', 'wardrobe'] },
  bathroom: { label: 'Bathroom', color: '#e08a8a', daylight: false, wet: true,  furniture: ['toilet', 'sink', 'shower'] },
  wc:       { label: 'WC',       color: '#5fc6b8', daylight: false, wet: true,  furniture: ['toilet', 'sink'] },
  office:   { label: 'Office',   color: '#7f95e0', daylight: true,  wet: false, furniture: ['desk'] },
  storage:  { label: 'Storage',  color: '#d99a66', daylight: false, wet: false, furniture: [] },
  hall:     { label: 'Hall',     color: '#d7d9de', daylight: false, wet: false, furniture: [], circulation: true },
};

let nextRoomId = 1;
/** After loading a saved project, keep future room ids collision-free. */
export function ensureRoomIdsAbove(maxId) {
  if (maxId >= nextRoomId) nextRoomId = maxId + 1;
}
export function makeRoom({ name, type = 'living', area, daylight, circulation, color }) {
  const t = ROOM_TYPES[type] || ROOM_TYPES.living;
  return {
    id: nextRoomId++,
    name: name || t.label,
    type,
    area,                                    // target area in m²
    daylight: daylight ?? t.daylight,        // needs an exterior wall
    circulation: circulation ?? !!t.circulation,
    color: color || t.color,
  };
}

export function defaultProgram() {
  const rooms = [
    makeRoom({ type: 'hall', name: 'Hall', area: 9 }),
    makeRoom({ type: 'living', name: 'Living room', area: 26 }),
    makeRoom({ type: 'kitchen', name: 'Kitchen', area: 12 }),
    makeRoom({ type: 'bedroom', name: 'Bedroom 1', area: 14 }),
    makeRoom({ type: 'bedroom', name: 'Bedroom 2', area: 11, color: '#e8b04f' }),
    makeRoom({ type: 'bathroom', name: 'Bathroom', area: 5.5 }),
    makeRoom({ type: 'wc', name: 'WC', area: 2.5 }),
  ];

  // adjacency: map "idA:idB" (idA < idB) -> 1 required | -1 avoid
  const adjacency = {};
  const set = (a, b, v) => { adjacency[pairKey(rooms[a].id, rooms[b].id)] = v; };
  set(1, 2, 1);   // living ↔ kitchen
  set(0, 1, 1);   // hall ↔ living
  set(0, 5, 1);   // hall ↔ bathroom
  set(2, 3, -1);  // kitchen ↔ bedroom 1: avoid
  set(2, 4, -1);  // kitchen ↔ bedroom 2: avoid

  return { rooms, adjacency };
}

export function pairKey(idA, idB) {
  return idA < idB ? `${idA}:${idB}` : `${idB}:${idA}`;
}

export function nextColor(rooms) {
  const used = new Set(rooms.map((r) => r.color));
  return ROOM_PALETTE.find((c) => !used.has(c)) || ROOM_PALETTE[rooms.length % ROOM_PALETTE.length];
}

export const DEFAULT_WEIGHTS = {
  area: 1.0,         // hit target areas
  adjacency: 1.0,    // satisfy required / avoid pairs
  daylight: 1.0,     // habitable rooms reach the facade
  compactness: 0.7,  // well-proportioned, non-snaky rooms
  circulation: 1.2,  // everything reachable from hall / entrance / core
  construction: 0.6, // straight, continuous walls; few corners
  furnish: 1.0,      // required furniture fits with clearances (synthesis)
  access: 0.8,       // entrance + doors to every room (synthesis)
};

export const WEIGHT_LABELS = {
  area: 'Area targets',
  adjacency: 'Adjacency',
  daylight: 'Daylight',
  compactness: 'Compactness',
  circulation: 'Circulation',
  construction: 'Construction',
  furnish: 'Furnishability',
  access: 'Accessibility',
};

// Criteria the GA evaluates per individual (cheap). 'furnish' and 'access'
// come from the architectural synthesis of top solutions only.
export const GA_CRITERIA = ['area', 'adjacency', 'daylight', 'compactness', 'circulation', 'construction'];

/** Combined 0–100 score across GA breakdown + synthesis criteria. */
export function combinedScore(breakdown, weights) {
  let weighted = 0, total = 0;
  for (const k of Object.keys(breakdown)) {
    const w = weights[k] ?? 1;
    weighted += w * breakdown[k];
    total += w;
  }
  return total === 0 ? 0 : Math.max(0, Math.min(100, (weighted / total) * 100));
}
