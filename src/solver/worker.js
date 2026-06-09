// Evolutionary layout solver, running in a Web Worker so the sketch UI stays
// responsive. Maintains a population of layout genomes, evolves them
// continuously, and streams the top distinct solutions to the main thread.
//
// in:  setup | weights | focus | restart | pause | resume
// out: solutions | idle
import { rasterize } from './grid.js';
import {
  randomGenome, mutateGenome, crossoverGenomes, decodeGenome,
  clampToGrid, labelDifference, makeRng,
} from './genome.js';
import { evaluate } from './fitness.js';

const POP_SIZE = 48;
const ELITES = 6;
const TOURNAMENT = 3;
const CROSSOVER_RATE = 0.7;
const TOP_K = 6;
const DISTINCT_LABEL_DIFF = 0.12;
const POST_INTERVAL_MS = 160;

let rng = makeRng(20260609);
let ctx = null;          // { grid, rooms, adjacency, capacities, circulationIndex, hasCore, hasEntrance, entrance }
let weights = null;
let population = [];     // [{ genome, labels, sizes, score, breakdown, connections, centroids, areas }]
let generation = 0;
let paused = false;
let ticking = false;
let lastPost = 0;

self.onmessage = (e) => {
  const msg = e.data;
  switch (msg.type) {
    case 'setup': handleSetup(msg); break;
    case 'weights':
      weights = msg.weights;
      if (ctx) reevaluateAll();
      break;
    case 'focus': handleFocus(msg.genome); break;
    case 'restart':
      if (ctx) {
        population = [];
        generation = 0;
        seedPopulation();
        startLoop();
      }
      break;
    case 'pause': paused = true; break;
    case 'resume': paused = false; startLoop(); break;
  }
};

function handleSetup(msg) {
  weights = msg.weights;
  const { envelope, cores, entrance, program, cellSize } = msg;

  if (!envelope || envelope.length < 3 || program.rooms.length === 0) {
    ctx = null;
    population = [];
    self.postMessage({ type: 'idle' });
    return;
  }

  const grid = rasterize(envelope, cores || [], cellSize || 0.5);
  if (grid.insideCount < program.rooms.length * 4) {
    ctx = null;
    population = [];
    self.postMessage({ type: 'idle', reason: 'too-small' });
    return;
  }

  const rooms = program.rooms;
  const totalTarget = rooms.reduce((s, r) => s + Math.max(1, r.area), 0);
  const capacities = rooms.map((r) =>
    Math.max(2, Math.round((grid.insideCount * Math.max(1, r.area)) / totalTarget)));
  const circulationIndex = rooms.findIndex((r) => r.circulation);

  const prevCtx = ctx;
  const prevPop = population;
  ctx = {
    grid, rooms,
    adjacency: program.adjacency || {},
    capacities, circulationIndex,
    hasCore: (cores || []).length > 0,
    hasEntrance: !!entrance,
    entrance,
  };

  // Preserve design intent: carry elite genomes across the geometry/program
  // change (matched by room id), then top up with mutants + fresh randoms.
  population = [];
  if (prevPop.length > 0 && prevCtx) {
    const survivors = prevPop
      .slice(0, Math.min(prevPop.length, POP_SIZE / 2))
      .map((ind) => remapGenome(ind.genome, prevCtx.rooms, rooms));
    for (const g of survivors) {
      clampToGrid(g, grid);
      population.push({ genome: g });
      if (population.length < POP_SIZE * 0.8) {
        population.push({ genome: mutateGenome(g, grid, rng, { sigma: 1.0 }) });
      }
    }
  }
  seedPopulation();
  startLoop();
}

function remapGenome(genome, oldRooms, newRooms) {
  return newRooms.map((room) => {
    const oldIdx = oldRooms.findIndex((r) => r.id === room.id);
    if (oldIdx >= 0 && genome[oldIdx]) return { ...genome[oldIdx] };
    return null; // filled below
  }).map((s) => s || { x: ctx.grid.ox + rng() * ctx.grid.W * ctx.grid.cellSize,
                       y: ctx.grid.oy + rng() * ctx.grid.H * ctx.grid.cellSize,
                       w: 0.7 + rng() * 0.6 });
}

function seedPopulation() {
  while (population.length < POP_SIZE) {
    population.push({ genome: randomGenome(ctx.grid, ctx.rooms, rng) });
  }
  population.length = POP_SIZE;
  for (const ind of population) evaluateIndividual(ind);
  sortPopulation();
}

function handleFocus(genome) {
  if (!ctx || !genome || genome.length !== ctx.rooms.length) return;
  const base = genome.map((s) => ({ ...s }));
  clampToGrid(base, ctx.grid);
  population = [{ genome: base }];
  for (let i = 1; i < POP_SIZE; i++) {
    const sigma = 0.5 + (i / POP_SIZE) * 1.5;
    population.push({
      genome: mutateGenome(base, ctx.grid, rng, { sigma, pJitter: 0.8, lockedIndex: lockedIdx() }),
    });
  }
  for (const ind of population) evaluateIndividual(ind);
  sortPopulation();
  startLoop();
  postSolutions(true);
}

function lockedIdx() {
  return ctx.hasEntrance ? ctx.circulationIndex : -1;
}

function evaluateIndividual(ind) {
  // The hall is pinned to the entrance when one is placed.
  if (ctx.hasEntrance && ctx.circulationIndex >= 0) {
    ind.genome[ctx.circulationIndex].x = ctx.entrance.x;
    ind.genome[ctx.circulationIndex].y = ctx.entrance.y;
  }
  const { labels, sizes } = decodeGenome(ind.genome, ctx.grid, ctx.capacities);
  const result = evaluate(labels, sizes, ctx, weights);
  ind.labels = labels;
  ind.sizes = sizes;
  ind.score = result.score;
  ind.breakdown = result.breakdown;
  ind.connections = result.connections;
  const cs = ctx.grid.cellSize;
  ind.areas = Array.from(sizes, (n) => n * cs * cs);
  ind.centroids = result.analysis.stats.map((s) => s.size === 0 ? null : ({
    x: ctx.grid.ox + (s.sumI / s.size + 0.5) * cs,
    y: ctx.grid.oy + (s.sumJ / s.size + 0.5) * cs,
  }));
}

function reevaluateAll() {
  for (const ind of population) evaluateIndividual(ind);
  sortPopulation();
  postSolutions(true);
}

function sortPopulation() {
  population.sort((a, b) => b.score - a.score);
}

function startLoop() {
  if (ticking || !ctx) return;
  ticking = true;
  setTimeout(tick, 0);
}

function tick() {
  if (!ctx || paused) { ticking = false; return; }
  stepGeneration();
  generation++;
  const now = Date.now();
  if (now - lastPost >= POST_INTERVAL_MS) postSolutions();
  setTimeout(tick, 0);
}

function stepGeneration() {
  const next = population.slice(0, ELITES).map((ind) => ({ ...ind }));
  const locked = lockedIdx();
  while (next.length < POP_SIZE) {
    const a = tournament();
    let genome;
    if (rng() < CROSSOVER_RATE) {
      const b = tournament();
      genome = crossoverGenomes(a.genome, b.genome, rng);
    } else {
      genome = a.genome.map((s) => ({ ...s }));
    }
    genome = mutateGenome(genome, ctx.grid, rng, { lockedIndex: locked });
    const child = { genome };
    evaluateIndividual(child);
    next.push(child);
  }
  // occasional random immigrant keeps diversity up
  if (rng() < 0.3) {
    const imm = { genome: randomGenome(ctx.grid, ctx.rooms, rng) };
    evaluateIndividual(imm);
    next[next.length - 1] = imm;
  }
  population = next;
  sortPopulation();
}

function tournament() {
  let best = population[(rng() * population.length) | 0];
  for (let i = 1; i < TOURNAMENT; i++) {
    const c = population[(rng() * population.length) | 0];
    if (c.score > best.score) best = c;
  }
  return best;
}

function postSolutions(force = false) {
  if (!ctx || population.length === 0) return;
  const now = Date.now();
  if (!force && now - lastPost < POST_INTERVAL_MS) return;
  lastPost = now;

  // Pick the top-K solutions that are visually distinct from each other.
  const picked = [];
  for (const ind of population) {
    if (picked.length >= TOP_K) break;
    if (picked.every((p) => labelDifference(p.labels, ind.labels) > DISTINCT_LABEL_DIFF)) {
      picked.push(ind);
    }
  }
  for (const ind of population) {
    if (picked.length >= TOP_K) break;
    if (!picked.includes(ind)) picked.push(ind);
  }

  const g = ctx.grid;
  const transfers = [];
  const solutions = picked.map((ind) => {
    const labels = ind.labels.slice();
    transfers.push(labels.buffer);
    return {
      genome: ind.genome.map((s) => ({ ...s })),
      score: ind.score,
      breakdown: ind.breakdown,
      areas: ind.areas,
      centroids: ind.centroids,
      connections: ind.connections,
      labels,
    };
  });
  const kinds = g.kinds.slice();
  transfers.push(kinds.buffer);

  self.postMessage({
    type: 'solutions',
    generation,
    grid: { W: g.W, H: g.H, ox: g.ox, oy: g.oy, cellSize: g.cellSize, kinds },
    solutions,
  }, transfers);
}
