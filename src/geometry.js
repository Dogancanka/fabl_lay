// 2D geometry helpers shared by the editor (main thread) and the solver (worker).
// All coordinates are in meters, world space.

export function polygonArea(poly) {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a) / 2;
}

export function pointInPolygon(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y;
    const xj = poly[j].x, yj = poly[j].y;
    if (((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}

export function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function closestPointOnSegment(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return { x: a.x, y: a.y, t: 0 };
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return { x: a.x + t * dx, y: a.y + t * dy, t };
}

export function distToSegment(p, a, b) {
  return dist(p, closestPointOnSegment(p, a, b));
}

export function polygonBounds(poly) {
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  for (const p of poly) {
    minx = Math.min(minx, p.x); maxx = Math.max(maxx, p.x);
    miny = Math.min(miny, p.y); maxy = Math.max(maxy, p.y);
  }
  return { minx, miny, maxx, maxy };
}

export function polygonCentroid(poly) {
  let x = 0, y = 0;
  for (const p of poly) { x += p.x; y += p.y; }
  return { x: x / poly.length, y: y / poly.length };
}

export function pointInRect(x, y, r) {
  return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
}

/**
 * Snap a world point for sketching.
 * Considers: vertices of existing geometry, ortho-alignment with the previous
 * point, and the base grid. Returns { x, y, guides } where guides are lines
 * to visualize the active snap.
 */
export function snapPoint(p, { grid = 0.5, vertices = [], prev = null, vertexRadius = 0.4, alignTol = 0.35 } = {}) {
  const guides = [];

  // 1. vertex snap wins outright
  for (const v of vertices) {
    if (dist(p, v) <= vertexRadius) {
      return { x: v.x, y: v.y, guides: [{ type: 'vertex', x: v.x, y: v.y }] };
    }
  }

  let x = p.x, y = p.y;

  // 2. ortho alignment with previous sketch point
  if (prev) {
    if (Math.abs(p.x - prev.x) <= alignTol) {
      x = prev.x;
      guides.push({ type: 'v', x, from: prev });
    }
    if (Math.abs(p.y - prev.y) <= alignTol) {
      y = prev.y;
      guides.push({ type: 'h', y, from: prev });
    }
  }

  // 3. alignment with any existing vertex (extension lines)
  if (guides.length === 0) {
    for (const v of vertices) {
      if (Math.abs(p.x - v.x) <= alignTol * 0.7) { x = v.x; guides.push({ type: 'v', x, from: v }); break; }
    }
    for (const v of vertices) {
      if (Math.abs(p.y - v.y) <= alignTol * 0.7) { y = v.y; guides.push({ type: 'h', y, from: v }); break; }
    }
  }

  // 4. grid snap on whatever is still free
  if (!guides.some((g) => g.type === 'v' || g.type === 'vertex')) x = Math.round(x / grid) * grid;
  if (!guides.some((g) => g.type === 'h' || g.type === 'vertex')) y = Math.round(y / grid) * grid;

  return { x, y, guides };
}
