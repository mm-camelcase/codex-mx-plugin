import { homedir } from 'node:os';
import { join } from 'node:path';
import { CodexClient } from '../packages/codex-client/client.ts';
import { probeDesktopIpc } from '../packages/codex-client/desktop-ipc.mjs';

const client = new CodexClient();
await client.connect();
let thread;
try {
  const tasks = await client.listThreads();
  thread = tasks.find(task => task.cwd === process.cwd());
} finally { client.close(); }
if (!thread) throw new Error('No saved task for this project; no IPC connection was attempted.');
const socketPath = join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'ipc', 'ipc.sock');
const result = await probeDesktopIpc({ socketPath, threadId: thread.id });
console.log(JSON.stringify({ task: 'most recently updated task in this project', ...result }));
