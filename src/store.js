// Local persistence: Projects (saved designs) and custom object families.
const PROJECTS_KEY = 'fabl.projects.v1';
const FAMILIES_KEY = 'fabl.families.v1';

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* quota */ }
}

// ---------- projects ----------

export function listProjects() {
  return read(PROJECTS_KEY, []);
}

export function saveProject(name, data, thumb) {
  const projects = listProjects();
  const id = `p${Date.now().toString(36)}`;
  projects.unshift({ id, name, savedAt: new Date().toISOString(), data, thumb });
  write(PROJECTS_KEY, projects.slice(0, 40));
  return id;
}

export function deleteProject(id) {
  write(PROJECTS_KEY, listProjects().filter((p) => p.id !== id));
}

export function getProject(id) {
  return listProjects().find((p) => p.id === id) || null;
}

// ---------- custom families ----------

export function listCustomFamilies() {
  return read(FAMILIES_KEY, []);
}

export function saveCustomFamilies(families) {
  write(FAMILIES_KEY, families);
}
