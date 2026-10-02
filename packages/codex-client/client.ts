import { EventEmitter } from 'node:events';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { homedir } from 'node:os';
import { join, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runReadOnlyWorker } from './sandbox.ts';

/** Reads saved metadata under OS-enforced write denial. Never starts or contacts Codex. */
export class CodexClient extends EventEmitter {
  connected = false;
  child: ChildProcessWithoutNullStreams | null = null;
  truncated = false;
  projectCatalog: any = null;
  databasePath: string;
  constructor(options: { databasePath?: string } = {}) {
    super();
    this.databasePath = options.databasePath || join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'state_5.sqlite');
    if (!isAbsolute(this.databasePath)) throw new Error('The metadata database must use an absolute path.');
  }
  async connect() {
    if (process.platform !== 'darwin') throw new Error('Protected local discovery currently requires macOS.');
    this.connected = true;
  }
  async listThreads() {
    if (!this.connected) throw new Error('The metadata reader is disconnected.');
    if (this.child) throw new Error('A metadata read is already running.');
    try {
      const result = await runReadOnlyWorker(fileURLToPath(new URL('./metadata-reader.mjs', import.meta.url)), [this.databasePath], {
        onSpawn: child => { this.child = child; }
      });
      if (!this.connected) throw new Error('The metadata read was cancelled.');
      if (result.version !== 1 || !Array.isArray(result.threads)) throw new Error('Unsupported metadata reader response.');
      this.truncated = result.truncated;
      this.projectCatalog = result.projectCatalog || null;
      return result.threads;
    } finally { this.child = null; }
  }
  close() {
    this.connected = false;
    this.child?.kill(); // Only this reader child, never a Codex process.
    this.emit('disconnected');
  }
}
