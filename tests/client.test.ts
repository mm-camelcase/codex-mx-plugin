import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, lstatSync, rmSync, symlinkSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CodexClient } from '../packages/codex-client/client.ts';
import { runReadOnlyWorker } from '../packages/codex-client/sandbox.ts';
import { openReadOnlyDatabase } from '../packages/codex-client/metadata-reader.mjs';
function fixture(wal = false) {
  const directory = mkdtempSync(join(tmpdir(), 'keypad-reader-test-'));
  const path = join(directory, 'state_5.sqlite');
  const db = new DatabaseSync(path);
  if (wal) db.exec('PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0');
  db.exec(`CREATE TABLE threads(id TEXT PRIMARY KEY, cwd TEXT, title TEXT, name TEXT, preview TEXT, updated_at INTEGER, source TEXT, archived INTEGER, rollout_path TEXT);
    INSERT INTO threads VALUES ('task-a', '/fixture/infra', 'Fallback title', 'Real task name', 'Preview', 123, 'vscode', 0, '/fixture/stale-path');
    INSERT INTO threads VALUES ('archived', '/fixture/infra', 'Archived', NULL, '', 122, 'vscode', 1, '/fixture/archived');
    INSERT INTO threads VALUES ('child', '/fixture/infra', 'Spawned', NULL, '', 124, 'subAgent', 0, '/fixture/child');`);
  writeFileSync(join(directory, 'transcript.jsonl'), 'never modify this fixture transcript\n');
  return { directory, path, db, close() { db.close(); rmSync(directory, { recursive: true, force: true }); } };
}
function fingerprint(directory) {
  return Object.fromEntries(readdirSync(directory).sort().map(name => {
    const path = join(directory, name), stat = lstatSync(path);
    return [name, { hash: createHash('sha256').update(readFileSync(path)).digest('hex'), bytes: stat.size, modified: stat.mtimeMs, mode: stat.mode }];
  }));
}
test('protected reader gets committed WAL metadata and leaves database, sidecars and transcripts byte-identical', async () => {
  const f = fixture(true); const client = new CodexClient({ databasePath: f.path });
  try {
    const before = fingerprint(f.directory);
    await client.connect();
    const rows = await client.listThreads();
    assert.equal(rows.length, 1); assert.equal(rows[0].name, 'Real task name');
    assert.equal(rows[0].status, null);
    assert.equal('rollout_path' in rows[0], false);
    assert.deepEqual(fingerprint(f.directory), before);
    f.db.exec("INSERT INTO threads VALUES ('task-b', '/fixture/web', 'New task', NULL, '', 125, 'vscode', 0, '/fixture/new')");
    const afterWriter = fingerprint(f.directory);
    assert.equal((await client.listThreads()).length, 2);
    assert.deepEqual(fingerprint(f.directory), afterWriter);
  } finally { client.close(); f.close(); }
});
test('OS boundary blocks overwrite, delete, rename, truncate, chmod, directory creation, SQL writes and sidecar creation', async () => {
  const f = fixture(true);
  try {
    const before = fingerprint(f.directory);
    const result = await runReadOnlyWorker(fileURLToPath(new URL('./fixtures/attempt-mutations.mjs', import.meta.url)), [f.path, join(f.directory, 'transcript.jsonl')]);
    assert.equal(result.length, 8);
    for (const attempt of result) assert.equal(attempt.blocked, true, `${attempt.name} unexpectedly succeeded`);
    assert.deepEqual(fingerprint(f.directory), before);
  } finally { f.close(); }
});
test('SQLite layer independently rejects mutation, ATTACH, and writable-schema commands', () => {
  const f = fixture();
  try {
    const before = fingerprint(f.directory), db = openReadOnlyDatabase(f.path);
    try {
      for (const sql of ["DELETE FROM threads", "UPDATE threads SET rollout_path='changed'", 'DROP TABLE threads', "ATTACH DATABASE ':memory:' AS other", 'PRAGMA writable_schema=ON', 'VACUUM']) assert.throws(() => db.exec(sql));
    } finally { db.close(); }
    assert.deepEqual(fingerprint(f.directory), before);
  } finally { f.close(); }
});
test('missing, symlinked, malformed and unsupported databases fail without creation or repair', async () => {
  const f = fixture();
  try {
    writeFileSync(join(f.directory, 'broken.sqlite'), 'not a database');
    symlinkSync(f.path, join(f.directory, 'link.sqlite'));
    const unsupported = new DatabaseSync(join(f.directory, 'other.sqlite')); unsupported.exec('CREATE TABLE different(id TEXT)'); unsupported.close();
    for (const name of ['missing.sqlite', 'broken.sqlite', 'link.sqlite', 'other.sqlite']) {
      const client = new CodexClient({ databasePath: join(f.directory, name) });
      try { await client.connect(); await assert.rejects(client.listThreads(), /could not be read without writes/); }
      finally { client.close(); }
    }
    assert.equal(readdirSync(f.directory).includes('missing.sqlite'), false);
    assert.equal(readFileSync(join(f.directory, 'broken.sqlite'), 'utf8'), 'not a database');
  } finally { f.close(); }
});
test('reader timeout fails closed and inherited NODE_OPTIONS are not executed', async () => {
  const f = fixture();
  const previous = process.env.NODE_OPTIONS;
  try {
    const worker = join(f.directory, 'wait.mjs');
    writeFileSync(worker, 'setInterval(() => {}, 1000);');
    await assert.rejects(runReadOnlyWorker(worker, [], { timeoutMs: 100 }), /timed out/);
    process.env.NODE_OPTIONS = '--this-option-does-not-exist';
    const client = new CodexClient({ databasePath: f.path });
    try { await client.connect(); assert.equal((await client.listThreads()).length, 1); } finally { client.close(); }
  } finally { if (previous === undefined) delete process.env.NODE_OPTIONS; else process.env.NODE_OPTIONS = previous; f.close(); }
});

test('uncommitted changes are excluded and reading cannot change a stale rollout pointer', async () => {
  const f = fixture(true), client = new CodexClient({ databasePath: f.path });
  try {
    await client.connect();
    f.db.exec("BEGIN; UPDATE threads SET name = 'Uncommitted rename' WHERE id = 'task-a'");
    assert.equal((await client.listThreads())[0].name, 'Real task name');
    f.db.exec('ROLLBACK');
    assert.equal(f.db.prepare("SELECT rollout_path FROM threads WHERE id = 'task-a'").get().rollout_path, '/fixture/stale-path');
  } finally { client.close(); f.close(); }
});
test('WAL database needing sidecar creation fails without creating those files', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'keypad-no-sidecars-'));
  const path = join(directory, 'state_5.sqlite');
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode=WAL; CREATE TABLE threads(id TEXT)'); db.close();
  const client = new CodexClient({ databasePath: path });
  try {
    const before = fingerprint(directory);
    await client.connect(); await assert.rejects(client.listThreads());
    assert.deepEqual(fingerprint(directory), before);
  } finally { client.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('project discovery follows committed additions, renames, order and removals without writing the source', async () => {
  const f = fixture(true), client = new CodexClient({ databasePath: f.path });
  try {
    f.db.exec(`CREATE TABLE projects(id TEXT PRIMARY KEY, name TEXT, position INTEGER);
      CREATE TABLE project_roots(project_id TEXT, position INTEGER, path TEXT);
      ALTER TABLE threads ADD COLUMN project_id TEXT;
      INSERT INTO projects VALUES ('a', 'First', 0), ('b', 'Empty project', 1);
      INSERT INTO project_roots VALUES ('a', 0, '/fixture/infra'), ('a', 1, '/fixture/secondary'), ('b', 0, '/fixture/empty');
      UPDATE threads SET project_id = 'a' WHERE id = 'task-a';`);
    await client.connect();
    let before = fingerprint(f.directory);
    const tasks = await client.listThreads();
    assert.equal(tasks[0].savedProjectId, 'a');
    assert.deepEqual(client.projectCatalog.projects.map(p => p.name), ['First', 'Empty project']);
    assert.deepEqual(client.projectCatalog.projects[0].rootPaths, ['/fixture/infra', '/fixture/secondary']);
    assert.deepEqual(fingerprint(f.directory), before);
    // Only the fixture writer simulates Codex updates. The reader remains OS-protected.
    f.db.exec(`BEGIN; UPDATE projects SET name = 'Renamed', position = 3 WHERE id = 'a';
      INSERT INTO projects VALUES ('c', 'New', 2); INSERT INTO project_roots VALUES ('c', 0, '/fixture/new'); COMMIT;`);
    before = fingerprint(f.directory);
    await client.listThreads();
    assert.deepEqual(client.projectCatalog.projects.map(p => p.name), ['Empty project', 'New', 'Renamed']);
    assert.deepEqual(fingerprint(f.directory), before);
    f.db.exec("BEGIN; DELETE FROM project_roots WHERE project_id = 'b'; DELETE FROM projects WHERE id = 'b'; COMMIT;");
    before = fingerprint(f.directory);
    await client.listThreads();
    assert.deepEqual(client.projectCatalog.projects.map(p => p.name), ['New', 'Renamed']);
    assert.deepEqual(fingerprint(f.directory), before);
    const guarded = openReadOnlyDatabase(f.path);
    try {
      for (const command of ['DELETE FROM projects', 'DELETE FROM project_roots', "UPDATE projects SET name = 'changed'"]) assert.throws(() => guarded.exec(command));
    } finally { guarded.close(); }
  } finally { client.close(); f.close(); }
});

test('missing or invalid project schemas fall back to task folders without stale catalogs or repairs', async () => {
  const f = fixture(), client = new CodexClient({ databasePath: f.path });
  try {
    await client.connect();
    await client.listThreads(); assert.equal(client.projectCatalog, null);
    f.db.exec(`CREATE TABLE projects(id TEXT, name TEXT, position INTEGER);
      CREATE TABLE project_roots(project_id TEXT, position INTEGER, path TEXT);
      INSERT INTO projects VALUES ('a', 'Valid', 0); INSERT INTO project_roots VALUES ('a', 0, '/fixture/project');`);
    await client.listThreads(); assert.equal(client.projectCatalog.projects.length, 1);
    f.db.exec("UPDATE project_roots SET path = 'relative/invalid'");
    const before = fingerprint(f.directory);
    assert.equal((await client.listThreads()).length, 1);
    assert.equal(client.projectCatalog, null);
    assert.deepEqual(fingerprint(f.directory), before);
  } finally { client.close(); f.close(); }
});
