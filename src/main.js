// App bootstrap: default scene, solver worker wiring, render loop.
import { state } from './state.js';
import { initEditor, fitView } from './editor.js';
import { renderScene } from './render.js';
import { initUI, updateAlternatives, updateStats } from './ui.js';

// ---------- default scene so the app is alive immediately ----------

state.envelope = [
  { x: 0, y: 0 }, { x: 19, y: 0 }, { x: 19, y: 8.5 },
  { x: 13.5, y: 8.5 }, { x: 13.5, y: 12.5 }, { x: 0, y: 12.5 },
];
state.cores = [{ x: 8.5, y: 4.5, w: 2.5, h: 3.5 }];
state.entrance = { x: 11, y: 12.5 };

// ---------- editor + UI ----------

const canvas = document.getElementById('canvas');
initEditor(canvas);
initUI();
fitView();

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
    cellSize: state.cellSize,
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
    state.grid = msg.grid;
    state.solutions = msg.solutions;
    state.generation = msg.generation;
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
state.events.on('weights', () => worker.postMessage({ type: 'weights', weights: state.weights }));
state.events.on('evolve', (genome) => worker.postMessage({ type: 'focus', genome }));
state.events.on('restart', () => worker.postMessage({ type: 'restart' }));
state.events.on('pause', () => worker.postMessage({ type: 'pause' }));
state.events.on('resume', () => worker.postMessage({ type: 'resume' }));

pushSetup();

// ---------- render loop ----------

function frame() {
  renderScene(canvas);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
