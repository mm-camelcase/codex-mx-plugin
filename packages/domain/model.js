/** Pure protocol-to-domain mapping; no Codex process or Logitech dependencies. */
export const STATES = ['needs-attention', 'possible-attention', 'error', 'working', 'observed-active', 'stopped', 'interrupted', 'done', 'idle', 'unknown'];
export const STATE_LABELS = { 'needs-attention': 'Needs you', 'possible-attention': 'Approval seen', 'observed-active': 'Activity seen', stopped: 'Stop seen', interrupted: 'Interrupt seen', error: 'Error', working: 'Working', done: 'Done', idle: 'Idle', unknown: 'Unknown' };
export function mapStatus(status) {
  if (status?.type === 'active') return status.activeFlags?.some(flag => ['waitingOnApproval', 'waitingOnUserInput'].includes(flag)) ? 'needs-attention' : 'working';
  if (status?.type === 'systemError') return 'error';
  if (status?.type === 'idle') return 'idle';
  return 'unknown';
}
export function reduceState(state, event) {
  if (event.method === 'thread/status/changed') return mapStatus(event.params?.status);
  if (event.method === 'turn/started') return 'working';
  if (['item/commandExecution/requestApproval', 'item/fileChange/requestApproval', 'item/tool/requestUserInput'].includes(event.method)) return 'needs-attention';
  if (event.method === 'turn/completed') {
    const status = event.params?.turn?.status;
    return status === 'completed' ? 'done' : status === 'failed' ? 'error' : status === 'interrupted' ? 'idle' : 'unknown';
  }
  return state;
}
export function aggregate(threads) {
  const counts = Object.fromEntries(STATES.map(state => [state, 0]));
  for (const thread of threads) counts[STATES.includes(thread.state) ? thread.state : 'unknown']++;
  const state = ['needs-attention', 'possible-attention', 'error', 'working', 'observed-active'].find(s => counts[s])
    || (threads.length && counts.done === threads.length ? 'done' : counts.unknown ? 'unknown' : counts.interrupted ? 'interrupted' : counts.stopped ? 'stopped' : 'idle');
  return { state, counts, total: threads.length, badge: counts[state] || 0 };
}
export function groupThreads(rawThreads) {
  const groups = new Map();
  for (const raw of rawThreads) {
    if (raw.parentThreadId) continue; // Keep spawned work within its parent task.
    const cwd = raw.cwd || '';
    const id = cwd || '__unassigned__';
    if (!groups.has(id)) groups.set(id, { id, cwd, name: cwd ? cwd.split(/[\\/]/).filter(Boolean).at(-1) || cwd : 'Unassigned', threads: [] });
    groups.get(id).threads.push({
      id: raw.id, projectId: id, savedProjectId: raw.savedProjectId || null, cwd, repositoryRoot: raw.repositoryRoot || null,
      name: raw.name?.trim() || raw.preview?.trim().split('\n')[0]?.slice(0, 120) || 'Untitled task',
      preview: raw.preview || '', state: mapStatus(raw.status),
      rawStatus: raw.status || null, updatedAt: Number(raw.updatedAt || 0) * 1000
    });
  }
  return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)).map(project => ({ ...project, threads: project.threads.sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id)) }));
}
export function applyEvent(projects, event) {
  const id = event.params?.threadId || event.params?.thread?.id;
  return projects.map(project => ({ ...project, threads: project.threads.map(thread => thread.id !== id ? thread : { ...thread, state: reduceState(thread.state, event), rawStatus: event.params?.status || (event.method.startsWith('turn/') ? null : thread.rawStatus) }) }));
}
