import { aggregate } from '../domain/model.js';
export const PAGE_SIZE = 6;
/** Keep distinct saved runs, but avoid spending a physical key on every repeat. */
export function collapseRepeatedTasks(threads) {
  const byTitle = new Map();
  for (const thread of threads) {
    const title = thread.name.trim().toLocaleLowerCase();
    if (!byTitle.has(title)) byTitle.set(title, []);
    byTitle.get(title).push(thread);
  }
  return [...byTitle.values()].map(runs => {
    const representative = runs.find(t => t.state === 'needs-attention') || runs.find(t => t.state === 'working') || runs[0];
    return { ...representative, repeatCount: runs.length };
  }).sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
}
/** Exactly nine keys, including fixed Back / Previous / Next positions. */
export function buildKeys(projects, view = { level: 'home', page: 0 }) {
  const all = projects.flatMap(p => p.threads);
  if (view.level === 'home') return {
    page: 0, pages: 1, title: 'Home',
    keys: [
      { id: 'codex', title: 'Codex', icon: 'codex', ...aggregate(all), action: { type: 'projects' } },
      ...['Claude', 'VS Code', 'Terminal', 'GitHub', 'AWS'].map(title => ({ id: title, title, subtitle: 'Not connected', icon: title.toLowerCase(), disabled: true, action: { type: 'none' } })),
      ...Array.from({ length: 3 }, (_, i) => ({ id: `empty-${i}`, title: '', disabled: true, action: { type: 'none' } }))
    ]
  };
  const project = projects.find(p => p.id === view.projectId);
  const items = view.level === 'project' ? (view.showAllRuns ? project?.threads || [] : collapseRepeatedTasks(project?.threads || [])) : projects;
  const pages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const page = Math.max(0, Math.min(view.page || 0, pages - 1));
  const keys = items.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map(item => view.level === 'project'
    ? { id: item.id, title: item.name, state: item.state, repeatCount: item.repeatCount || 1, evidence: item.observation?.stale ? `Last: ${item.observation.event === 'Stop' ? 'stop seen' : item.observation.event === 'PermissionRequest' ? 'approval seen' : 'activity seen'}` : null, icon: 'thread', action: { type: 'thread', id: item.id } }
    : { id: item.id, title: item.name, icon: 'folder', ...aggregate(item.threads), action: { type: 'project', id: item.id } });
  while (keys.length < PAGE_SIZE) keys.push({ id: `empty-${keys.length}`, title: '', disabled: true, action: { type: 'none' } });
  keys.push(
    { id: 'back', title: 'Back', icon: 'back', action: { type: 'back' } },
    { id: 'previous', title: 'Previous', icon: 'left', disabled: page === 0, action: { type: 'page', page: page - 1 } },
    { id: 'next', title: 'Next', icon: 'right', disabled: page >= pages - 1, action: { type: 'page', page: page + 1 } }
  );
  return { keys, page, pages, title: view.level === 'project' ? project?.name || 'Project unavailable' : 'Codex projects' };
}
