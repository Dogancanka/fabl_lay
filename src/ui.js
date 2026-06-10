// DOM panels: program editor, adjacency matrix, weight sliders, ranked
// alternatives, compare modal, top-bar tools & stats.
import { state } from './state.js';
import { makeRoom, nextColor, pairKey, WEIGHT_LABELS, ROOM_TYPES, ensureRoomIdsAbove } from './program.js';
import { polygonArea } from './geometry.js';
import { renderSolutionToCanvas } from './render.js';
import { setTool, fitView } from './editor.js';
import { explainComparison } from './solver/synthesize.js';
import { normalizeFamily, DEFAULT_FAMILIES } from './model/families.js';
import { listProjects, saveProject, deleteProject, getProject, saveCustomFamilies } from './store.js';

const $ = (sel) => document.querySelector(sel);

const HINTS = {
  select: 'Drag vertices, edges and cores · double-click an edge to add a vertex · Del removes · drag empty space to pan · scroll to zoom · Ctrl+Z undo',
  envelope: 'Click to place corners · click the first point (or press Enter) to close the envelope · Esc cancels',
  core: 'Drag to draw a core rectangle (stairs / elevator / shafts)',
  entrance: 'Click on an envelope edge to place the entrance — the hall will anchor to it',
};

const altCards = [];

export function initUI() {
  // --- tools
  document.querySelectorAll('#tools .tool').forEach((btn) => {
    btn.addEventListener('click', () => setTool(btn.dataset.tool));
  });
  state.events.on('tool', (tool) => {
    document.querySelectorAll('#tools .tool').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.tool === tool);
    });
    $('#hint').textContent = HINTS[tool] || '';
  });

  // --- toggles
  const toggles = {
    graph: $('#toggle-graph'),
    dims: $('#toggle-dims'),
    furniture: $('#toggle-furniture'),
    pause: $('#toggle-pause'),
  };
  const applyToggle = (name) => {
    if (name === 'graph') state.showGraph = !state.showGraph;
    if (name === 'dims') state.showDims = !state.showDims;
    if (name === 'furniture') state.showFurniture = !state.showFurniture;
    if (name === 'pause') {
      state.paused = !state.paused;
      state.events.emit(state.paused ? 'pause' : 'resume');
    }
    toggles.graph.classList.toggle('active', state.showGraph);
    toggles.dims.classList.toggle('active', state.showDims);
    toggles.furniture.classList.toggle('active', state.showFurniture);
    toggles.pause.classList.toggle('active', state.paused);
  };
  for (const name of Object.keys(toggles)) {
    toggles[name].addEventListener('click', () => applyToggle(name));
  }
  state.events.on('toggle', applyToggle);
  toggles.dims.classList.toggle('active', state.showDims);

  // --- pages (Projects | Plans | Objects)
  document.querySelectorAll('#nav .nav-btn').forEach((btn) => {
    btn.addEventListener('click', () => showPage(btn.dataset.page));
  });
  showPage('plans');

  // --- 2D / 3D view
  document.querySelectorAll('#views .view-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.view = btn.dataset.view;
      document.querySelectorAll('#views .view-btn').forEach((b) =>
        b.classList.toggle('active', b.dataset.view === state.view));
      $('#canvas3d').classList.toggle('hidden', state.view !== '3d');
      $('#canvas').classList.toggle('hidden', state.view === '3d');
      state.events.emit('view', state.view);
    });
  });

  // --- panels
  renderRoomList();
  renderAdjMatrix();
  renderWeights();
  buildAltCards();

  $('#btn-add-room').addEventListener('click', () => {
    state.program.rooms.push(makeRoom({
      name: `Room ${state.program.rooms.length}`,
      area: 10,
      color: nextColor(state.program.rooms),
    }));
    programChanged();
  });

  $('#btn-evolve').addEventListener('click', () => {
    const sol = state.solutions[state.selectedAlt];
    if (sol) state.events.emit('evolve', sol.genome);
  });
  $('#btn-reset').addEventListener('click', () => state.events.emit('restart'));
  $('#btn-compare').addEventListener('click', openCompare);
  $('#compare-close').addEventListener('click', () => $('#compare-modal').classList.add('hidden'));
  $('#compare-modal').addEventListener('click', (e) => {
    if (e.target.id === 'compare-modal') $('#compare-modal').classList.add('hidden');
  });

  state.events.emit('tool', state.tool);
}

function programChanged() {
  renderRoomList();
  renderAdjMatrix();
  state.events.emit('program');
}

// ---------- program editor ----------

function renderRoomList() {
  const list = $('#room-list');
  list.innerHTML = '';
  for (const room of state.program.rooms) {
    const row = document.createElement('div');
    row.className = 'room-row' + (room.circulation ? ' fixed' : '');

    const swatch = document.createElement('div');
    swatch.className = 'room-swatch';
    swatch.style.background = room.color;

    const typeSel = document.createElement('select');
    typeSel.title = 'Room type: drives daylight, wet walls and required furniture';
    for (const key of Object.keys(ROOM_TYPES)) {
      if (key === 'hall' && !room.circulation) continue;
      if (room.circulation && key !== 'hall') continue;
      const opt = document.createElement('option');
      opt.value = key;
      opt.textContent = ROOM_TYPES[key].label;
      if ((room.type || 'living') === key) opt.selected = true;
      typeSel.appendChild(opt);
    }
    typeSel.addEventListener('change', () => {
      const t = ROOM_TYPES[typeSel.value];
      room.type = typeSel.value;
      room.daylight = t.daylight;
      room.color = t.color;
      programChanged();
    });

    const name = document.createElement('input');
    name.type = 'text';
    name.value = room.name;
    name.addEventListener('change', () => {
      room.name = name.value || room.name;
      renderAdjMatrix();
      state.events.emit('program');
    });

    const area = document.createElement('input');
    area.type = 'number';
    area.min = '1';
    area.step = '0.5';
    area.value = room.area;
    area.addEventListener('change', () => {
      room.area = Math.max(1, parseFloat(area.value) || room.area);
      updateProgramSummary();
      state.events.emit('program');
    });

    const unit = document.createElement('span');
    unit.className = 'unit';
    unit.textContent = 'm²';

    const sun = document.createElement('button');
    sun.className = 'sun' + (room.daylight ? ' on' : '');
    sun.textContent = '☀';
    sun.title = 'Needs daylight (exterior wall)';
    sun.addEventListener('click', () => {
      room.daylight = !room.daylight;
      sun.classList.toggle('on', room.daylight);
      state.events.emit('program');
    });

    const del = document.createElement('button');
    del.className = 'del';
    del.textContent = '✕';
    del.title = 'Remove room';
    del.addEventListener('click', () => {
      state.program.rooms = state.program.rooms.filter((r) => r.id !== room.id);
      for (const key of Object.keys(state.program.adjacency)) {
        if (key.split(':').map(Number).includes(room.id)) delete state.program.adjacency[key];
      }
      programChanged();
    });

    row.append(swatch, typeSel, name, area, unit, sun, del);
    list.appendChild(row);
  }
  updateProgramSummary();
}

function updateProgramSummary() {
  const total = state.program.rooms.reduce((s, r) => s + r.area, 0);
  const env = state.envelope.length >= 3 ? polygonArea(state.envelope) : 0;
  const core = state.cores.reduce((s, c) => s + c.w * c.h, 0);
  const net = Math.max(0, env - core);
  $('#program-summary').innerHTML =
    `Program <strong>${total.toFixed(0)} m²</strong> · net floor <strong>${net.toFixed(0)} m²</strong>` +
    (net > 0 ? ` · fit <strong>${((total / net) * 100).toFixed(0)}%</strong>` : '');
}

// ---------- adjacency matrix ----------

function renderAdjMatrix() {
  const table = $('#adj-matrix');
  table.innerHTML = '';
  const rooms = state.program.rooms;
  const adj = state.program.adjacency;

  const head = document.createElement('tr');
  head.appendChild(document.createElement('th'));
  for (const r of rooms) {
    const th = document.createElement('th');
    th.className = 'col';
    th.textContent = r.name;
    head.appendChild(th);
  }
  table.appendChild(head);

  for (let i = 0; i < rooms.length; i++) {
    const tr = document.createElement('tr');
    const th = document.createElement('th');
    th.textContent = rooms[i].name;
    tr.appendChild(th);
    for (let j = 0; j < rooms.length; j++) {
      const td = document.createElement('td');
      if (j <= i) {
        td.className = 'diag';
      } else {
        const key = pairKey(rooms[i].id, rooms[j].id);
        const setCell = () => {
          const v = adj[key] || 0;
          td.textContent = v === 1 ? '✓' : v === -1 ? '✕' : '·';
          td.className = v === 1 ? 'req' : v === -1 ? 'avoid' : '';
        };
        setCell();
        td.addEventListener('click', () => {
          const v = adj[key] || 0;
          const next = v === 0 ? 1 : v === 1 ? -1 : 0;
          if (next === 0) delete adj[key];
          else adj[key] = next;
          setCell();
          state.events.emit('program');
        });
      }
      tr.appendChild(td);
    }
    table.appendChild(tr);
  }
}

// ---------- weights ----------

function renderWeights() {
  const wrap = $('#weight-sliders');
  wrap.innerHTML = '';
  for (const key of Object.keys(state.weights)) {
    const row = document.createElement('div');
    row.className = 'weight-row';
    const label = document.createElement('label');
    label.textContent = WEIGHT_LABELS[key] || key;
    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = '0';
    slider.max = '2';
    slider.step = '0.1';
    slider.value = state.weights[key];
    const out = document.createElement('output');
    out.textContent = Number(state.weights[key]).toFixed(1);
    slider.addEventListener('input', () => {
      state.weights[key] = parseFloat(slider.value);
      out.textContent = Number(slider.value).toFixed(1);
      state.events.emit('weights');
    });
    row.append(label, slider, out);
    wrap.appendChild(row);
  }
}

// ---------- alternatives ----------

function buildAltCards() {
  const grid = $('#alt-grid');
  grid.innerHTML = '';
  for (let i = 0; i < 6; i++) {
    const card = document.createElement('div');
    card.className = 'alt-card';
    card.style.display = 'none';

    const badge = document.createElement('div');
    badge.className = 'rank-badge';
    badge.textContent = `#${i + 1}`;

    const canvas = document.createElement('canvas');
    canvas.width = 150;
    canvas.height = 112;

    const meta = document.createElement('div');
    meta.className = 'alt-meta';
    const score = document.createElement('span');
    score.className = 'alt-score';
    const check = document.createElement('input');
    check.type = 'checkbox';
    check.title = 'Select for comparison';
    check.addEventListener('click', (e) => e.stopPropagation());
    check.addEventListener('change', () => {
      if (check.checked) {
        state.compareSet.add(i);
        while (state.compareSet.size > 2) {
          const first = state.compareSet.values().next().value;
          state.compareSet.delete(first);
          altCards[first].check.checked = false;
        }
      } else {
        state.compareSet.delete(i);
      }
      $('#btn-compare').disabled = state.compareSet.size !== 2;
    });
    meta.append(score, check);

    card.append(badge, canvas, meta);
    card.addEventListener('click', () => {
      state.selectedAlt = i;
      refreshAltSelection();
      updateIssues();
      updateStats();
    });
    grid.appendChild(card);
    altCards.push({ card, canvas, score, check });
  }
}

function refreshAltSelection() {
  altCards.forEach(({ card }, i) => {
    card.classList.toggle('selected', i === state.selectedAlt && card.style.display !== 'none');
  });
}

export function updateAlternatives() {
  const rooms = state.program.rooms;
  for (let i = 0; i < altCards.length; i++) {
    const slot = altCards[i];
    const sol = state.solutions[i];
    if (!sol || !state.grid) {
      slot.card.style.display = 'none';
      continue;
    }
    slot.card.style.display = '';
    slot.score.textContent = sol.score.toFixed(1);
    renderSolutionToCanvas(slot.canvas, sol, state.grid, rooms);
  }
  if (state.selectedAlt >= state.solutions.length) state.selectedAlt = 0;
  refreshAltSelection();
  updateStats();
  updateIssues();
}

function updateIssues() {
  const list = $('#issue-list');
  const sol = state.solutions[state.selectedAlt];
  list.innerHTML = '';
  if (!sol) return;
  const issues = sol.issues || [];
  if (issues.length === 0) {
    const li = document.createElement('li');
    li.className = 'ok';
    li.textContent = '✓ All doors, daylight and furniture rules satisfied';
    list.appendChild(li);
    return;
  }
  for (const text of issues.slice(0, 8)) {
    const li = document.createElement('li');
    li.textContent = text;
    list.appendChild(li);
  }
}

export function updateStats() {
  const sol = state.solutions[state.selectedAlt];
  $('#stat-score').textContent = sol ? sol.score.toFixed(1) : '–';
  $('#stat-gen').textContent = String(state.generation);
  $('#stat-area').textContent = state.envelope.length >= 3
    ? `${polygonArea(state.envelope).toFixed(0)} m²` : '–';
  updateProgramSummary();
}

// ---------- compare ----------

function openCompare() {
  const [ia, ib] = [...state.compareSet];
  const a = state.solutions[ia];
  const b = state.solutions[ib];
  if (!a || !b || !state.grid) return;

  renderSolutionToCanvas($('#cmp-a'), a, state.grid, state.program.rooms, { showLabels: true });
  renderSolutionToCanvas($('#cmp-b'), b, state.grid, state.program.rooms, { showLabels: true });
  const better = a.score >= b.score ? [a, b, ia, ib] : [b, a, ib, ia];
  const why = explainComparison(better[0], better[1], WEIGHT_LABELS)
    .map((line) => `<div>${line}</div>`).join('');
  $('#cmp-a-info').innerHTML = breakdownTable(a, `Alternative #${ia + 1}`) +
    (a === better[0] ? `<div class="why-box"><strong>Why #${better[2] + 1} ranks above #${better[3] + 1}</strong>${why}</div>` : '');
  $('#cmp-b-info').innerHTML = breakdownTable(b, `Alternative #${ib + 1}`) +
    (b === better[0] ? `<div class="why-box"><strong>Why #${better[2] + 1} ranks above #${better[3] + 1}</strong>${why}</div>` : '');
  $('#compare-modal').classList.remove('hidden');
}

// ---------- pages: Projects / Plans / Objects ----------

function showPage(page) {
  state.page = page;
  document.querySelectorAll('#nav .nav-btn').forEach((b) =>
    b.classList.toggle('active', b.dataset.page === page));
  $('#page-projects').classList.toggle('hidden', page !== 'projects');
  $('#page-objects').classList.toggle('hidden', page !== 'objects');
  if (page === 'projects') renderProjectsPage();
  if (page === 'objects') renderObjectsPage();
}

export function initPages() {
  $('#btn-save-project').addEventListener('click', () => {
    const name = window.prompt('Project name', `Plan ${new Date().toLocaleDateString()}`);
    if (!name) return;
    const thumbCanvas = document.querySelector('.alt-card canvas');
    saveProject(name, {
      envelope: state.envelope,
      cores: state.cores,
      entrance: state.entrance,
      program: state.program,
      weights: state.weights,
    }, thumbCanvas ? thumbCanvas.toDataURL('image/png') : null);
    renderProjectsPage();
  });

  $('#btn-import-family').addEventListener('click', () => {
    $('#family-json').classList.toggle('hidden');
    $('#family-import-actions').classList.toggle('hidden');
  });
  $('#btn-confirm-import').addEventListener('click', importFamilies);
  $('#btn-export-families').addEventListener('click', exportFamilies);
}

function renderProjectsPage() {
  const grid = $('#project-grid');
  grid.innerHTML = '';
  const projects = listProjects();
  if (projects.length === 0) {
    grid.innerHTML = '<p class="help">No saved projects yet — design a plan and press “Save current plan as project”.</p>';
    return;
  }
  for (const p of projects) {
    const card = document.createElement('div');
    card.className = 'proj-card';
    const img = document.createElement('img');
    img.src = p.thumb || 'data:image/svg+xml,' + encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="150" height="112"/>');
    const meta = document.createElement('div');
    meta.className = 'proj-meta';
    meta.innerHTML = `<strong>${escapeHtml(p.name)}</strong><span>${new Date(p.savedAt).toLocaleDateString()}</span>`;
    const actions = document.createElement('div');
    actions.className = 'proj-actions';
    const open = document.createElement('button');
    open.textContent = 'Open';
    open.addEventListener('click', () => openProject(p.id));
    const del = document.createElement('button');
    del.textContent = 'Delete';
    del.addEventListener('click', () => {
      if (window.confirm(`Delete project "${p.name}"?`)) {
        deleteProject(p.id);
        renderProjectsPage();
      }
    });
    actions.append(open, del);
    card.append(img, meta, actions);
    grid.appendChild(card);
  }
}

function openProject(id) {
  const p = getProject(id);
  if (!p) return;
  state.envelope = p.data.envelope || [];
  state.cores = p.data.cores || [];
  state.entrance = p.data.entrance || null;
  state.program = p.data.program;
  state.weights = { ...state.weights, ...(p.data.weights || {}) };
  ensureRoomIdsAbove(Math.max(0, ...state.program.rooms.map((r) => r.id)));
  renderRoomList();
  renderAdjMatrix();
  renderWeights();
  showPage('plans');
  fitView();
  state.events.emit('program');
  state.events.emit('geometry');
}

function renderObjectsPage() {
  const grid = $('#family-grid');
  grid.innerHTML = '';
  const all = [...DEFAULT_FAMILIES.filter((f) => !state.customFamilies.some((c) => c.id === f.id)),
    ...state.customFamilies];
  for (const fam of all) {
    const card = document.createElement('div');
    card.className = 'fam-card';
    const rules = [];
    rules.push(`placement <code>${fam.placement}</code>`);
    if (fam.clearFront) rules.push(`front clearance <code>${fam.clearFront} m</code>`);
    if (fam.prefer?.length) rules.push(`prefers <code>${fam.prefer.join('</code> <code>')}</code>`);
    if (fam.roomTypes?.length) rules.push(`rooms: ${fam.roomTypes.join(', ')}`);
    card.innerHTML =
      `<h3><span class="room-swatch" style="background:${fam.color}"></span>${escapeHtml(fam.name)}` +
      (fam.custom ? ' <span class="custom-tag">custom</span>' : '') + '</h3>' +
      `<div class="fam-dims">${fam.w} × ${fam.d} × ${fam.h ?? 0.75} m</div>` +
      `<div class="fam-rules">${rules.join(' · ')}</div>`;
    if (fam.custom) {
      const del = document.createElement('button');
      del.className = 'mini';
      del.style.marginTop = '8px';
      del.textContent = 'Remove';
      del.addEventListener('click', () => {
        state.customFamilies = state.customFamilies.filter((c) => c.id !== fam.id);
        saveCustomFamilies(state.customFamilies);
        state.events.emit('families');
        renderObjectsPage();
      });
      card.appendChild(del);
    }
    grid.appendChild(card);
  }
}

function importFamilies() {
  const err = $('#import-error');
  err.textContent = '';
  try {
    let parsed = JSON.parse($('#family-json').value);
    if (!Array.isArray(parsed)) parsed = [parsed];
    const normalized = parsed.map(normalizeFamily);
    const byId = new Map(state.customFamilies.map((f) => [f.id, f]));
    for (const f of normalized) byId.set(f.id, f);
    state.customFamilies = [...byId.values()];
    saveCustomFamilies(state.customFamilies);
    state.events.emit('families');
    $('#family-json').classList.add('hidden');
    $('#family-import-actions').classList.add('hidden');
    renderObjectsPage();
  } catch (e) {
    err.textContent = String(e.message || e);
  }
}

function exportFamilies() {
  const data = state.customFamilies.length > 0 ? state.customFamilies : DEFAULT_FAMILIES;
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'fabl-families.json';
  a.click();
  URL.revokeObjectURL(a.href);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function breakdownTable(sol, title) {
  let html = `<table class="bk-table"><tr><td colspan="3"><strong>${title}</strong> — score ${sol.score.toFixed(1)}</td></tr>`;
  for (const key of Object.keys(sol.breakdown)) {
    const v = sol.breakdown[key];
    html += `<tr><td style="width:90px">${WEIGHT_LABELS[key] || key}</td>` +
      `<td><div class="bk-bar"><div style="width:${Math.round(v * 100)}%"></div></div></td>` +
      `<td style="width:38px;text-align:right">${Math.round(v * 100)}</td></tr>`;
  }
  return html + '</table>';
}
