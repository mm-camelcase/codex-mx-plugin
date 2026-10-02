import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, realpath, chmod, symlink, lstat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { ActivityStore, startActivityReceiver, validateObservation, OBSERVATION_TTL } from '../packages/activity/receiver.ts';
import { aggregate } from '../packages/domain/model.js';

const event = (overrides = {}) => ({ version: 1, sessionId: 'task-a', turnId: 'turn-a', event: 'PreToolUse', observedAt: Date.now(), eventId: 'event-a', ...overrides });
const projects = [{ id: 'project', threads: [{ id: 'task-a', state: 'unknown' }, { id: 'task-b', state: 'unknown' }] }];
const directory = async () => realpath(await mkdtemp(join(tmpdir(), 'keypad-observer-test-')));
const worker = resolve('plugins/codex-keypad-observer/scripts/worker.py');
async function sandboxPython(script: string, args: string[], input: string, destination: string) {
  const profile = `(version 1)(allow default)(deny file-write*)(deny network*)(allow network-outbound (literal "${destination}"))`;
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn('/usr/bin/sandbox-exec', ['-p', profile, '/usr/bin/python3', '-I', '-B', script, ...args], { env: { PATH: '/usr/bin:/bin', LANG: 'en_US.UTF-8' }, stdio: 'pipe' });
    const timer = setTimeout(() => { child.kill(); reject(new Error('Observer test timed out')); }, 3000);
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => stdout += chunk);
    child.stderr.on('data', chunk => stderr += chunk);
    child.stdin.on('error', () => {}); child.stdin.end(input);
    child.on('error', reject);
    child.on('close', code => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
  });
}
const send = (path: string, value: string) => new Promise<void>((resolve, reject) => {
  const socket = connect(path, () => socket.end(value)); socket.resume(); socket.on('error', reject); socket.on('close', () => resolve());
});

test('observations are bounded, deduplicated, expire, and never imply completion or a definite approval wait', () => {
  const store = new ActivityStore(), now = Date.now();
  assert.equal(store.accept(event({ observedAt: now }), now), true);
  assert.equal(store.accept(event({ observedAt: now }), now), false);
  assert.equal(store.project(projects, now)[0].threads[0].state, 'observed-active');
  assert.equal(store.project(projects, now + OBSERVATION_TTL + 1)[0].threads[0].state, 'unknown');
  assert.equal(store.project(projects, now)[0].threads[1].state, 'unknown');
  assert.equal(store.accept(event({ eventId: 'late', observedAt: now - 1 }), now), false);
  assert.equal(store.accept(event({ eventId: 'approval', observedAt: now + 1, event: 'PermissionRequest' }), now + 1), true);
  assert.equal(aggregate(store.project(projects, now + 1)[0].threads).state, 'possible-attention');
  store.accept(event({ eventId: 'stop', observedAt: now + 2, event: 'Stop' }), now + 2);
  assert.equal(store.project(projects, now + 2)[0].threads[0].state, 'stopped');
  store.accept(event({ eventId: 'interrupt', observedAt: now + 3, event: 'Interrupt' }), now + 3);
  assert.equal(store.project(projects, now + 3)[0].threads[0].state, 'interrupted');
  assert.equal(new ActivityStore().project(projects, now)[0].threads[0].state, 'unknown');
  for (const invalid of [null, [], event({ prompt: 'secret' }), event({ sessionId: '../../elsewhere' }), event({ event: 'DELETE' }), event({ observedAt: now - OBSERVATION_TTL - 1 }), event({ observedAt: now + 2001 }), event({ sessionId: 123 })]) assert.equal(validateObservation(invalid, now), null);
});

test('sandboxed hook strips private input and sends through the private receiver; malformed and oversized payloads are ignored', async () => {
  const dir = await directory(), received: any[] = [];
  const receiver = await startActivityReceiver(e => received.push(e), dir);
  try {
    assert.equal((await lstat(receiver.path)).mode & 0o777, 0o600);
    const input = JSON.stringify({ session_id: 'task-a', turn_id: 'turn-a', hook_event_name: 'Stop', prompt: 'PRIVATE', last_assistant_message: 'PRIVATE', transcript_path: '/never/read', tool_input: { command: 'rm -rf anything' } });
    const result = await sandboxPython(worker, [receiver.path], input, receiver.path);
    assert.equal(result.code, 0, result.stderr); assert.equal(result.stdout, '{}'); assert.equal(result.stderr, '');
    assert.equal(received.length, 1);
    assert.equal(received[0].event, 'Stop'); assert.equal(JSON.stringify(received).includes('PRIVATE'), false);
    assert.equal(Object.keys(received[0]).length, 6);
    for (const raw of ['{invalid', JSON.stringify({ ...event(), prompt: 'PRIVATE' }), 'x'.repeat(3000)]) await send(receiver.path, raw).catch(() => {});
    for (const input of ['bad json', 'x'.repeat(65537), '{}', JSON.stringify({ session_id: '../bad', turn_id: 'turn-a', hook_event_name: 'Stop' })]) {
      const result = await sandboxPython(worker, [receiver.path], input, receiver.path);
      assert.equal(result.code, 0); assert.equal(result.stdout, '{}');
    }
    assert.equal(received.length, 1);
  } finally { await receiver.close(); await rm(dir, { recursive: true, force: true }); }
});

test('observer policy blocks fixture mutations and any other local socket or TCP connection', async () => {
  const dir = await directory(), otherDir = await directory();
  const receiver = await startActivityReceiver(() => {}, dir);
  const other = await startActivityReceiver(() => assert.fail('Unexpected connection'), otherDir);
  const target = join(dir, 'transcript.jsonl'), script = join(dir, 'attack.py');
  await writeFile(target, 'fixture content');
  await writeFile(script, `import os,sys,socket,json,sqlite3\np=sys.argv[1]\nresults=[]\nchecks=[lambda:open(p,'w'),lambda:os.unlink(p),lambda:os.rename(p,p+'.moved'),lambda:os.truncate(p,0),lambda:os.chmod(p,0o777),lambda:os.mkdir(p+'.dir'),lambda:sqlite3.connect(p+'.sqlite'),lambda:socket.socket(socket.AF_UNIX).connect(sys.argv[2]),lambda:socket.socket().connect(('127.0.0.1',9))]\nfor check in checks:\n try:\n  check();results.append(False)\n except (OSError,sqlite3.Error):results.append(True)\nprint(json.dumps(results))\n`);
  try {
    const before = await lstat(target);
    const result = await sandboxPython(script, [target, other.path], '', receiver.path);
    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), Array(9).fill(true));
    assert.equal(await readFile(target, 'utf8'), 'fixture content');
    const after = await lstat(target); assert.equal(after.mtimeMs, before.mtimeMs); assert.equal(after.mode, before.mode);
  } finally { await receiver.close(); await other.close(); await rm(dir, { recursive: true, force: true }); await rm(otherDir, { recursive: true, force: true }); }
});

test('unsafe destinations fail without replacement; missing receiver does not block the hook', async () => {
  const dir = await directory();
  try {
    const path = join(dir, 'events.sock');
    await writeFile(path, 'must preserve');
    await assert.rejects(startActivityReceiver(() => {}, dir));
    assert.equal(await readFile(path, 'utf8'), 'must preserve');
    await chmod(dir, 0o755); await assert.rejects(startActivityReceiver(() => {}, dir), /Unsafe/); await chmod(dir, 0o700);
    const link = dir + '-link'; await symlink(dir, link);
    try { await assert.rejects(startActivityReceiver(() => {}, link), /Unsafe/); } finally { await rm(link); }
    const result = await sandboxPython(worker, [join(dir, 'missing.sock')], JSON.stringify({ session_id: 'task-a', turn_id: 'turn-a', hook_event_name: 'PreToolUse' }), join(dir, 'missing.sock'));
    assert.equal(result.code, 0); assert.equal(result.stdout, '{}');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('unmodified production launcher delivers safely and stays neutral when nested sandboxing is unavailable', async () => {
  const received: any[] = [];
  const receiver = await startActivityReceiver(e => received.push(e));
  const launcher = resolve('plugins/codex-keypad-observer/scripts/observe.py');
  const input = JSON.stringify({ session_id: 'synthetic-launcher-test', turn_id: 'synthetic-turn', hook_event_name: 'UserPromptSubmit', prompt: 'must discard' });
  try {
    const result = await new Promise<any>((resolve, reject) => {
      const child = spawn('/usr/bin/python3', ['-I', '-B', launcher], { env: { PATH: '/usr/bin:/bin', PYTHONPATH: '/does-not-exist' }, stdio: 'pipe' });
      let stdout = '', stderr = '';
      child.stdout.on('data', c => stdout += c); child.stderr.on('data', c => stderr += c);
      child.stdin.end(input); child.on('error', reject); child.on('close', code => resolve({ code, stdout, stderr }));
    });
    assert.deepEqual(result, { code: 0, stdout: '{}', stderr: '' });
    assert.equal(received.length, 1); assert.equal(received[0].sessionId, 'synthetic-launcher-test');
    const nested = await sandboxPython(launcher, [], input, receiver.path);
    assert.deepEqual(nested, { code: 0, stdout: '{}', stderr: '' });
    assert.equal(received.length, 1, 'No unprotected fallback when nested sandboxing fails');
  } finally { await receiver.close(); }
});
