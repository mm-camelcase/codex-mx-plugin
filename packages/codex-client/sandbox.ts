import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { isAbsolute } from 'node:path';

/** No writes anywhere, including SQLite sidecars. No network in either direction. */
export const READER_PROFILE = '(version 1)(allow default)(deny file-write*)(deny network*)';
export const STATUS_PROFILE = '(version 1)(allow default)(deny file-write*)';
export const SANDBOX_EXEC = '/usr/bin/sandbox-exec';

export function runReadOnlyWorker(worker: string, args: string[], options: { timeoutMs?: number; onSpawn?: (child: ChildProcessWithoutNullStreams) => void } = {}): Promise<any> {
  if (process.platform !== 'darwin') return Promise.reject(new Error('Protected local discovery currently requires macOS.'));
  if (!isAbsolute(worker)) return Promise.reject(new Error('The reader must be an absolute local module path.'));
  return new Promise((resolve, reject) => {
    // Fixed executable/profile; no shell, inherited NODE_OPTIONS, Codex binary, or socket.
    const child = spawn(SANDBOX_EXEC, ['-p', READER_PROFILE, process.execPath, worker, ...args], {
      stdio: 'pipe', env: { PATH: '/usr/bin:/bin', LANG: 'en_US.UTF-8', KEYPAD_READER_SANDBOX: '1' }
    });
    options.onSpawn?.(child);
    let output = '';
    let size = 0;
    let settled = false;
    const finish = (error: Error | null, data?: unknown) => {
      if (settled) return; settled = true; clearTimeout(timer);
      if (error) { child.kill(); reject(error); } else resolve(data);
    };
    const timer = setTimeout(() => finish(new Error('Protected reader timed out; no fallback was attempted.')), options.timeoutMs ?? 5000);
    child.stdin.end();
    child.stdout.setEncoding('utf8');
    child.stderr.on('data', () => {}); // Never expose host paths or logs through the HTTP API.
    child.on('error', () => finish(new Error('The operating-system reader sandbox is unavailable.')));
    child.stdout.on('data', chunk => {
      size += Buffer.byteLength(chunk);
      if (size > 16 * 1024 * 1024) { finish(new Error('Protected reader response exceeded its limit.')); return; }
      output += chunk.toString('utf8');
    });
    child.once('close', code => {
      if (settled) return;
      let result;
      try { result = JSON.parse(output); } catch { finish(new Error('Protected reader could not run. Local discovery remains disconnected.')); return; }
      if (code !== 0 || result.error) { finish(new Error(result.error || 'Protected reader failed.')); return; }
      finish(null, result);
    });
  });
}

/** Separate one-shot IPC worker: filesystem writes denied, Unix socket allowed. */
export function runStatusWorker(worker: string, threadId: string): Promise<{ status: any; initialized: boolean; oversizedFrames: number }> {
  if (process.platform !== 'darwin' || !isAbsolute(worker)) return Promise.reject(new Error('Protected desktop status requires macOS and an absolute worker path.'));
  return new Promise((resolve, reject) => {
    const child = spawn(SANDBOX_EXEC, ['-p', STATUS_PROFILE, process.execPath, worker, threadId], {
      stdio: 'pipe', env: { PATH: '/usr/bin:/bin', LANG: 'en_US.UTF-8', HOME: process.env.HOME || '', CODEX_HOME: process.env.CODEX_HOME || '', KEYPAD_STATUS_SANDBOX: '1' }
    });
    child.stdin.end();
    let output = '', settled = false;
    const finish = (error: Error | null, result?: any) => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      if (error) { child.kill(); reject(error); } else resolve(result);
    };
    const timer = setTimeout(() => finish(new Error('Desktop status check timed out.')), 7000);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      output += chunk;
      if (output.length > 4096) finish(new Error('Desktop status response exceeded its limit.'));
    });
    child.stderr.on('data', () => {});
    child.once('error', () => finish(new Error('Protected status worker unavailable.')));
    child.once('close', code => {
      if (settled) return;
      let result;
      try { result = JSON.parse(output); } catch { finish(new Error('Protected status worker returned no result.')); return; }
      if (code !== 0 || !result.initialized) { finish(new Error('Codex desktop IPC status unavailable.')); return; }
      finish(null, result);
    });
  });
}
