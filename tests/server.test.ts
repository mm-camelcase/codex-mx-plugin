import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { get } from 'node:http';
import { createKeypadServer } from '../server.ts';
import { ActivityStore } from '../packages/activity/receiver.ts';
class FakeClient extends EventEmitter {
  connected = false;
  async connect() { this.connected = true; return {}; }
  async listThreads() { return [{ id: 'test', cwd: '/demo/project', name: 'Example', status: { type: 'notLoaded' }, updatedAt: 1 }]; }
  close() { this.connected = false; this.emit('disconnected'); }
}
test('HTTP bridge rejects cross-origin and arbitrary files, and streams discovered state', async () => {
  let connections = 0;
  const { server, cleanup } = createKeypadServer({ allowLocalRead: true, clientFactory: () => { connections++; return new FakeClient() as any; }, pollMs: 60000 });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address() as any;
  const base = `http://127.0.0.1:${address.port}`;
  try {
    assert.equal((await fetch(base)).status, 200);
    for (const path of ['/server.ts', '/.env', '/packages/codex-client/client.ts', '/README.md']) assert.equal((await fetch(base + path)).status, 404);
    const hostileHostStatus = await new Promise((resolve, reject) => {
      get(base + '/api/snapshot', { headers: { Host: 'untrusted.example' } }, response => {
        response.resume(); resolve(response.statusCode);
      }).on('error', reject);
    });
    assert.equal(hostileHostStatus, 403);
    assert.equal((await fetch(base + '/api/snapshot', { headers: { Origin: 'https://untrusted.example' } })).status, 403);
    assert.equal((await fetch(base + '/api/connect', { method: 'POST' })).status, 403);
    assert.equal(connections, 0);
    const response = await fetch(base + '/api/connect', { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' }, body: '{}' });
    const snapshot = await response.json();
    assert.equal(response.status, 200); assert.equal(snapshot.connected, true);
    assert.equal(snapshot.projects[0].threads[0].state, 'unknown');
    assert.equal(snapshot.navigationSupported, true); assert.equal(connections, 1);
    const controller = new AbortController();
    const events = await fetch(base + '/api/events', { signal: controller.signal });
    assert.match(events.headers.get('content-type')!, /text\/event-stream/);
    const chunk = await events.body!.getReader().read();
    assert.match(new TextDecoder().decode(chunk.value), /"name":"Example"/);
    controller.abort();
  } finally { cleanup(); await new Promise(resolve => server.close(resolve)); }
});

test('default bridge refuses live discovery without starting any Codex client', async () => {
  let spawned = false;
  const { server, cleanup } = createKeypadServer({ clientFactory: () => { spawned = true; return new FakeClient() as any; } });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  try {
    const response = await fetch(base + '/api/connect', { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(response.status, 503);
    assert.equal((await response.json()).liveDiscoveryEnabled, false);
    assert.equal(spawned, false);
  } finally { cleanup(); await new Promise(resolve => server.close(resolve)); }
});

test('hook observations reach HTTP snapshots, survive metadata refresh, and have no HTTP ingestion route', async () => {
  const activityStore = new ActivityStore();
  const { server, cleanup, observe } = createKeypadServer({ activityStore, allowLocalRead: true, clientFactory: () => new FakeClient() as any });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const refresh = () => fetch(base + '/api/connect', { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' }, body: '{}' });
  try {
    await refresh();
    observe({ version: 1, sessionId: 'test', turnId: 'turn-test', eventId: 'event-test', event: 'PermissionRequest', observedAt: Date.now() });
    let snapshot = await (await fetch(base + '/api/snapshot')).json();
    assert.equal(snapshot.projects[0].threads[0].state, 'possible-attention');
    assert.equal(snapshot.activityEnabled, true);
    assert.equal(snapshot.runtimeScope, 'saved-metadata-with-observations');
    snapshot = await (await refresh()).json();
    assert.equal(snapshot.projects[0].threads[0].observation.event, 'PermissionRequest');
    assert.equal((await fetch(base + '/api/observe', { method: 'POST' })).status, 405);
    assert.equal((await fetch(base + '/packages/activity/receiver.ts')).status, 404);
    assert.equal((await fetch(base + '/plugins/codex-keypad-observer/scripts/observe.py')).status, 404);
  } finally { cleanup(); await new Promise(resolve => server.close(resolve)); }
});

test('periodic refresh updates the project catalog without imports or reconnecting', async () => {
  const client = new FakeClient() as any;
  const makeCatalog = (name: string) => ({ version: 1, capturedAt: new Date().toISOString(), source: 'saved-project-metadata', projects: [{ id: 'p', name, cwd: '/demo/project' }] });
  client.projectCatalog = makeCatalog('Before');
  const { server, cleanup } = createKeypadServer({ allowLocalRead: true, clientFactory: () => client, pollMs: 20 });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  try {
    const response = await fetch(base + '/api/connect', { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal((await response.json()).projects[0].name, 'Before');
    client.projectCatalog = makeCatalog('After');
    let snapshot: any;
    const deadline = Date.now() + 2000;
    do {
      await new Promise(resolve => setTimeout(resolve, 25));
      snapshot = await (await fetch(base + '/api/snapshot')).json();
    } while (snapshot.projects[0].name !== 'After' && Date.now() < deadline);
    assert.equal(snapshot.projects[0].name, 'After');
    assert.equal(snapshot.projectCatalog.source, 'saved-project-metadata');
    assert.equal(snapshot.projects[0].threads[0].name, 'Example');
  } finally { cleanup(); await new Promise(resolve => server.close(resolve)); }
});

test('a failed protected refresh retries and reconnects without another browser action', async () => {
  class FlakyClient extends FakeClient {
    reads = 0;
    override async listThreads() {
      this.reads++;
      if (this.reads === 2) throw new Error('Temporary read failure');
      return super.listThreads();
    }
  }
  const client = new FlakyClient();
  const { server, cleanup } = createKeypadServer({ allowLocalRead: true, clientFactory: () => client as any, pollMs: 20 });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  try {
    await fetch(base + '/api/connect', { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' }, body: '{}' });
    let snapshot: any;
    const deadline = Date.now() + 2000;
    do {
      await new Promise(resolve => setTimeout(resolve, 20));
      snapshot = await (await fetch(base + '/api/snapshot')).json();
    } while (client.reads < 3 && Date.now() < deadline);
    assert.ok(client.reads >= 3, 'the reader should retry after one failed refresh');
    assert.equal(snapshot.connected, true);
  } finally { cleanup(); await new Promise(resolve => server.close(resolve)); }
});

test('on-demand desktop status is restricted to saved tasks and overrides unknown metadata briefly', async () => {
  const checked: string[] = [];
  const { server, cleanup } = createKeypadServer({ allowLocalRead: true, desktopStatusEnabled: true,
    clientFactory: () => new FakeClient() as any,
    statusReader: async id => { checked.push(id); return { status: { type: 'active', activeFlags: ['waitingOnUserInput'] } }; } });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const post = (id: string) => fetch(base + '/api/status/' + id, { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' }, body: '{}' });
  try {
    await fetch(base + '/api/connect', { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal((await post('unknown')).status, 404);
    assert.deepEqual(checked, []);
    assert.equal((await post('test')).status, 200);
    assert.deepEqual(checked, ['test']);
    const snapshot = await (await fetch(base + '/api/snapshot')).json();
    assert.equal(snapshot.projects[0].threads[0].state, 'needs-attention');
    assert.equal(snapshot.projects[0].threads[0].statusSource, 'desktop-ipc');
  } finally { cleanup(); await new Promise(resolve => server.close(resolve)); }
});
