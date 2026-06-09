// Headless smoke test of the layout engine (no DOM): rasterize a sample
// envelope, evolve a population, and verify scores improve and layouts are sane.
import { rasterize } from '../src/solver/grid.js';
import {
  randomGenome, mutateGenome, crossoverGenomes, decodeGenome, makeRng, labelDifference,
} from '../src/solver/genome.js';
import { evaluate } from '../src/solver/fitness.js';
import { defaultProgram, DEFAULT_WEIGHTS } from '../src/program.js';

const envelope = [
  { x: 0, y: 0 }, { x: 19, y: 0 }, { x: 19, y: 8.5 },
  { x: 13.5, y: 8.5 }, { x: 13.5, y: 12.5 }, { x: 0, y: 12.5 },
];
const cores = [{ x: 8.5, y: 4.5, w: 2.5, h: 3.5 }];
const entrance = { x: 11, y: 12.5 };
const program = defaultProgram();
const weights = { ...DEFAULT_WEIGHTS };

const grid = rasterize(envelope, cores, 0.5);
console.log(`grid ${grid.W}x${grid.H}, inside cells: ${grid.insideCount} (~${(grid.insideCount * 0.25).toFixed(0)} m²)`);
if (grid.insideCount < 100) throw new Error('rasterization failed');

const rooms = program.rooms;
const totalTarget = rooms.reduce((s, r) => s + r.area, 0);
const capacities = rooms.map((r) => Math.max(2, Math.round((grid.insideCount * r.area) / totalTarget)));
const circulationIndex = rooms.findIndex((r) => r.circulation);
const ctx = { grid, rooms, adjacency: program.adjacency, capacities, circulationIndex, hasCore: true, hasEntrance: true, entrance };

const rng = makeRng(42);
const POP = 48, ELITES = 6;

function evalInd(ind) {
  ind.genome[circulationIndex].x = entrance.x;
  ind.genome[circulationIndex].y = entrance.y;
  const { labels, sizes } = decodeGenome(ind.genome, grid, capacities);
  const res = evaluate(labels, sizes, ctx, weights);
  ind.labels = labels;
  ind.sizes = sizes;
  ind.score = res.score;
  ind.breakdown = res.breakdown;
}

let pop = Array.from({ length: POP }, () => ({ genome: randomGenome(grid, rooms, rng) }));
pop.forEach(evalInd);
pop.sort((a, b) => b.score - a.score);
const initialBest = pop[0].score;
console.log(`gen 0 best: ${initialBest.toFixed(1)}`);

const tournament = () => {
  let best = pop[(rng() * POP) | 0];
  for (let i = 0; i < 2; i++) {
    const c = pop[(rng() * POP) | 0];
    if (c.score > best.score) best = c;
  }
  return best;
};

const t0 = Date.now();
const GENS = 80;
for (let g = 1; g <= GENS; g++) {
  const next = pop.slice(0, ELITES);
  while (next.length < POP) {
    const a = tournament();
    let genome = rng() < 0.7 ? crossoverGenomes(a.genome, tournament().genome, rng)
                             : a.genome.map((s) => ({ ...s }));
    genome = mutateGenome(genome, grid, rng, { lockedIndex: circulationIndex });
    const child = { genome };
    evalInd(child);
    next.push(child);
  }
  pop = next.sort((a, b) => b.score - a.score);
}
const dt = Date.now() - t0;
const best = pop[0];
console.log(`gen ${GENS} best: ${best.score.toFixed(1)} (${dt} ms, ${(dt / GENS).toFixed(1)} ms/gen)`);
console.log('breakdown:', Object.fromEntries(Object.entries(best.breakdown).map(([k, v]) => [k, +(v).toFixed(2)])));

// sanity checks
const cellArea = 0.25;
console.log('\nroom areas (target → achieved):');
rooms.forEach((r, i) => {
  console.log(`  ${r.name.padEnd(14)} ${String(r.area).padStart(5)} → ${(best.sizes[i] * cellArea).toFixed(1)} m²`);
});

let assigned = 0;
for (const l of best.labels) if (l >= 0) assigned++;
if (assigned !== grid.insideCount) throw new Error(`coverage gap: ${assigned}/${grid.insideCount}`);
if (best.score <= initialBest) throw new Error('no improvement from evolution');
if (best.sizes.some((s) => s === 0)) throw new Error('a room vanished in the best layout');

// distinctness helper sanity
const d = labelDifference(pop[0].labels, pop[POP - 1].labels);
console.log(`\nlabel diff best vs worst: ${(d * 100).toFixed(0)}%`);
console.log('\nOK — engine works.');
