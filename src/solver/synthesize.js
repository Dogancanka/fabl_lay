// Architectural synthesis: turns a raw GA cell layout into a buildable plan —
// straightened walls with thickness, doors, windows and furniture — and
// scores the synthesis-level criteria (furnishability, accessibility).
import { straightenLabels, extractWalls } from './walls.js';
import { placeDoors, placeWindows } from './openings.js';
import { furnish } from './furnish.js';
import { pairKey } from '../program.js';

/**
 * @param ctx { grid, rooms, adjacency, circulationIndex, entrance, catalog }
 * @returns { labels, walls, doors, windows, furniture, areas, centroids,
 *            ext: { furnish, access }, issues }
 */
export function synthesize(rawLabels, ctx) {
  const { grid, rooms, adjacency, circulationIndex, entrance, catalog } = ctx;
  const labels = straightenLabels(rawLabels, grid, 3);
  const walls = extractWalls(labels, grid);

  // areas + centroids from the straightened layout
  const R = rooms.length;
  const sizes = new Int32Array(R);
  const sumI = new Float64Array(R), sumJ = new Float64Array(R);
  for (let j = 0; j < grid.H; j++) {
    for (let i = 0; i < grid.W; i++) {
      const r = labels[j * grid.W + i];
      if (r < 0) continue;
      sizes[r]++; sumI[r] += i; sumJ[r] += j;
    }
  }
  const cs = grid.cellSize;
  const areas = Array.from(sizes, (n) => n * cs * cs);
  const centroids = Array.from(sizes, (n, r) => n === 0 ? null : ({
    x: grid.ox + (sumI[r] / n + 0.5) * cs,
    y: grid.oy + (sumJ[r] / n + 0.5) * cs,
  }));

  const { doors, issues: doorIssues } = placeDoors(walls, rooms, adjacency, circulationIndex, entrance, pairKey);
  const { windows, issues: winIssues } = placeWindows(walls, rooms, areas, doors);
  const { items: furniture, scorePerRoom, issues: furnIssues } = furnish(labels, grid, rooms, walls, doors, windows, catalog);

  // accessibility: entrance exists + every room has its tree door
  const hasEntrance = doors.some((d) => d.kind === 'entrance');
  const roomsNeedingDoor = R - 1; // all except hall
  const dooredRooms = new Set(doors.filter((d) => d.kind !== 'entrance').map((d) => d.rooms[1]));
  doors.filter((d) => d.kind !== 'entrance').forEach((d) => dooredRooms.add(d.rooms[0]));
  let doored = 0;
  for (let r = 0; r < R; r++) {
    if (r !== circulationIndex && dooredRooms.has(r)) doored++;
  }
  const access = (hasEntrance ? 0.45 : 0) + 0.55 * (roomsNeedingDoor === 0 ? 1 : doored / roomsNeedingDoor);

  // furnishability: mean of per-room placement ratios
  const furnishScore = scorePerRoom.length === 0
    ? 1 : scorePerRoom.reduce((s, v) => s + v, 0) / scorePerRoom.length;

  return {
    labels, walls, doors, windows, furniture, areas, centroids,
    ext: { furnish: furnishScore, access: Math.min(1, access) },
    issues: [...doorIssues, ...winIssues, ...furnIssues],
  };
}

/** Human-readable comparison: why does solution A rank above B? */
export function explainComparison(a, b, labels) {
  const out = [];
  const keys = new Set([...Object.keys(a.breakdown), ...Object.keys(b.breakdown)]);
  const diffs = [...keys]
    .map((k) => ({ k, d: (a.breakdown[k] ?? 0) - (b.breakdown[k] ?? 0) }))
    .filter(({ d }) => Math.abs(d) >= 0.02)
    .sort((p, q) => Math.abs(q.d) - Math.abs(p.d))
    .slice(0, 4);
  for (const { k, d } of diffs) {
    const name = labels[k] || k;
    out.push(`${d > 0 ? '+' : '−'} ${name}: ${Math.round((a.breakdown[k] ?? 0) * 100)} vs ${Math.round((b.breakdown[k] ?? 0) * 100)}`);
  }
  if (out.length === 0) out.push('Scores are nearly identical — the layouts differ mostly in topology.');
  return out;
}
