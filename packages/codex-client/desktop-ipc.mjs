import { createConnection } from 'node:net';
import { lstatSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

const MAX_FRAME = 2 * 1024 * 1024;
const MAX_WIRE_FRAME = 32 * 1024 * 1024;
const ID = /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i;

function checkedSocket(path) {
  const parent = lstatSync(dirname(path));
  const socket = lstatSync(path);
  if (!parent.isDirectory() || parent.uid !== process.getuid() || (parent.mode & 0o077) ||
      !socket.isSocket() || socket.uid !== process.getuid() || (socket.mode & 0o077)) {
    throw new Error('IPC socket ownership or permissions are unsafe.');
  }
}

function encode(message) {
  const payload = Buffer.from(JSON.stringify(message));
  const header = Buffer.alloc(4);
  header.writeUInt32LE(payload.length);
  return Buffer.concat([header, payload]);
}

function statusObject(fragment) {
  const start = fragment.indexOf('{');
  if (start < 0) return null;
  let depth = 0, quoted = false, escaped = false;
  for (let i = start; i < fragment.length; i++) {
    const char = fragment[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') quoted = false;
    } else if (char === '"') quoted = true;
    else if (char === '{') depth++;
    else if (char === '}' && --depth === 0) {
      try {
        const value = JSON.parse(fragment.slice(start, i + 1));
        return value;
      } catch { return null; }
    }
  }
  return null;
}

/** Extracts only a status-sized JSON object while discarding a large snapshot. */
class LargeFrameStatus {
  constructor(threadId) {
    this.idToken = `"conversationId":"${threadId}"`;
    this.marker = '"threadRuntimeStatus":';
    this.tail = '';
    this.fragment = null;
    this.match = false;
    this.markerSeen = false;
    this.status = null;
    this.fieldShape = null;
    this.fieldKeys = null;
  }
  feed(bytes) {
    const text = bytes.toString('utf8');
    const combined = this.tail + text;
    if (combined.includes(this.idToken)) this.match = true;
    if (this.fragment !== null && !this.status) this.fragment += text.slice(0, 4096 - this.fragment.length);
    else if (this.fragment === null) {
      const position = combined.indexOf(this.marker);
      if (position >= 0) {
        this.markerSeen = true; this.fragment = combined.slice(position + this.marker.length, position + this.marker.length + 4096);
        this.fieldShape = { startsObject: this.fragment.trimStart().startsWith('{'), startsNull: this.fragment.trimStart().startsWith('null') };
      }
    }
    if (this.fragment !== null) {
      if (this.fragment.length <= 4096) {
        const value = statusObject(this.fragment);
        if (value && typeof value === 'object') {
          this.fieldKeys = Object.keys(value).slice(0, 12);
          if (typeof value.type === 'string') this.status = { type: value.type,
            activeFlags: Array.isArray(value.activeFlags) ? value.activeFlags.filter(x => typeof x === 'string') : [] };
        }
      }
    }
    this.tail = combined.slice(-Math.max(this.idToken.length, this.marker.length));
  }
  result() { return this.match ? this.status : null; }
}

/** One-task, bounded experiment. Never accepts commands or exposes conversation content. */
export async function probeDesktopIpc({ socketPath, threadId, timeoutMs = 5000 }) {
  if (!ID.test(threadId)) throw new Error('A saved UUID task ID is required.');
  checkedSocket(socketPath);
  return new Promise((resolve, reject) => {
    const socket = createConnection(socketPath);
    let buffer = Buffer.alloc(0), remaining = 0, largeFrame = null, oversizedFrames = 0, matchedFrames = 0, statusFields = 0, fieldShape = null, fieldKeys = null, initialized = false;
    let clientId = null, status = null, finished = false;
    const finish = error => {
      if (finished) return;
      finished = true; clearTimeout(timer); socket.destroy();
      if (error) reject(error);
      else resolve({ initialized, status, oversizedFrames, matchedFrames, statusFields, fieldShape, fieldKeys });
    };
    const timer = setTimeout(() => finish(), timeoutMs);
    const send = message => socket.write(encode(message));
    socket.once('connect', () => send({ type: 'request', requestId: randomUUID(), sourceClientId: 'initializing-client', version: 1,
      method: 'initialize', params: { clientType: 'codex-agent-keypad-probe' }, timeoutMs }));
    socket.on('error', finish);
    socket.on('data', chunk => {
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length) {
        if (remaining) {
          const consumed = Math.min(remaining, buffer.length);
          largeFrame?.feed(buffer.subarray(0, consumed));
          buffer = buffer.subarray(consumed); remaining -= consumed;
          if (remaining) return;
          if (largeFrame?.match) matchedFrames++;
          if (largeFrame?.markerSeen) statusFields++;
          if (largeFrame?.markerSeen) fieldShape = largeFrame.fieldShape;
          if (largeFrame?.fieldKeys) fieldKeys = largeFrame.fieldKeys;
          status = largeFrame?.result() || status;
          largeFrame = null;
          if (status) return finish();
        }
        if (buffer.length < 4) return;
        const size = buffer.readUInt32LE();
        if (size === 0 || size > MAX_WIRE_FRAME) return finish(new Error('IPC snapshot exceeds the safe size limit.'));
        if (size > MAX_FRAME) {
          oversizedFrames++;
          buffer = buffer.subarray(4); remaining = size;
          largeFrame = new LargeFrameStatus(threadId);
          continue;
        }
        if (buffer.length < size + 4) return;
        const frame = buffer.subarray(4, size + 4);
        buffer = buffer.subarray(size + 4);
        let message;
        try { message = JSON.parse(frame.toString('utf8')); } catch { continue; }
        if (!initialized && message.type === 'response' && message.method === 'initialize' && message.resultType === 'success') {
          clientId = message.result?.clientId;
          if (typeof clientId !== 'string' || !clientId) return finish(new Error('IPC initialization returned no client ID.'));
          initialized = true;
          send({ type: 'broadcast', method: 'thread-stream-following-changed', sourceClientId: clientId, version: 1,
            params: { conversationId: threadId, hostId: 'local', following: true } });
          send({ type: 'broadcast', method: 'thread-stream-following-status-requested', sourceClientId: clientId, version: 1,
            params: { conversationId: threadId, hostId: 'local' } });
        }
        if (message.type === 'broadcast' && message.method === 'thread-stream-state-changed' &&
            message.params?.conversationId === threadId) {
          const change = message.params.change;
          const candidate = change?.type === 'snapshot' ? change.conversationState?.threadRuntimeStatus : null;
          if (candidate && typeof candidate.type === 'string') status = { type: candidate.type,
            activeFlags: Array.isArray(candidate.activeFlags) ? candidate.activeFlags.filter(x => typeof x === 'string') : [] };
          if (change?.type === 'patches') for (const patch of change.patches || []) {
            if (patch.path?.[0] !== 'threadRuntimeStatus') continue;
            if (patch.path.length === 1 && typeof patch.value?.type === 'string') status = { type: patch.value.type, activeFlags: patch.value.activeFlags || [] };
            else if (patch.path[1] === 'type' && status) status.type = patch.value;
            else if (patch.path[1] === 'activeFlags' && status) status.activeFlags = patch.value;
          }
          if (status) return finish();
        }
      }
    });
  });
}
