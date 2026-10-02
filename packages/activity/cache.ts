import { lstatSync, realpathSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ActivityStore } from './receiver.ts';

/** The bridge's own cache, never a file under Codex's data directory. */
export class ActivityCache {
  readonly path: string;
  constructor(path: string) { this.path = path; }
  safe() {
    if (realpathSync(dirname(this.path)) !== resolve(dirname(this.path))) throw new Error('Cache directory must not be a symlink');
    try {
      const info = lstatSync(this.path);
      if (!info.isFile() || info.size > 8_000_000) throw new Error('Invalid activity cache');
      const data = JSON.parse(readFileSync(this.path,'utf8'));
      if (data.version !== 1 || !Array.isArray(data.observations)) throw new Error('Invalid activity cache');
    }
    catch (error: any) { if (error.code !== 'ENOENT') throw error; }
  }
  load(store: ActivityStore) {
    try {
      this.safe();
      const data = JSON.parse(readFileSync(this.path,'utf8'));
      if (data.version === 1) store.restore(data.observations);
    } catch { /* Unknown until new observations arrive; never repair an invalid file. */ }
  }
  save(store: ActivityStore) {
    try {
      this.safe();
      const temporary = this.path + '.' + randomUUID() + '.tmp';
      writeFileSync(temporary, JSON.stringify({ version: 1, observations: store.dump() }), { flag: 'wx', mode: 0o600 });
      renameSync(temporary, this.path);
    } catch { /* Cache failure must not interfere with Codex or event reception. */ }
  }
}
