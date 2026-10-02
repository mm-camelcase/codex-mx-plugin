// Destructive attempts are permitted only against a disposable test fixture.
import { writeFileSync, unlinkSync, renameSync, truncateSync, mkdirSync, chmodSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
const [source, sentinel] = process.argv.slice(2);
const attempts = [
  ['overwrite', () => writeFileSync(sentinel, 'changed')],
  ['delete', () => unlinkSync(sentinel)],
  ['rename', () => renameSync(sentinel, sentinel + '.moved')],
  ['truncate', () => truncateSync(sentinel, 0)],
  ['chmod', () => chmodSync(sentinel, 0o777)],
  ['create-directory', () => mkdirSync(sentinel + '.dir')],
  ['sql-write', () => { const db = new DatabaseSync(source); try { db.exec("DELETE FROM threads"); } finally { db.close(); } }],
  ['create-sidecar', () => writeFileSync(source + '-journal', 'changed')]
];
const result = attempts.map(([name, operation]) => {
  try { operation(); return { name, blocked: false }; } catch (error) { return { name, blocked: true, code: error.code }; }
});
process.stdout.write(JSON.stringify(result));
