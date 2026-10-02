import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { probeDesktopIpc } from './desktop-ipc.mjs';

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    if (process.env.KEYPAD_STATUS_SANDBOX !== '1') throw new Error('The protected launcher is required.');
    const socketPath = join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'ipc', 'ipc.sock');
    const result = await probeDesktopIpc({ socketPath, threadId: process.argv[2], timeoutMs: 5000 });
    process.stdout.write(JSON.stringify({ status: result.status, initialized: result.initialized, oversizedFrames: result.oversizedFrames }));
  } catch {
    process.stdout.write(JSON.stringify({ status: null, initialized: false }));
    process.exitCode = 1;
  }
}
