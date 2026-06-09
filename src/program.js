// Room program model: room types, default program, adjacency rules.
// Shared between the UI (main thread) and the solver (worker).

export const ROOM_PALETTE = [
  '#9b7bd4', // violet
  '#6fb3e0', // blue
  '#8fcf8a', // green
  '#e8b04f', // amber
  '#e08a8a', // rose
  '#5fc6b8', // teal
  '#c98fd1', // orchid
  '#b3c45f', // olive
  '#7f95e0', // indigo
  '#d99a66', // tan
];

export const CIRCULATION_COLOR = '#d7d9de';

let nextRoomId = 1;
export function makeRoom({ name, area, daylight = true, circulation = false, color }) {
  return {
    id: nextRoomId++,
    name,
    area,           // target area in m²
    daylight,       // needs an exterior wall
    circulation,    // special: hallway/distribution space, always present
    color: color || ROOM_PALETTE[(nextRoomId - 2) % ROOM_PALETTE.length],
  };
}

export function defaultProgram() {
  const rooms = [
    makeRoom({ name: 'Hall', area: 9, daylight: false, circulation: true, color: CIRCULATION_COLOR }),
    makeRoom({ name: 'Living room', area: 26, color: ROOM_PALETTE[0] }),
    makeRoom({ name: 'Kitchen', area: 12, color: ROOM_PALETTE[1] }),
    makeRoom({ name: 'Bedroom 1', area: 14, color: ROOM_PALETTE[2] }),
    makeRoom({ name: 'Bedroom 2', area: 11, color: ROOM_PALETTE[3] }),
    makeRoom({ name: 'Bathroom', area: 5.5, daylight: false, color: ROOM_PALETTE[4] }),
    makeRoom({ name: 'WC', area: 2.5, daylight: false, color: ROOM_PALETTE[5] }),
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
  area: 1.0,        // hit target areas
  adjacency: 1.0,   // satisfy required / avoid pairs
  daylight: 1.0,    // habitable rooms reach the facade
  compactness: 0.7, // well-proportioned, non-snaky rooms
  circulation: 1.2, // everything reachable from hall / entrance / core
};

export const WEIGHT_LABELS = {
  area: 'Area targets',
  adjacency: 'Adjacency',
  daylight: 'Daylight',
  compactness: 'Compactness',
  circulation: 'Circulation',
};
