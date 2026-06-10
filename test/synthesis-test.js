// Headless test of the architectural synthesis: walls, doors, windows,
// furniture and extended scoring on an evolved layout.
import { rasterize } from '../src/solver/grid.js';
import { randomGenome, mutateGenome, crossoverGenomes, decodeGenome, makeRng } from '../src/solver/genome.js';
import { evaluate } from '../src/solver/fitness.js';
import { synthesize, explainComparison } from '../src/solver/synthesize.js';
import { buildCatalog } from '../src/model/families.js';
import { defaultProgram, DEFAULT_WEIGHTS, combinedScore, WEIGHT_LABELS } from '../src/program.js';

const envelope = [
  { x: 0, y: 0 }, { x: 19, y: 0 }, { x: 19, y: 8.5 },
  { x: 13.5, y: 8.5 }, { x: 13.5, y: 12.5 }, { x: 0, y: 12.5 },
];
const cores = [{ x: 8.5, y: 4.5, w: 2.5, h: 3.5 }];
const entrance = { x: 11, y: 12.5 };
const program = defaultProgram();
const weights = { ...DEFAULT_WEIGHTS };

const grid = rasterize(envelope, cores, 0.5);
const rooms = program.rooms;
const totalTarget = rooms.reduce((s, r) => s + r.area, 0);
const capacities = rooms.map((r) => Math.max(2, Math.round((grid.insideCount * r.area) / totalTarget)));
const circulationIndex = rooms.findIndex((r) => r.circulation);
const ctx = {
  grid, rooms, adjacency: program.adjacency, capacities, circulationIndex,
  hasCore: true, hasEntrance: true, entrance, catalog: buildCatalog(),
};

const rng = makeRng(7);
function evalInd(ind) {
  ind.genome[circulationIndex].x = entrance.x;
  ind.genome[circulationIndex].y = entrance.y;
  const { labels, sizes } = decodeGenome(ind.genome, grid, capacities);
  const res = evaluate(labels, sizes, ctx, weights);
  ind.labels = labels;
  ind.score = res.score;
  ind.breakdown = res.breakdown;
}

let pop = Array.from({ length: 48 }, () => ({ genome: randomGenome(grid, rooms, rng) }));
pop.forEach(evalInd);
pop.sort((a, b) => b.score - a.score);
const tour = () => {
  let best = pop[(rng() * 48) | 0];
  for (let i = 0; i < 2; i++) { const c = pop[(rng() * 48) | 0]; if (c.score > best.score) best = c; }
  return best;
};
for (let g = 0; g < 60; g++) {
  const next = pop.slice(0, 6);
  while (next.length < 48) {
    let genome = rng() < 0.7 ? crossoverGenomes(tour().genome, tour().genome, rng) : tour().genome.map((s) => ({ ...s }));
    genome = mutateGenome(genome, grid, rng, { lockedIndex: circulationIndex });
    const child = { genome };
    evalInd(child);
    next.push(child);
  }
  pop = next.sort((a, b) => b.score - a.score);
}

console.log(`GA best: ${pop[0].score.toFixed(1)} (construction: ${(pop[0].breakdown.construction * 100).toFixed(0)})`);

const t0 = Date.now();
const plan = synthesize(pop[0].labels, ctx);
const dt = Date.now() - t0;

const wallStats = {
  exterior: plan.walls.filter((w) => w.type === 'exterior').length,
  interior: plan.walls.filter((w) => w.type === 'interior').length,
  core: plan.walls.filter((w) => w.type === 'core').length,
};
console.log(`synthesis in ${dt} ms`);
console.log('walls:', wallStats);
console.log(`doors: ${plan.doors.length} (${plan.doors.map((d) => d.kind).join(', ')})`);
console.log(`windows: ${plan.windows.length}`);
console.log(`furniture: ${plan.furniture.length} items:`, plan.furniture.map((f) => f.familyId).join(', '));
console.log('ext scores:', plan.ext);
console.log('issues:', plan.issues.length ? plan.issues : 'none');

const fullBreakdown = { ...pop[0].breakdown, ...plan.ext };
console.log(`combined score: ${combinedScore(fullBreakdown, weights).toFixed(1)}`);

const planB = synthesize(pop[5].labels, ctx);
const explain = explainComparison(
  { breakdown: fullBreakdown },
  { breakdown: { ...pop[5].breakdown, ...planB.ext } },
  WEIGHT_LABELS,
);
console.log('why #1 > #6:', explain);

// assertions
if (plan.walls.length < 10) throw new Error('too few walls');
if (!plan.doors.some((d) => d.kind === 'entrance')) throw new Error('no entrance door');
if (plan.doors.filter((d) => d.kind === 'door').length < rooms.length - 2) throw new Error('missing room doors');
if (plan.windows.length < 3) throw new Error('too few windows');
if (plan.furniture.length < 6) throw new Error('too little furniture placed');
if (plan.ext.furnish < 0.5) throw new Error('furnishability too low');
// no furniture overlaps
for (let i = 0; i < plan.furniture.length; i++) {
  for (let j = i + 1; j < plan.furniture.length; j++) {
    const a = plan.furniture[i].rect, b = plan.furniture[j].rect;
    if (a.x < b.x + b.w - 0.01 && a.x + a.w > b.x + 0.01 && a.y < b.y + b.h - 0.01 && a.y + a.h > b.y + 0.01) {
      throw new Error(`furniture overlap: ${plan.furniture[i].familyId} / ${plan.furniture[j].familyId}`);
    }
  }
}
// no furniture blocks a door clearance
for (const f of plan.furniture) {
  for (const d of plan.doors) {
    const a = f.rect, b = d.clearance;
    if (a.x < b.x + b.w - 0.01 && a.x + a.w > b.x + 0.01 && a.y < b.y + b.h - 0.01 && a.y + a.h > b.y + 0.01) {
      throw new Error(`furniture ${f.familyId} blocks a door`);
    }
  }
}
console.log('\nOK — synthesis works.');
