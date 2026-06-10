// Furniture / fixture "families": parametric objects with placement rules,
// clearances and snap preferences. Users can import their own families as
// JSON (see FAMILY_SCHEMA); the auto-furnisher and the validators only work
// through this metadata, never through hard-coded object names.

export const FAMILY_SCHEMA = {
  id: 'string (unique)',
  name: 'string',
  w: 'width along wall, m',
  d: 'depth into room, m',
  h: 'height, m (affects window conflicts when > sill)',
  placement: "'wall' | 'corner' | 'free'",
  clearFront: 'required free space in front, m',
  clearSide: 'required free space at each side, m',
  prefer: "ordered hints: 'wet-wall' | 'window' | 'no-window' | 'far-from-door' | 'faces:<familyId>' | 'near:<familyId>'",
  roomTypes: "room types this family belongs to, e.g. ['bedroom']",
  symbol: "2D symbol: 'bed'|'sofa'|'tv'|'table'|'toilet'|'sink'|'shower'|'wardrobe'|'counter'|'desk'|'generic'",
  color: 'hex color used in 2D/3D',
};

export const DEFAULT_FAMILIES = [
  {
    id: 'bed-double', name: 'Double bed', w: 1.6, d: 2.0, h: 0.5,
    placement: 'wall', clearFront: 0.9, clearSide: 0.55,
    prefer: ['far-from-door', 'no-window'], roomTypes: ['bedroom'], symbol: 'bed', color: '#cfd8e6',
  },
  {
    id: 'wardrobe', name: 'Wardrobe', w: 1.8, d: 0.6, h: 2.2,
    placement: 'wall', clearFront: 0.75, clearSide: 0.0,
    prefer: ['no-window'], roomTypes: ['bedroom'], symbol: 'wardrobe', color: '#b9a888',
  },
  {
    id: 'sofa', name: 'Sofa', w: 2.2, d: 0.95, h: 0.8,
    placement: 'wall', clearFront: 0.8, clearSide: 0.3,
    prefer: ['far-from-door'], roomTypes: ['living'], symbol: 'sofa', color: '#9fb6c9',
  },
  {
    id: 'tv-unit', name: 'TV unit', w: 1.6, d: 0.45, h: 1.1,
    placement: 'wall', clearFront: 0.6, clearSide: 0.0,
    prefer: ['faces:sofa', 'no-window'], roomTypes: ['living'], symbol: 'tv', color: '#7d8694',
  },
  {
    id: 'coffee-table', name: 'Coffee table', w: 1.1, d: 0.6, h: 0.45,
    placement: 'free', clearFront: 0.4, clearSide: 0.4,
    prefer: ['near:sofa'], roomTypes: ['living'], symbol: 'table', color: '#c9b896',
  },
  {
    id: 'dining-table', name: 'Dining table + chairs', w: 1.8, d: 1.0, h: 0.75,
    placement: 'free', clearFront: 0.8, clearSide: 0.8,
    prefer: ['window'], roomTypes: ['dining', 'kitchen', 'living'], symbol: 'table', color: '#c9b896',
  },
  {
    id: 'kitchen-run', name: 'Kitchen counter run', w: 2.4, d: 0.62, h: 0.9,
    placement: 'wall', clearFront: 1.1, clearSide: 0.0, runLength: 3.0,
    prefer: ['window', 'wet-wall'], roomTypes: ['kitchen'], symbol: 'counter', color: '#aab9a2',
  },
  {
    id: 'toilet', name: 'Toilet', w: 0.42, d: 0.68, h: 0.8,
    placement: 'wall', clearFront: 0.6, clearSide: 0.22,
    prefer: ['wet-wall', 'no-window'], roomTypes: ['bathroom', 'wc'], symbol: 'toilet', color: '#e8eef2',
  },
  {
    id: 'sink', name: 'Wash basin', w: 0.6, d: 0.48, h: 0.85,
    placement: 'wall', clearFront: 0.55, clearSide: 0.1,
    prefer: ['wet-wall'], roomTypes: ['bathroom', 'wc'], symbol: 'sink', color: '#e8eef2',
  },
  {
    id: 'shower', name: 'Shower', w: 0.9, d: 0.9, h: 2.0,
    placement: 'corner', clearFront: 0.7, clearSide: 0.0,
    prefer: ['wet-wall', 'no-window'], roomTypes: ['bathroom'], symbol: 'shower', color: '#cfe4ec',
  },
  {
    id: 'desk', name: 'Desk + chair', w: 1.3, d: 0.65, h: 0.74,
    placement: 'wall', clearFront: 0.8, clearSide: 0.2,
    prefer: ['window'], roomTypes: ['office', 'bedroom'], symbol: 'desk', color: '#c9b896',
  },
];

/** Validate + normalize a user-supplied family object. Throws on bad input. */
export function normalizeFamily(raw) {
  const req = ['id', 'name', 'w', 'd'];
  for (const k of req) {
    if (raw[k] === undefined || raw[k] === null || raw[k] === '') {
      throw new Error(`family missing "${k}"`);
    }
  }
  const num = (v, name, lo, hi) => {
    const n = Number(v);
    if (!Number.isFinite(n) || n < lo || n > hi) throw new Error(`family "${raw.id}": bad ${name}`);
    return n;
  };
  return {
    id: String(raw.id),
    name: String(raw.name),
    w: num(raw.w, 'w', 0.1, 10),
    d: num(raw.d, 'd', 0.1, 10),
    h: raw.h !== undefined ? num(raw.h, 'h', 0.05, 4) : 0.75,
    placement: ['wall', 'corner', 'free'].includes(raw.placement) ? raw.placement : 'wall',
    clearFront: raw.clearFront !== undefined ? num(raw.clearFront, 'clearFront', 0, 3) : 0.6,
    clearSide: raw.clearSide !== undefined ? num(raw.clearSide, 'clearSide', 0, 2) : 0,
    prefer: Array.isArray(raw.prefer) ? raw.prefer.map(String) : [],
    roomTypes: Array.isArray(raw.roomTypes) ? raw.roomTypes.map(String) : [],
    symbol: String(raw.symbol || 'generic'),
    color: /^#[0-9a-fA-F]{6}$/.test(raw.color || '') ? raw.color : '#c9c9c9',
    runLength: raw.runLength !== undefined ? num(raw.runLength, 'runLength', 0.5, 12) : undefined,
    custom: true,
  };
}

/** Merge default + custom families (customs override by id). */
export function buildCatalog(customFamilies = []) {
  const map = new Map(DEFAULT_FAMILIES.map((f) => [f.id, f]));
  for (const f of customFamilies) map.set(f.id, f);
  return map;
}
