import { aggregate, applyEvent, STATE_LABELS } from '../packages/domain/model.js';
import { buildKeys, collapseRepeatedTasks } from '../packages/keypad-model/keys.js';
import { demoProjects } from './demo.js';

const $ = id => document.getElementById(id);
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const paths = {
  codex: '<path d="m9 6-6 6 6 6m6-12 6 6-6 6m-2-16-2 20"/>',
  folder: '<path d="M3 6a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>',
  thread: '<path d="M5 4h14v12H9l-4 4Z"/><path d="M9 8h6m-6 4h4"/>',
  back: '<path d="m9 5-7 7 7 7m-7-7h14a5 5 0 0 1 5 5"/>',
  left: '<path d="m14 5-7 7 7 7"/>', right: '<path d="m10 5 7 7-7 7"/>',
  claude: '<path d="M12 2v20M2 12h20M5 5l14 14M5 19 19 5m-16 3 18 8M8 3l8 18M3 16l18-8M8 21l8-18"/>',
  'vs code': '<path d="m3 8 5 4-5 4 2 2 10-9v10l6 3V2l-6 3v10L5 6Z"/>',
  terminal: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m6 8 4 4-4 4m7 0h5"/>',
  github: '<circle cx="12" cy="12" r="9"/><path d="M8 20v-4m8 4v-4M8 8l-1-3m9 3 1-3M7 11c0 5 10 5 10 0"/>',
  aws: '<path d="M6 16H5a4 4 0 1 1 1-8 6 6 0 0 1 12-1 4.5 4.5 0 0 1 0 9h-1m-9 4 4-4 4 4m-4-4v7"/>'
};
const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.folder}</svg>`;
const sampleDescriptions = {
  'needs-attention': 'The sample agent is waiting for your review before continuing.',
  working: 'The sample agent is working. Try another state to see the keys update.',
  done: 'The sample task completed successfully. Its attention badge has cleared.',
  error: 'The sample task encountered an error. Its project now carries the error state unless another task needs attention.',
  idle: 'This sample task is idle. Idle does not imply that work has completed.',
  unknown: 'No runtime state is available for this sample task.'
};
let sample = demoProjects();
let mode = 'demo';
let grouping = 'projects';
let showAllRuns = false;
let offline = false;
let live = { projects: [], connected: false, connecting: false, message: 'Connect to discover your saved Codex tasks.', events: [] };
let view = { level: 'home', page: 0 };
let selectedId = null;
let model;
let stream;
let connectRequest;
let toastTimer;
let statusChecking = false;
let scanningVisibleProjects = false;
const statusChecked = new Map();
let events = [{ time: new Date().toISOString(), method: 'demo/ready', detail: 'Fictional tasks loaded. Press Codex to explore projects.' }];
const local = ['127.0.0.1', 'localhost'].includes(location.hostname) && location.protocol === 'http:';
const getProjects = () => mode === 'demo' ? sample : grouping === 'folders' ? live.folders || live.projects : live.projects;
const allThreads = () => getProjects().flatMap(p => p.threads);
const selectedThread = () => allThreads().find(t => t.id === selectedId);
const targetThread = () => selectedThread() || getProjects().find(p => p.id === view.projectId)?.threads[0] || allThreads()[0];
const threadLink = id => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id || '') ? `codex://threads/${id}` : null;
const statusClass = state => state === 'needs-attention' ? 'attention' : state;
function notify(message) {
  $('toast').textContent = message; $('toast').classList.add('visible');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').classList.remove('visible'), 3200);
}
function record(method, detail) {
  events.unshift({ time: new Date().toISOString(), method, detail }); events.splice(40);
}
function parseRoute() {
  const parts = location.hash.replace(/^#\/?/, '').split('/');
  try {
    view = parts[0] === 'codex' ? { level: parts[1] === 'project' && parts[2] ? 'project' : 'projects', projectId: parts[2] ? decodeURIComponent(parts[2]) : undefined, page: Math.max(0, Number(parts[3] || (parts[1] !== 'project' ? parts[1] : 0)) || 0) } : { level: 'home', page: 0 };
  } catch { view = { level: 'home', page: 0 }; }
  selectedId = null; render();
}
function go(next) {
  selectedId = null;
  const hash = next.level === 'home' ? '#home' : next.level === 'projects' ? `#codex/${next.page || 0}` : `#codex/project/${encodeURIComponent(next.projectId)}/${next.page || 0}`;
  if (location.hash === hash) { view = next; render(); } else location.hash = hash;
}
function activate(action) {
  if (action.type === 'projects') go({ level: 'projects', page: 0 });
  if (action.type === 'project') go({ level: 'project', projectId: action.id, page: 0 });
  if (action.type === 'back') go({ level: view.level === 'project' ? 'projects' : 'home', page: 0 });
  if (action.type === 'page') go({ ...view, page: action.page });
  if (action.type === 'thread') {
    selectedId = action.id;
    if (mode === 'demo') record('key/pressed', 'Task selected in the emulator. Desktop navigation is unsupported.');
    if (mode === 'live') {
      const link = threadLink(action.id);
      const anchor = [...$('keypad').querySelectorAll('a[data-key-id]')].find(item => item.dataset.keyId === action.id);
      if (link && anchor) { anchor.click(); return; }
      if (!link) notify('This saved task has no supported local chat link.');
    }
    render();
  }
}
function renderKeys() {
  const activeId = document.activeElement?.dataset?.keyId;
  model = buildKeys(getProjects(), { ...view, showAllRuns });
  view.page = model.page;
  $('keypad').innerHTML = model.keys.map((key, i) => {
    const link = mode === 'live' && key.action.type === 'thread' ? threadLink(key.id) : null;
    const tag = link ? 'a' : 'button';
    return `<${tag} class="key ${!key.title ? 'empty' : ''} ${['back', 'previous', 'next'].includes(key.id) ? 'nav-key' : ''} ${selectedId === key.id ? 'selected' : ''}" data-key-id="${escape(key.id)}" data-index="${i}" data-state="${key.state || ''}" ${link ? `href="${link}"` : key.disabled ? 'disabled' : ''} ${selectedId === key.id && !link ? 'aria-pressed="true"' : ''} aria-label="${escape(key.title || 'Unassigned')}${key.state ? `, ${STATE_LABELS[key.state]}${key.badge ? ` ${key.badge}` : ''}` : ''}${key.evidence ? `, ${escape(key.evidence)}` : ''}${key.subtitle ? `, ${escape(key.subtitle)}` : ''}">
    ${key.title ? `<span class="key-number">${i + 1}</span>${icon(key.icon)}<span class="key-title">${escape(key.title)}</span>${key.state ? `<span class="key-status">${key.state === 'needs-attention' ? '◈' : key.state === 'working' ? '●' : key.state === 'done' ? '✓' : key.state === 'error' ? '!' : '○'} ${key.badge > 1 ? key.badge + ' ' : ''}${STATE_LABELS[key.state]}</span>${key.repeatCount > 1 && !showAllRuns ? `<span class="key-evidence">${key.repeatCount} saved runs</span>` : ''}${key.evidence ? `<span class="key-evidence">${escape(key.evidence)}</span>` : ''}` : key.subtitle ? `<span class="key-status">${escape(key.subtitle)}</span>` : ''}` : ''}</${tag}>`;
  }).join('');
  if (activeId) [...$('keypad').querySelectorAll('button,a')].find(item => item.dataset.keyId === activeId && !item.disabled)?.focus({ preventScroll: true });
  $('page-label').textContent = view.level === 'home' ? 'HOME' : `${model.page + 1} / ${model.pages}`;
  const project = getProjects().find(p => p.id === view.projectId);
  $('breadcrumbs').innerHTML = `<button data-level="home">Home</button>${view.level !== 'home' ? '<span aria-hidden="true">/</span><button data-level="projects">Codex</button>' : ''}${view.level === 'project' ? `<span aria-hidden="true">/</span><button data-level="project" aria-current="page">${escape(project?.name || 'Unavailable')}</button>` : ''}`;
  $('device-status').innerHTML = `<i></i> ${mode === 'demo' ? offline ? 'OFFLINE' : 'DEMO' : live.connected ? 'CONNECTED' : 'OFFLINE'}`;
  $('device-status').dataset.connected = String(mode === 'demo' ? !offline : live.connected);
}
function renderInspector() {
  $('grouping-control').hidden = mode !== 'live' || !live.projectCatalog;
  $('catalog-note').textContent = live.projectCatalog ? `Projects refresh automatically from saved Codex metadata. Saved order may differ from the sidebar. ${live.projectCatalog.unmatchedTasks} other saved tasks are available under All saved folders.` : '';
  const legendStates = mode === 'live' ? ['needs-attention', 'working', 'idle', 'observed-active', 'possible-attention', 'stopped', 'unknown'] : ['needs-attention', 'working', 'done', 'idle', 'error', 'unknown'];
  document.querySelector('.legend').innerHTML = legendStates.map(state => `<span><i class="dot ${statusClass(state)}"></i>${STATE_LABELS[state]}</span>`).join('');
  const projects = getProjects();
  const thread = selectedThread();
  const project = projects.find(p => p.id === view.projectId);
  const collapsedCount = project ? project.threads.length - collapseRepeatedTasks(project.threads).length : 0;
  $('runs-control').hidden = mode !== 'live' || view.level !== 'project' || !collapsedCount;
  $('show-all-runs').checked = showAllRuns;
  $('runs-note').textContent = `${collapsedCount} earlier runs share a title. The keypad shows the latest or active run; all saved tasks remain available here.`;
  const relevant = view.level === 'project' ? project?.threads || [] : allThreads();
  const summary = aggregate(relevant);
  $('inspector-label').textContent = thread ? 'TASK INSPECTOR' : 'AT A GLANCE';
  $('source-badge').textContent = mode === 'demo' ? 'SAMPLE DATA' : live.desktopStatusEnabled ? 'METADATA + LIVE CHECKS' : live.activityEnabled ? 'METADATA + OBSERVATIONS' : 'SAVED METADATA';
  let html = mode === 'demo' && offline ? '<div class="offline-notice">Connection interrupted. These are the last known sample states. Reconnect to continue the simulation.</div>' : '';
  if (thread) {
    html += `<h2>${escape(thread.name)}</h2><span class="state-pill ${thread.state}"><i class="dot ${statusClass(thread.state)}"></i>${STATE_LABELS[thread.state]}</span><p class="panel-copy">${escape(mode === 'demo' ? sampleDescriptions[thread.state] : thread.preview || 'No task preview available.')}</p>
      ${mode === 'live' && thread.statusSource === 'desktop-ipc' ? `<p class="capability-note">Live desktop status checked at ${escape(new Date(thread.statusCheckedAt).toLocaleTimeString())}. This private IPC integration is experimental.</p>` : ''}
      ${mode === 'live' && thread.observation ? `<p class="capability-note">Last event: ${escape(thread.observation.event)} at ${escape(new Date(thread.observation.observedAt).toLocaleTimeString())}. ${thread.observation.stale ? 'Current status is unknown; this last event is retained for context.' : 'Recent evidence only: events can arrive late or be missed.'} A stopped reply may contain a question. Questions in reply text are not detected by this feed.</p>` : ''}
      <dl class="task-meta"><div><dt>Project directory</dt><dd class="mono">${escape(thread.cwd)}</dd></div><div><dt>Task ID</dt><dd class="mono">${escape(thread.id)}</dd></div></dl>
      ${mode === 'live' && threadLink(thread.id) ? `<a class="primary-button" href="${threadLink(thread.id)}">Open in Codex <span>↗</span></a>` : '<button class="primary-button" disabled>Open in Codex <span>Unavailable</span></button>'}
      <div class="task-actions">${mode === 'live' && live.desktopStatusEnabled ? '<button id="check-status" class="text-button">Check live status ↻</button>' : ''}<button id="copy-id" class="text-button">Copy task ID ↗</button><button id="clear-selection" class="text-button">Close inspector</button></div>
      <p class="capability-note">${mode === 'live' ? 'Task keys use the documented Codex deep link to request the local chat.' : 'Sample tasks stay inside this emulator.'}</p>`;
  } else {
    const title = view.level === 'home' ? 'A little less context switching.' : project ? project.name : 'Your work, grouped.';
    const description = mode === 'live' && !projects.length ? 'Read saved tasks through a protected local connection. No Codex server is started.' : view.level === 'home' ? 'Press Codex to find your projects. The attention count follows you all the way down to the task that needs you.' : view.level === 'project' ? 'Choose a task to inspect its state. The bottom row keeps navigation within reach.' : 'Each key holds one project. Choose a project to see its tasks.';
    html += `<h2>${escape(title)}</h2><p class="panel-copy">${description}</p><div class="metrics"><div class="metric"><strong>${mode === 'live' && !live.desktopStatusEnabled ? '—' : summary.counts['needs-attention']}</strong><span>${mode === 'live' ? 'seen needing you' : 'need you'}</span></div><div class="metric"><strong>${mode === 'live' && !live.desktopStatusEnabled ? '—' : summary.counts.working}</strong><span>${mode === 'live' ? 'seen working' : 'working'}</span></div><div class="metric"><strong>${view.level === 'project' ? relevant.length : projects.length}</strong><span>${view.level === 'project' ? 'tasks' : 'projects'}</span></div></div>`;
    const attention = relevant.filter(t => t.state === 'needs-attention').slice(0, 3);
    html += `<div class="section-label">${attention.length ? 'WAITING FOR YOU' : mode === 'live' && live.desktopStatusEnabled ? 'LIVE STATUS COVERAGE' : summary.counts.unknown ? 'STATE VISIBILITY' : 'READY WHEN YOU ARE'}</div>`;
    if (attention.length) html += `<div class="attention-list">${attention.map(t => `<button class="attention-item" data-thread-id="${escape(t.id)}"><span>${escape(t.name)}<small>${escape(projects.find(p => p.id === t.projectId)?.name || '')}</small></span><span class="attention-icon" aria-hidden="true">↗</span></button>`).join('')}</div>`;
    else html += `<p class="panel-copy">${mode === 'live' && live.desktopStatusEnabled ? `${relevant.filter(t => t.statusSource === 'desktop-ipc').length} of ${relevant.length} saved tasks have a recent live check. The newest recent task in each visible project is checked automatically; select any task to check it. Unchecked tasks remain Unknown.` : summary.counts.unknown ? `${summary.counts.unknown} tasks have no verified current state. Saved metadata does not tell us whether they are running or finished.` : relevant.length ? mode === 'live' ? 'Recent observations appear on the keys. Running and waiting totals are unavailable.' : 'No tasks in this view need your attention.' : view.level === 'project' ? 'No tasks are available in this project.' : 'Projects will appear here after connecting.'}</p>`;
  }
  $('inspector-body').innerHTML = html;
  $('simulation-panel').hidden = mode !== 'demo';
  $('connection-panel').hidden = mode !== 'live';
  $('simulation-target').textContent = `Sample task: ${targetThread()?.name || 'none'}`;
  document.querySelectorAll('[data-sim]').forEach(button => { button.disabled = offline; });
  $('disconnect-button').textContent = offline ? 'Reconnect simulation' : 'Simulate disconnect';
  $('connection-message').textContent = local ? live.message : 'Local Codex requires the Node bridge. Run npm start from the project and open http://127.0.0.1:3000. This standalone page supports Demo mode.';
  $('connect-button').disabled = !local || live.connecting || live.liveDiscoveryEnabled === false;
  $('connect-button').textContent = live.liveDiscoveryEnabled === false ? 'Local metadata reading is off' : live.connecting ? 'Reading…' : live.connected ? 'Refresh connection' : 'Read saved tasks ↗';
}
function renderDebug() {
  $('event-log').innerHTML = (mode === 'demo' ? events : live.events).map(event => `<div class="event"><time>${escape(new Date(event.time).toLocaleTimeString())}</time><strong>${escape(event.method)}</strong><p>${escape(event.detail)}</p></div>`).join('') || '<p>No events received.</p>';
  $('raw-model').textContent = JSON.stringify({ mode, view, selectedThread: selectedThread() || null, keys: model.keys }, null, 2);
}
async function checkStatus(id, force = false) {
  if (!id || mode !== 'live' || !live.connected || !live.desktopStatusEnabled || statusChecking ||
      (!force && Date.now() - (statusChecked.get(id) || 0) < 30000)) return;
  statusChecked.set(id, Date.now());
  statusChecking = true;
  try {
    const response = await fetch(`/api/status/${encodeURIComponent(id)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    if (force && !response.ok) notify('Live status is unavailable for this task.');
  } catch { if (force) notify('Could not reach the desktop status observer.'); }
  finally { statusChecking = false; }
}
async function checkVisibleProjects() {
  if (scanningVisibleProjects || mode !== 'live' || view.level !== 'projects' || !live.connected || !live.desktopStatusEnabled) return;
  scanningVisibleProjects = true;
  const page = view.page;
  try {
    // Check one recent task per visible project, sequentially. Historical tasks remain Unknown.
    for (const key of model.keys) {
      if (mode !== 'live' || view.level !== 'projects' || view.page !== page) break;
      if (key.action.type !== 'project') continue;
      const task = getProjects().find(project => project.id === key.id)?.threads[0];
      if (task && Date.now() - task.updatedAt < 24 * 60 * 60 * 1000) await checkStatus(task.id);
    }
  } finally {
    scanningVisibleProjects = false;
    // A project may have been opened while a background check was in flight.
    if (mode === 'live' && view.level === 'project') render();
  }
}
function render() {
  renderKeys(); renderInspector(); if (!$('debug-panel').hidden) renderDebug();
  if (mode === 'live' && view.level === 'projects') void checkVisibleProjects();
  if (mode === 'live' && view.level === 'project') {
    const project = getProjects().find(p => p.id === view.projectId);
    const candidate = selectedId ? selectedThread() : project?.threads.find(t => t.id === model.keys.find(key => key.action.type === 'thread')?.id);
    if (candidate && (selectedId || Date.now() - candidate.updatedAt < 24 * 60 * 60 * 1000)) void checkStatus(candidate.id);
  }
}
function setMode(next) {
  mode = next; selectedId = null;
  if (next === 'demo') { stream?.close(); stream = null; connectRequest?.abort(); live.connecting = false; }
  $('demo-mode').setAttribute('aria-pressed', String(next === 'demo'));
  $('live-mode').setAttribute('aria-pressed', String(next === 'live'));
  go({ level: next === 'demo' ? 'home' : 'projects', page: 0 });
  render();
  if (next === 'live' && local) startStream();
}
function startStream() {
  stream?.close();
  stream = new EventSource('/api/events');
  stream.onmessage = event => {
    if (mode !== 'live') return;
    try { live = JSON.parse(event.data); render(); } catch { notify('Invalid response from the local bridge.'); }
  };
  stream.onerror = () => {
    if (mode !== 'live') return;
    live.connected = false;
    live.projects = live.projects.map(p => ({ ...p, threads: p.threads.map(t => ({ ...t, state: 'unknown', observation: t.observation ? { ...t.observation, stale: true } : undefined })) }));
    live.message = 'The local bridge is unreachable. Showing the last received data; the connection will retry automatically.';
    render();
  };
}
$('connect-button').addEventListener('click', async () => {
  connectRequest?.abort(); const controller = new AbortController(); connectRequest = controller;
  live.connecting = true; render();
  try {
    const response = await fetch('/api/connect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', signal: controller.signal });
    const result = await response.json();
    if (mode === 'live') { live = result; render(); }
  } catch (error) {
    if (mode !== 'live' || error.name === 'AbortError') return;
    live.connecting = false; live.connected = false; live.message = 'Cannot reach the local bridge. Run npm start and reconnect.'; render();
  }
});
$('demo-mode').addEventListener('click', () => setMode('demo'));
$('live-mode').addEventListener('click', () => setMode('live'));
$('grouping-mode').addEventListener('change', event => { grouping = event.target.value; go({ level: 'projects', page: 0 }); render(); });
$('show-all-runs').addEventListener('change', event => { showAllRuns = event.target.checked; go({ ...view, page: 0 }); });
$('keypad').addEventListener('click', event => {
  const key = event.target.closest('[data-index]'); if (!key || key.disabled || key.tagName === 'A') return;
  activate(model.keys[Number(key.dataset.index)].action);
});
$('breadcrumbs').addEventListener('click', event => { const level = event.target.dataset.level; if (level) go({ ...view, level, page: 0 }); });
$('inspector-body').addEventListener('click', async event => {
  const button = event.target.closest('button'); if (!button) return;
  if (button.dataset.threadId) {
    const thread = allThreads().find(t => t.id === button.dataset.threadId);
    const project = getProjects().find(p => p.id === thread.projectId);
    view = { level: 'project', projectId: thread.projectId, page: Math.floor(project.threads.findIndex(t => t.id === thread.id) / 6) };
    history.pushState(null, '', `#codex/project/${encodeURIComponent(thread.projectId)}/${view.page}`);
    selectedId = thread.id; render();
  }
  if (button.id === 'clear-selection') { selectedId = null; render(); }
  if (button.id === 'check-status') void checkStatus(selectedId, true);
  if (button.id === 'copy-id') {
    try { await navigator.clipboard.writeText(selectedId); notify('Task ID copied.'); }
    catch { notify('Clipboard unavailable. Select the task ID above to copy it.'); }
  }
});
$('simulation-panel').addEventListener('click', event => {
  const state = event.target.dataset.sim;
  if (!state || offline || mode !== 'demo') return;
  const target = targetThread(); if (!target) return;
  const message = state === 'done'
    ? { method: 'turn/completed', params: { threadId: target.id, turn: { status: 'completed' } } }
    : { method: 'thread/status/changed', params: { threadId: target.id, status: state === 'error' ? { type: 'systemError' } : { type: 'active', activeFlags: state === 'needs-attention' ? ['waitingOnApproval'] : [] } } };
  sample = applyEvent(sample, message);
  record(message.method, `${target.name}: ${STATE_LABELS[target.state]} → ${STATE_LABELS[state]} (simulated)`);
  render(); notify(`${target.name} → ${STATE_LABELS[state]}`);
});
$('disconnect-button').addEventListener('click', () => { offline = !offline; record(offline ? 'demo/disconnected' : 'demo/reconnected', offline ? 'Sample updates paused. Keys retain their last known states.' : 'Sample updates available again.'); render(); });
$('reset-button').addEventListener('click', () => { sample = demoProjects(); offline = false; selectedId = null; events = []; record('demo/reset', 'Original sample tasks restored.'); go({ level: 'home', page: 0 }); render(); notify('Demo reset.'); });
$('debug-toggle').addEventListener('click', () => { const show = $('debug-panel').hidden; $('debug-panel').hidden = !show; $('debug-toggle').setAttribute('aria-expanded', String(show)); $('debug-toggle').textContent = show ? 'Hide diagnostics ⌁' : 'Show diagnostics ⌁'; if (show) renderDebug(); });
$('about-button').addEventListener('click', () => $('about-dialog').showModal());
$('close-about').addEventListener('click', () => $('about-dialog').close());
document.addEventListener('keydown', event => {
  if ($('about-dialog').open || event.metaKey || event.ctrlKey || event.altKey || event.repeat || ['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName) || event.target.isContentEditable) return;
  if (/^[1-9]$/.test(event.key)) {
    const index = Number(event.key) - 1; if (!model.keys[index].disabled) { event.preventDefault(); activate(model.keys[index].action); }
  } else if (event.key === 'Escape') { event.preventDefault(); if (selectedId) { selectedId = null; render(); } else if (view.level !== 'home') activate({ type: 'back' }); }
  else if (event.key === 'ArrowRight' && view.page < model.pages - 1) { event.preventDefault(); activate({ type: 'page', page: view.page + 1 }); }
  else if (event.key === 'ArrowLeft' && view.page > 0) { event.preventDefault(); activate({ type: 'page', page: view.page - 1 }); }
});
window.addEventListener('hashchange', parseRoute);
document.querySelector('.skip-link').addEventListener('click', event => {
  event.preventDefault(); $('keypad').focus();
});
parseRoute();
if (local) {
  fetch('/api/snapshot').then(response => response.json()).then(snapshot => {
    if (!snapshot.liveDiscoveryEnabled || mode !== 'demo') return;
    live = snapshot;
    mode = 'live';
    $('demo-mode').setAttribute('aria-pressed', 'false');
    $('live-mode').setAttribute('aria-pressed', 'true');
    render();
    startStream();
  }).catch(() => {});
}
