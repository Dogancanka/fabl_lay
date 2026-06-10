// Central app state with a tiny event bus and geometry undo history.
import { defaultProgram, DEFAULT_WEIGHTS } from './program.js';

class Emitter {
  constructor() { this.listeners = new Map(); }
  on(event, fn) {
    if (!this.listeners.has(event)) this.listeners.set(event, []);
    this.listeners.get(event).push(fn);
  }
  emit(event, payload) {
    for (const fn of this.listeners.get(event) || []) fn(payload);
  }
}

export const state = {
  // sketch geometry (meters, world space)
  envelope: [],          // [{x, y}] polygon
  cores: [],             // [{x, y, w, h}]
  entrance: null,        // {x, y} on an envelope edge

  // program + optimization
  program: defaultProgram(),
  weights: { ...DEFAULT_WEIGHTS },
  cellSize: 0.5,

  // solver results
  grid: null,            // last grid meta from the worker
  solutions: [],         // ranked alternatives from the worker
  generation: 0,
  phase: 'running',      // 'running' | 'done' (budgeted generation)
  altCount: 6,           // how many alternatives to generate
  selectedAlt: 0,
  compareSet: new Set(), // indices ticked for comparison
  paused: false,

  // view options: element visibility, grouped like a layer tree
  layers: {
    rooms: true,       // floor tints
    walls: true,
    doors: true,
    windows: true,
    furniture: true,
    labels: true,      // room names + areas
    dims: true,        // envelope edge dimensions
    graph: false,      // adjacency graph overlay
  },
  hiddenFamilies: new Set(),  // furniture family ids toggled off individually
  view: '2d',            // '2d' | '3d'
  page: 'plans',         // 'projects' | 'plans' | 'objects'
  customFamilies: [],    // user-imported families (JSON)
  tool: 'select',

  events: new Emitter(),
  _undo: [],
};

export function snapshotGeometry() {
  state._undo.push(JSON.stringify({
    envelope: state.envelope,
    cores: state.cores,
    entrance: state.entrance,
  }));
  if (state._undo.length > 80) state._undo.shift();
}

export function undoGeometry() {
  const snap = state._undo.pop();
  if (!snap) return false;
  const data = JSON.parse(snap);
  state.envelope = data.envelope;
  state.cores = data.cores;
  state.entrance = data.entrance;
  state.events.emit('geometry');
  return true;
}

export function geometryChanged() {
  state.events.emit('geometry');
}
