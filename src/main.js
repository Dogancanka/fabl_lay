// App bootstrap: default scene, solver worker wiring, render loop (2D/3D).
import { state } from './state.js';
import { initEditor, fitView } from './editor.js';
import { renderScene } from './render.js';
import { setSymbolCatalog } from './render-plan.js';
import { initUI, initPages, updateAlternatives, updateStats } from './ui.js';
import { initView3D, renderView3D, invalidateScene } from './view3d.js';
import { initPlanEditor } from './plan-editor.js';
import { buildCatalog } from './model/families.js';
import { listCustomFamilies } from './store.js';

// ---------- default scene so the app is alive immediately ----------

state.envelope = [
  { x: 0, y: 0 }, { x: 19, y: 0 }, { x: 19, y: 8.5 },
  { x: 13.5, y: 8.5 }, { x: 13.5, y: 12.5 }, { x: 0, y: 12.5 },
];
state.cores = [{ x: 8.5, y: 4.5, w: 2.5, h: 3.5 }];
state.entrance = { x: 11, y: 12.5 };
state.customFamilies = listCustomFamilies();

// ---------- editor + UI ----------

const canvas = document.getElementById('canvas');
const canvas3d = document.getElementById('canvas3d');
initEditor(canvas);
initUI();
initPages();
initView3D(canvas3d);
fitView();

let catalog = buildCatalog(state.customFamilies);
setSymbolCatalog(catalog);

initPlanEditor(canvas, {
  getCatalog: () => catalog,
  onPlanEdited: () => {
    invalidateScene();
    updateAlternatives();
  },
});

// ---------- solver worker ----------

const worker = new Worker(new URL('./solver/worker.js', import.meta.url), { type: 'module' });

function pushSetup() {
  worker.postMessage({
    type: 'setup',
    envelope: state.envelope,
    cores: state.cores,
    entrance: state.entrance,
    program: state.program,
    weights: state.weights,
    families: state.customFamilies,
    cellSize: state.cellSize,
    altCount: state.altCount,
  });
}

let setupTimer = null;
function pushSetupDebounced() {
  clearTimeout(setupTimer);
  setupTimer = setTimeout(pushSetup, 120);
}

worker.onmessage = (e) => {
  const msg = e.data;
  if (msg.type === 'solutions') {
    // a trailing post must not clobber manual edits made in the plan tool
    if (state.tool === 'plan' && state.solutions.some((s) => s.edited)) return;
    state.grid = msg.grid;
    state.solutions = msg.solutions;
    state.generation = msg.generation;
    state.phase = msg.phase || 'running';
    updateAlternatives();
  } else if (msg.type === 'idle') {
    state.grid = null;
    state.solutions = [];
    updateAlternatives();
  }
};

state.events.on('geometry', () => {
  pushSetupDebounced();
  updateStats();
});
state.events.on('program', pushSetupDebounced);
state.events.on('families', () => {
  catalog = buildCatalog(state.customFamilies);
  setSymbolCatalog(catalog);
  pushSetupDebounced();
});
state.events.on('layers', () => invalidateScene());
state.events.on('weights', () => worker.postMessage({ type: 'weights', weights: state.weights }));
state.events.on('evolve', (genome) => worker.postMessage({ type: 'focus', genome }));
state.events.on('generate', (count) => worker.postMessage({ type: 'generate', count }));
state.events.on('pause', () => worker.postMessage({ type: 'pause' }));
state.events.on('resume', () => worker.postMessage({ type: 'resume' }));

pushSetup();

// ---------- render loop ----------

function frame() {
  if (state.view === '3d') {
    renderView3D(canvas3d, state.solutions[state.selectedAlt], state.grid, state.program.rooms, catalog);
  } else {
    renderScene(canvas);
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
