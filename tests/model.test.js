import test from 'node:test';
import assert from 'node:assert/strict';
import { mapStatus, reduceState, aggregate, groupThreads, applyEvent } from '../packages/domain/model.js';
import { buildKeys, collapseRepeatedTasks } from '../packages/keypad-model/keys.js';
import { demoProjects } from '../public/demo.js';

test('unloaded and future statuses are unknown; idle never implies completion or attention', () => {
  for (const raw of [undefined, { type: 'notLoaded' }, { type: 'future' }]) assert.equal(mapStatus(raw), 'unknown');
  assert.equal(mapStatus({ type: 'idle' }), 'idle');
  assert.equal(mapStatus({ type: 'active', activeFlags: [] }), 'working');
  for (const flag of ['waitingOnApproval', 'waitingOnUserInput']) assert.equal(mapStatus({ type: 'active', activeFlags: [flag] }), 'needs-attention');
});
test('completion, failure and interruption are different outcomes', () => {
  for (const [status, expected] of [['completed', 'done'], ['failed', 'error'], ['interrupted', 'idle'], ['unexpected', 'unknown']]) {
    assert.equal(reduceState('working', { method: 'turn/completed', params: { turn: { status } } }), expected);
  }
  assert.equal(reduceState('working', { method: 'item/tool/requestUserInput' }), 'needs-attention');
});
test('attention wins over error/working; mixed unknown/done is not all done', () => {
  const threads = ['done', 'working', 'needs-attention', 'error', 'needs-attention'].map(state => ({ state }));
  assert.deepEqual(aggregate(threads), { state: 'needs-attention', counts: { 'needs-attention': 2, 'possible-attention': 0, 'observed-active': 0, stopped: 0, interrupted: 0, error: 1, working: 1, done: 1, idle: 0, unknown: 0 }, total: 5, badge: 2 });
  assert.equal(aggregate([{ state: 'unknown' }, { state: 'done' }]).state, 'unknown');
  assert.equal(aggregate([]).state, 'idle');
});
test('same basename in different directories stays separate; subagents do not flatten', () => {
  const projects = groupThreads([
    { id: 'a', cwd: '/work/a/api', name: 'Task A', updatedAt: 2, status: { type: 'idle' } },
    { id: 'b', cwd: '/work/b/api', preview: 'Fallback\nOther text', updatedAt: 1, status: { type: 'notLoaded' } },
    { id: 'c', cwd: '/work/a/api', parentThreadId: 'a' },
    { id: 'd', cwd: null }
  ]);
  assert.equal(projects.length, 3);
  assert.equal(projects.flatMap(p => p.threads).length, 3);
  assert.equal(projects.find(p => p.id === '/work/b/api').threads[0].name, 'Fallback');
  assert.equal(projects.find(p => p.id === '/work/a/api').threads[0].updatedAt, 2000);
});
test('state change rolls up to project and home without changing unrelated tasks', () => {
  const projects = demoProjects();
  const next = applyEvent(projects, { method: 'turn/completed', params: { threadId: 'demo-infra-0', turn: { status: 'completed' } } });
  assert.equal(projects[0].threads[0].state, 'needs-attention');
  assert.equal(next[0].threads[0].state, 'done');
  assert.equal(buildKeys(next).keys[0].badge, 1);
  assert.equal(buildKeys(next, { level: 'projects' }).keys[0].state, 'working');
});
test('every task remains reachable with fixed navigation positions, including a partial page', () => {
  const projects = demoProjects();
  for (const view of [{ level: 'projects' }, { level: 'project', projectId: 'infra' }]) {
    const first = buildKeys(projects, { ...view, page: 0 });
    const second = buildKeys(projects, { ...view, page: 1 });
    assert.equal(first.keys.length, 9); assert.equal(second.keys.length, 9);
    assert.deepEqual(first.keys.slice(6).map(k => k.id), ['back', 'previous', 'next']);
    assert.equal(first.keys[7].disabled, true); assert.equal(second.keys[8].disabled, true);
    const visible = [...first.keys, ...second.keys].filter(k => ['project', 'thread'].includes(k.action.type));
    assert.equal(new Set(visible.map(k => k.id)).size, 8);
    assert.equal(buildKeys(projects, { ...view, page: 99 }).page, 1);
  }
});
test('empty and missing projects keep a usable back key', () => {
  for (const view of [{ level: 'projects' }, { level: 'project', projectId: 'missing' }]) {
    const result = buildKeys([], view);
    assert.equal(result.keys.length, 9); assert.equal(result.keys[6].action.type, 'back');
    assert.equal(result.keys.filter(k => !k.disabled).length, 1);
  }
});
test('repeated task titles occupy one key while every saved run stays accessible', () => {
  const threads = [
    { id: 'new', name: 'Daily digest', state: 'unknown', updatedAt: 30 },
    { id: 'old', name: 'Daily digest', state: 'unknown', updatedAt: 20 },
    { id: 'waiting', name: 'Daily digest', state: 'needs-attention', updatedAt: 10 },
    { id: 'other', name: 'Investigate error', state: 'unknown', updatedAt: 5 }
  ];
  const project = { id: 'p', name: 'Project', threads };
  const collapsed = collapseRepeatedTasks(threads);
  assert.equal(collapsed.length, 2);
  assert.equal(collapsed.find(t => t.name === 'Daily digest').id, 'waiting');
  assert.equal(collapsed.find(t => t.name === 'Daily digest').repeatCount, 3);
  assert.equal(buildKeys([project], { level: 'project', projectId: 'p' }).keys[0].repeatCount, 3);
  assert.deepEqual(buildKeys([project], { level: 'project', projectId: 'p', showAllRuns: true }).keys.slice(0, 4).map(k => k.id), threads.map(t => t.id));
});
