import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { mkdtempSync, chmodSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { probeDesktopIpc } from '../packages/codex-client/desktop-ipc.mjs';
import { STATUS_PROFILE } from '../packages/codex-client/sandbox.ts';

const id = '01a08543-bb74-7462-ae60-cc41ecad6fed';
function frame(value) {
  const body = Buffer.from(JSON.stringify(value));
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length);
  return Buffer.concat([header, body]);
}

test('private IPC observer sends only follow/status requests and extracts a status from a large snapshot', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'keypad-ipc-'));
  chmodSync(dir, 0o700);
  const path = join(dir, 'ipc.sock');
  const sent = [];
  const server = createServer(socket => {
    let buffer = Buffer.alloc(0);
    socket.on('data', chunk => {
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length >= 4 && buffer.length >= buffer.readUInt32LE() + 4) {
        const size = buffer.readUInt32LE();
        const message = JSON.parse(buffer.subarray(4, size + 4).toString());
        buffer = buffer.subarray(size + 4);
        sent.push(message.method);
        if (message.method === 'initialize') socket.write(frame({ type: 'response', method: 'initialize', resultType: 'success', result: { clientId: 'test-client' } }));
        if (message.method === 'thread-stream-following-status-requested') {
          socket.write(frame({ type: 'broadcast', method: 'thread-stream-state-changed', params: {
            conversationId: id, change: { type: 'snapshot', conversationState: {
              threadRuntimeStatus: { type: 'active', activeFlags: ['waitingOnApproval'] }, history: 'x'.repeat(2 * 1024 * 1024)
            } }
          } }));
        }
      }
    });
  });
  try {
    await new Promise(resolve => server.listen(path, resolve));
    chmodSync(path, 0o600);
    const result = await probeDesktopIpc({ socketPath: path, threadId: id, timeoutMs: 3000 });
    assert.deepEqual(result.status, { type: 'active', activeFlags: ['waitingOnApproval'] });
    assert.equal(result.oversizedFrames, 1);
    assert.deepEqual(sent, ['initialize', 'thread-stream-following-changed', 'thread-stream-following-status-requested']);
  } finally {
    await new Promise(resolve => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  }
});

test('desktop status worker policy denies filesystem writes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'keypad-status-policy-'));
  const target = join(dir, 'sentinel');
  writeFileSync(target, 'untouched');
  try {
    const child = spawnSync('/usr/bin/sandbox-exec', ['-p', STATUS_PROFILE, process.execPath, '-e',
      'require("node:fs").writeFileSync(process.argv[1], "changed")', target], { encoding: 'utf8' });
    assert.notEqual(child.status, 0);
    assert.equal(readFileSync(target, 'utf8'), 'untouched');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
