import { DatabaseSync, constants as sql } from 'node:sqlite';
import { lstatSync, readFileSync } from 'node:fs';
import { isAbsolute, join, resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateCatalog } from '../domain/projects.js';

export function openReadOnlyDatabase(path) {
  if (!isAbsolute(path)) throw new Error('The metadata database must be an absolute filesystem path.');
  // Never accept URI options such as mode=rw, never create a missing file, never follow a final symlink.
  for (const file of [path, path + '-wal', path + '-shm']) {
    try { if (!lstatSync(file).isFile()) throw new Error('Only regular metadata files are supported.'); }
    catch (error) { if (file !== path && error.code === 'ENOENT') continue; throw error; }
  }
  const db = new DatabaseSync(path, { readOnly: true, allowExtension: false, defensive: true, timeout: 500 });
  try {
    db.exec('PRAGMA query_only=ON; PRAGMA trusted_schema=OFF;');
    db.setAuthorizer((action, first, second) => {
      if ([sql.SQLITE_SELECT, sql.SQLITE_READ, sql.SQLITE_TRANSACTION].includes(action)) return sql.SQLITE_OK;
      if (action === sql.SQLITE_FUNCTION && ['substr', 'coalesce', 'nullif'].includes(second)) return sql.SQLITE_OK;
      if (action === sql.SQLITE_PRAGMA && first === 'table_info' && ['threads', 'projects', 'project_roots'].includes(second)) return sql.SQLITE_OK;
      return sql.SQLITE_DENY; // Includes INSERT/UPDATE/DELETE, ATTACH, DDL, and all mutating pragmas.
    });
    return db;
  } catch (error) { db.close(); throw error; }
}
export function repositoryRoot(cwd) {
  // Inspect only Git administrative pointers; never invoke Git or follow a script/config.
  try {
    if (!isAbsolute(cwd)) return null;
    const dotgit = join(cwd, '.git');
    const stat = lstatSync(dotgit);
    if (stat.isDirectory()) return cwd;
    if (!stat.isFile() || stat.size > 4096) return null;
    const pointer = /^gitdir: ([^\r\n]+)\r?\n?$/.exec(readFileSync(dotgit, 'utf8'));
    if (!pointer) return null;
    const gitdir = resolve(cwd, pointer[1]);
    if (basename(dirname(gitdir)) !== 'worktrees' || basename(dirname(dirname(gitdir))) !== '.git') return null;
    const commonFile = join(gitdir, 'commondir'), commonStat = lstatSync(commonFile);
    if (!commonStat.isFile() || commonStat.size > 4096) return null;
    const common = resolve(gitdir, readFileSync(commonFile, 'utf8').trim());
    if (common !== dirname(dirname(gitdir)) || !lstatSync(common).isDirectory()) return null;
    return dirname(common);
  } catch { return null; }
}

function readProjectCatalog(db) {
  for (const [table, required] of [['projects', ['id', 'name', 'position']], ['project_roots', ['project_id', 'position', 'path']]]) {
    const schema = db.prepare('SELECT type, sql FROM sqlite_schema WHERE name = ?').get(table);
    if (schema?.type !== 'table' || /\bVIRTUAL\b/i.test(schema.sql || '')) throw new Error('Unsupported project schema');
    const columns = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(row => row.name));
    if (!required.every(column => columns.has(column))) throw new Error('Unsupported project schema');
  }
  const rows = db.prepare('SELECT id, name FROM projects ORDER BY position, id LIMIT 1001').all();
  const roots = db.prepare('SELECT project_id, path FROM project_roots ORDER BY project_id, position LIMIT 10001').all();
  if (rows.length > 1000 || roots.length > 10000) throw new Error('Project catalog exceeds limits');
  const byId = new Map();
  for (const root of roots) {
    if (!byId.has(root.project_id)) byId.set(root.project_id, []);
    byId.get(root.project_id).push(root.path);
  }
  return validateCatalog({ version: 1, capturedAt: new Date().toISOString(), source: 'saved-project-metadata',
    projects: rows.map(row => ({ id: row.id, name: row.name, cwd: byId.get(row.id)?.[0], rootPaths: byId.get(row.id) })) });
}

export function readSavedMetadata(path) {
  const db = openReadOnlyDatabase(path);
  try {
    db.exec('BEGIN');
    const schema = db.prepare("SELECT type, sql FROM sqlite_schema WHERE name = 'threads'").get();
    if (schema?.type !== 'table' || /\bVIRTUAL\b/i.test(schema.sql || '')) throw new Error('Unsupported Codex metadata schema.');
    const columns = new Set(db.prepare('PRAGMA table_info(threads)').all().map(row => row.name));
    if (!['id', 'cwd', 'title', 'source', 'archived', 'updated_at'].every(column => columns.has(column))) throw new Error('Unsupported Codex metadata schema.');
    const title = columns.has('name') ? "coalesce(nullif(name, ''), title)" : 'title';
    const preview = columns.has('preview') ? "substr(coalesce(preview, ''), 1, 800)" : "''";
    // Whitelisted column expressions only. No paths, SQL, task IDs, or filters from the browser.
    const projectId = columns.has('project_id') ? 'project_id' : 'NULL';
    const rows = db.prepare(`SELECT id, cwd, ${projectId} AS savedProjectId, substr(${title}, 1, 160) AS name, ${preview} AS preview, updated_at AS updatedAt
      FROM threads WHERE archived = 0 AND source IN ('cli', 'vscode', 'exec', 'appServer', 'unknown')
      ORDER BY updated_at DESC, id ASC LIMIT 10001`).all();
    let projectCatalog = null;
    try { projectCatalog = readProjectCatalog(db); } catch { /* Unknown schemas show folders; never repair or consult a stale import. */ }
    db.exec('COMMIT');
    const repositories = new Map();
    const threads = rows.slice(0, 10000).map(row => {
      if (!repositories.has(row.cwd)) repositories.set(row.cwd, repositoryRoot(row.cwd));
      return { ...row, repositoryRoot: repositories.get(row.cwd), status: null };
    }); // Runtime state is not in this snapshot.
    return { version: 1, threads, projectCatalog, truncated: rows.length > 10000, capturedAt: new Date().toISOString(), scope: 'saved-metadata' };
  } finally { db.close(); }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    if (process.env.KEYPAD_READER_SANDBOX !== '1') throw new Error('Use the protected reader launcher.');
    process.stdout.write(JSON.stringify(readSavedMetadata(process.argv[2])));
  } catch {
    process.stdout.write(JSON.stringify({ error: 'Metadata could not be read without writes. The file may be busy, unavailable, or use an unsupported schema. No repair or fallback was attempted.' }));
    process.exitCode = 1;
  }
}
