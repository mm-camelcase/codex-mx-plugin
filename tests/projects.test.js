import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { catalogProjects, validateCatalog, disambiguateFolders } from '../packages/domain/projects.js';
import { groupThreads } from '../packages/domain/model.js';
import { buildKeys } from '../packages/keypad-model/keys.js';
import { repositoryRoot } from '../packages/codex-client/metadata-reader.mjs';

test('saved project labels/order win; explicitly named worktrees stay separate and other worktrees join their main checkout', () => {
  const catalog = validateCatalog({ version: 1, capturedAt: new Date().toISOString(), projects: [
    { id: 'review', name: 'docs_review', cwd: '/worktrees/review/docs' },
    { id: 'main', name: 'docs', cwd: '/docs' },
    { id: 'empty', name: 'Empty', cwd: '/empty' }
  ] });
  const result = catalogProjects(groupThreads([
    { id: 'r', cwd: '/worktrees/review/docs', repositoryRoot: '/docs' },
    { id: 'm', cwd: '/docs' },
    { id: 'w', cwd: '/worktrees/other/docs', repositoryRoot: '/docs' },
    { id: 'old', cwd: '/tmp/docs' }
  ]), catalog);
  assert.deepEqual(result.projects.map(p => p.name), ['docs_review','docs','Empty']);
  assert.deepEqual(result.projects.map(p => p.threads.length), [1,2,0]);
  assert.equal(result.projects[1].threads.find(t => t.id === 'w').projectId, '/docs');
  assert.equal(result.unmatched[0].threads[0].id, 'old');
  assert.equal(disambiguateFolders(groupThreads([{id:'a',cwd:'/tmp/docs'},{id:'b',cwd:'/real/docs'}]))[0].name.includes('·'), true);
  assert.throws(() => validateCatalog({ ...catalog, projects: [catalog.projects[0], catalog.projects[0]] }));
});

test('Git pointers resolve without running Git or changing worktree metadata', () => {
  const dir = mkdtempSync(join(tmpdir(), 'keypad-git-fixture-'));
  try {
    const main = join(dir, 'main'), worktree = join(dir, 'worktree'), admin = join(main, '.git/worktrees/test');
    mkdirSync(admin, { recursive: true }); mkdirSync(worktree);
    const pointer = join(worktree, '.git'), common = join(admin, 'commondir');
    writeFileSync(pointer, `gitdir: ${admin}\n`); writeFileSync(common, '../..\n');
    assert.equal(repositoryRoot(worktree), main);
    assert.equal(repositoryRoot(main), main);
    assert.equal(readFileSync(pointer,'utf8'), `gitdir: ${admin}\n`);
    assert.equal(readFileSync(common,'utf8'), '../..\n');
    writeFileSync(common, '/unexpected\n'); assert.equal(repositoryRoot(worktree), null);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('expired observations stay visible on task keys without pretending they are current', () => {
  const projects = [{id:'p',name:'Project',threads:[{id:'a',name:'Task',state:'unknown',observation:{event:'Stop',stale:true}}]}];
  const key = buildKeys(projects,{level:'project',projectId:'p'}).keys[0];
  assert.equal(key.state,'unknown'); assert.equal(key.evidence,'Last: stop seen');
});

test('explicit task project assignments and secondary roots override folder guesses', () => {
  const catalog = validateCatalog({ version: 1, capturedAt: new Date().toISOString(), projects: [
    { id: 'a', name: 'Alpha', cwd: '/alpha', rootPaths: ['/alpha', '/shared'] },
    { id: 'b', name: 'Beta', cwd: '/beta', rootPaths: ['/beta', '/secondary', '/shared'] }
  ] });
  const result = catalogProjects(groupThreads([
    { id: 'assigned', cwd: '/alpha', savedProjectId: 'b' },
    { id: 'secondary', cwd: '/secondary' },
    { id: 'ambiguous', cwd: '/shared' },
    { id: 'removed', cwd: '/alpha', savedProjectId: 'no-longer-saved' }
  ]), catalog);
  assert.deepEqual(result.projects.map(p => p.threads.length), [0, 2]);
  assert.equal(result.unmatched.reduce((n, p) => n + p.threads.length, 0), 2);
});
