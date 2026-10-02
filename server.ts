import { createServer, type ServerResponse } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { runStatusWorker } from './packages/codex-client/sandbox.ts';
import { CodexClient } from './packages/codex-client/client.ts';
import { groupThreads, mapStatus } from './packages/domain/model.js';
import { catalogProjects, disambiguateFolders } from './packages/domain/projects.js';
import { ActivityStore, startActivityReceiver } from './packages/activity/receiver.ts';
import { ActivityCache } from './packages/activity/cache.ts';

export function createKeypadServer(options: { clientFactory?: () => CodexClient; pollMs?: number; allowLocalRead?: boolean; activityStore?: ActivityStore; activityCache?: ActivityCache; desktopStatusEnabled?: boolean; statusReader?: (id: string) => Promise<any> } = {}) {
  const activity = options.activityStore;
  if (activity) options.activityCache?.load(activity);
  let cacheTimer: ReturnType<typeof setTimeout> | undefined;
  let catalog: any = null;
  let catalogWarning = '';
  let client: CodexClient | null = null;
  let projects: any[] = [];
  let connected = false;
  let connecting = false;
  let message = options.allowLocalRead ? 'Read saved task metadata through the protected local reader. No Codex server is started.' : 'Local metadata reading is off. Start with npm run start:local to enable the protected reader. Demo mode remains available.';
  let updatedAt: string | null = null;
  let refreshing: Promise<void> | null = null;
  const clients = new Set<ServerResponse>();
  const events: any[] = [];
  const statuses = new Map<string, { status: any; checkedAt: number }>();
  let statusCheck: Promise<any> | null = null;
  function snapshot() {
    const observed = activity ? activity.project(projects) : projects;
    const folders = observed.map(folder => ({ ...folder, threads: folder.threads.map((thread: any) => {
      const live = statuses.get(thread.id);
      return live && Date.now() - live.checkedAt < 45000 ? { ...thread, state: mapStatus(live.status), rawStatus: live.status, statusSource: 'desktop-ipc', statusCheckedAt: new Date(live.checkedAt).toISOString() } : thread;
    }) }));
    const grouped = catalog ? catalogProjects(folders, catalog) : null;
    return { connected, connecting, projects: grouped?.projects || disambiguateFolders(folders), folders: disambiguateFolders(folders), projectCatalog: catalog ? { capturedAt: catalog.capturedAt, source: catalog.source, unmatchedTasks: grouped!.unmatched.reduce((n: number,p: any) => n+p.threads.length,0) } : null,
      message: message + (activity ? ' Hook receiver enabled. Recent observations expire after 30 seconds; their last event remains visible.' : '') + catalogWarning,
      updatedAt, events, activityEnabled: !!activity, desktopStatusEnabled: options.desktopStatusEnabled === true, liveDiscoveryEnabled: options.allowLocalRead === true, navigationSupported: options.allowLocalRead === true, runtimeScope: options.desktopStatusEnabled ? 'saved-metadata-with-on-demand-desktop-status' : activity ? 'saved-metadata-with-observations' : 'saved-metadata', protection: options.desktopStatusEnabled ? 'macos-deny-writes; fixed-ipc-status-requests' : 'macos-deny-writes-and-network' };
  }
  function observe(event: unknown) {
    if (activity?.accept(event)) {
      if (options.activityCache && !cacheTimer) cacheTimer = setTimeout(() => { options.activityCache!.save(activity); cacheTimer = undefined; }, 1000);
      record('hook/observed', 'Sanitized activity observation received. No conversation content retained.');
      broadcast();
    }
  }
  function broadcast() {
    const payload = `data: ${JSON.stringify(snapshot())}\n\n`;
    for (const response of clients) {
      if (response.writableLength > 1024 * 1024) { response.destroy(); clients.delete(response); }
      else response.write(payload);
    }
  }
  function record(method: string, detail: string) {
    events.unshift({ time: new Date().toISOString(), method, detail });
    events.splice(40);
  }
  async function refresh() {
    if (refreshing) return refreshing;
    const activeClient = client;
    if (!activeClient?.connected) return;
    refreshing = (async () => {
      try {
        const raw = await activeClient.listThreads();
        if (client !== activeClient) return;
        catalog = activeClient.projectCatalog || null;
        catalogWarning = catalog ? '' : ' Saved project catalog unavailable or unsupported; showing saved folders. No manual import is required.';
        projects = groupThreads(raw);
        connected = true;
        updatedAt = new Date().toISOString();
        message = options.desktopStatusEnabled ? 'Saved tasks connected. The optional desktop observer checks recent tasks in visible projects and any selected task through a write-denied worker; unchecked tasks remain Unknown.' : 'Saved task metadata is connected. The reader has no filesystem write or network permission. Tasks without recent activity evidence show Unknown.';
        if (activeClient.truncated) message += ' Showing the 10,000 most recently updated tasks.';
        broadcast();
      } catch {
        if (client !== activeClient) return;
        connected = false;
        message = 'The protected reader could not refresh. Last received data is stale. Retrying through the same write-denied reader; no repair or unprotected fallback was attempted.';
        broadcast();
      }
    })().finally(() => { refreshing = null; });
    return refreshing;
  }
  async function connect() {
    if (connecting) return;
    connecting = true;
    client?.close();
    await refreshing;
    try {
      client = options.clientFactory?.() || new CodexClient({ databasePath: process.env.CODEX_STATE_DB });
    } catch {
      connecting = false;
      connected = false;
      message = 'Invalid local reader configuration. No Codex process was started.';
      broadcast(); return;
    }
    const activeClient = client;
    message = 'Reading saved task metadata…';
    broadcast();
    client.on('disconnected', () => {
      if (client !== activeClient) return;
      connected = false;
      message = 'Metadata reader disconnected. Last received data is stale.';
      broadcast();
    });
    try {
      await client.connect();
      await refresh();
      if (connected) record('metadata/read', 'Saved task metadata read through the OS-protected worker. No Codex server or RPC connection.');
    } catch {
      client.close();
      connected = false;
      message = 'Protected metadata reading is unavailable. macOS and Node 24.16+ are required. No unprotected fallback was attempted.';
    } finally { connecting = false; broadcast(); }
  }
  const staticFiles = new Map([
    ['/', ['public/index.html', 'text/html']], ['/index.html', ['public/index.html', 'text/html']],
    ['/styles.css', ['public/styles.css', 'text/css']], ['/app.js', ['public/app.js', 'text/javascript']],
    ['/demo.js', ['public/demo.js', 'text/javascript']],
    ['/packages/domain/model.js', ['packages/domain/model.js', 'text/javascript']],
    ['/packages/keypad-model/keys.js', ['packages/keypad-model/keys.js', 'text/javascript']]
  ]);
  const server = createServer(async (request, response) => {
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 3000;
    const allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
    const host = request.headers.host || '';
    const origin = request.headers.origin;
    if (!allowedHosts.has(host) || (origin && origin !== `http://${host}`) || request.headers['sec-fetch-site'] === 'cross-site') {
      response.writeHead(403).end('Local same-origin requests only.'); return;
    }
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'self'; base-uri 'none'; form-action 'none'");
    const url = new URL(request.url || '/', `http://${host}`);
    const json = (status: number, data: any) => { response.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(data)); };
    if (url.pathname === '/api/connect' && request.method === 'POST') {
      if (origin !== `http://${host}` || request.headers['content-type'] !== 'application/json') { json(403, { error: 'A same-origin JSON request is required.' }); return; }
      if (options.allowLocalRead !== true) { json(503, snapshot()); return; }
      await connect(); json(connected ? 200 : 503, snapshot()); return;
    }
    if (url.pathname.startsWith('/api/status/') && request.method === 'POST') {
      if (origin !== `http://${host}` || request.headers['content-type'] !== 'application/json' || !options.desktopStatusEnabled || !connected) { json(403, { error: 'Desktop status is unavailable.' }); return; }
      const id = url.pathname.slice('/api/status/'.length);
      if (!projects.some(project => project.threads.some((thread: any) => thread.id === id))) { json(404, { error: 'Saved task not found.' }); return; }
      if (statusCheck) { json(429, { error: 'A desktop status check is already running.' }); return; }
      try {
        statusCheck = options.statusReader?.(id) || runStatusWorker(fileURLToPath(new URL('./packages/codex-client/desktop-status-worker.mjs', import.meta.url)), id);
        const result = await statusCheck;
        if (result?.status) statuses.set(id, { status: result.status, checkedAt: Date.now() });
        else statuses.delete(id);
        broadcast();
        json(200, { status: result?.status || null, source: 'desktop-ipc', checkedAt: new Date().toISOString() });
      } catch { statuses.delete(id); broadcast(); json(503, { status: null, error: 'Desktop status could not be read safely.' }); }
      finally { statusCheck = null; }
      return;
    }
    if (request.method !== 'GET') { response.writeHead(405, { Allow: 'GET' }).end(); return; }
    if (url.pathname === '/api/snapshot') { json(200, snapshot()); return; }
    if (url.pathname === '/api/events') {
      response.writeHead(200, { 'Content-Type': 'text/event-stream', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      clients.add(response); response.write(`data: ${JSON.stringify(snapshot())}\n\n`);
      request.on('close', () => clients.delete(response)); return;
    }
    const file = staticFiles.get(url.pathname);
    if (!file) { response.writeHead(404).end('Not found'); return; }
    try { response.writeHead(200, { 'Content-Type': file[1] + '; charset=utf-8' }).end(await readFile(new URL(file[0], import.meta.url))); }
    catch { response.writeHead(500).end('Could not load the demo.'); }
  });
  const poll = setInterval(() => { if (client?.connected) void refresh(); }, options.pollMs || 10000);
  const heartbeat = setInterval(() => { for (const response of clients) response.write(': heartbeat\n\n'); }, 15000);
  const expiry = activity ? setInterval(broadcast, 1000) : undefined;
  function cleanup() {
    clearTimeout(cacheTimer);
    if (activity) options.activityCache?.save(activity);
    clearInterval(poll); clearInterval(heartbeat); clearInterval(expiry);
    client?.close(); for (const response of clients) response.end();
  }
  server.on('close', cleanup);
  server.on('error', cleanup);
  return { server, cleanup, observe, connect };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const activityStore = process.argv.includes('--events') ? new ActivityStore() : undefined;
  if (activityStore) await mkdir(new URL('./.local/', import.meta.url), { recursive: true, mode: 0o700 });
  const { server, cleanup, observe, connect } = createKeypadServer({ allowLocalRead: process.argv.includes('--local-read'), desktopStatusEnabled: process.argv.includes('--local-read') && process.argv.includes('--desktop-status'), activityStore, activityCache: activityStore ? new ActivityCache(fileURLToPath(new URL('./.local/activity.json', import.meta.url))) : undefined });
  let receiver: Awaited<ReturnType<typeof startActivityReceiver>> | undefined;
  if (activityStore) {
    try { receiver = await startActivityReceiver(observe); console.log('Private hook receiver ready; no Codex hooks were installed.'); }
    catch { cleanup(); console.error('Private hook receiver unavailable. No existing socket or file was removed.'); process.exit(1); }
  }
  const port = Number(process.env.PORT || 3000);
  server.listen(port, '127.0.0.1', () => {
    console.log(`Codex Agent Keypad → http://127.0.0.1:${port}`);
    if (process.argv.includes('--local-read')) void connect();
  });
  server.on('error', error => { console.error(error.message); cleanup(); void receiver?.close(); process.exitCode = 1; });
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { cleanup(); void receiver?.close(); server.close(); });
}
