import { createServer, type Socket } from 'node:net';
import { mkdir, lstat, realpath, chmod } from 'node:fs/promises';
import { join } from 'node:path';

export const OBSERVATION_TTL = 30_000;
export const HOOK_EVENTS = new Set(['UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PermissionRequest', 'Stop', 'Interrupt']);
const ID = /^[a-zA-Z0-9_-]{1,128}$/;
export const defaultEventDirectory = () => `/private/tmp/codex-keypad-${process.getuid!()}`;

export function validateObservation(value: any, now = Date.now()) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (Object.keys(value).sort().join(',') !== 'event,eventId,observedAt,sessionId,turnId,version') return null;
  if (value.version !== 1 || !HOOK_EVENTS.has(value.event) || !ID.test(value.sessionId) || !ID.test(value.turnId) || !ID.test(value.eventId)) return null;
  if (![value.sessionId, value.turnId, value.eventId].every(v => typeof v === 'string')) return null;
  if (!Number.isSafeInteger(value.observedAt) || value.observedAt > now + 2000 || value.observedAt < now - OBSERVATION_TTL) return null;
  return { version: 1, event: value.event, eventId: value.eventId, observedAt: value.observedAt, sessionId: value.sessionId, turnId: value.turnId };
}

export class ActivityStore {
  entries = new Map<string, any>();
  seen = new Map<string, number>();
  restore(values: unknown, now = Date.now()) {
    if (!Array.isArray(values) || values.length > 10_000) return;
    for (const value of values) {
      if (!Number.isSafeInteger(value?.observedAt) || value.observedAt > now + 2000 || value.observedAt < now - 7 * 86400_000) continue;
      const event = validateObservation(value, value.observedAt);
      if (event) this.accept(event, value.observedAt);
    }
  }
  dump() {
    return [...this.entries.values()].map(({ receivedAt, ...event }) => event);
  }
  accept(value: unknown, now = Date.now()) {
    const event = validateObservation(value, now);
    if (!event || this.seen.has(event.eventId)) return false;
    this.seen.set(event.eventId, now);
    while (this.seen.size > 4096) this.seen.delete(this.seen.keys().next().value!);
    const previous = this.entries.get(event.sessionId);
    if (previous && previous.observedAt >= event.observedAt) return false;
    this.entries.delete(event.sessionId);
    this.entries.set(event.sessionId, { ...event, receivedAt: now });
    while (this.entries.size > 10_000) this.entries.delete(this.entries.keys().next().value!);
    return true;
  }
  project(projects: any[], now = Date.now()) {
    return projects.map(project => ({ ...project, threads: project.threads.map((thread: any) => {
      const observation = this.entries.get(thread.id);
      if (!observation) return thread;
      const stale = now - observation.observedAt > OBSERVATION_TTL;
      const state = stale ? 'unknown' : observation.event === 'PermissionRequest' ? 'possible-attention'
        : observation.event === 'Stop' ? 'stopped' : observation.event === 'Interrupt' ? 'interrupted' : 'observed-active';
      return { ...thread, state, observation: { ...observation, stale } };
    }) }));
  }
}

/** Private Unix socket; no HTTP ingestion, arbitrary paths, or Codex RPC. */
export async function startActivityReceiver(onEvent: (event: unknown) => void, directory = defaultEventDirectory()) {
  if (process.platform !== 'darwin') throw new Error('The protected observer requires macOS.');
  try { await mkdir(directory, { mode: 0o700 }); } catch (error: any) { if (error.code !== 'EEXIST') throw error; }
  const stat = await lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid!() || (stat.mode & 0o777) !== 0o700 || await realpath(directory) !== directory) throw new Error('Unsafe observer directory.');
  const path = join(directory, 'events.sock');
  // Refuse existing sockets or files. Never delete something to make startup succeed.
  try { await lstat(path); throw new Error('Observer destination already exists.'); } catch (error: any) { if (error.code !== 'ENOENT') throw error; }
  const sockets = new Set<Socket>();
  let ready = false;
  const server = createServer(socket => {
    if (!ready || sockets.size >= 32) { socket.destroy(); return; }
    sockets.add(socket);
    socket.setTimeout(500, () => socket.destroy());
    let chunks: Buffer[] = [], size = 0;
    socket.on('data', chunk => {
      size += chunk.length;
      if (size > 2048) { socket.destroy(); return; }
      chunks.push(chunk);
    });
    socket.on('end', () => {
      try { const event = validateObservation(JSON.parse(Buffer.concat(chunks).toString('utf8'))); if (event) { onEvent(event); socket.end('ok'); return; } } catch {}
      socket.end();
    });
    socket.on('error', () => {});
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(path, resolve); });
  try { await chmod(path, 0o600); ready = true; }
  catch (error) { server.close(); throw error; }
  return { path, close: () => new Promise<void>(resolve => { ready = false; for (const socket of sockets) socket.destroy(); server.close(() => resolve()); }) };
}
