import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, readFileSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ActivityCache } from '../packages/activity/cache.ts';
import { ActivityStore } from '../packages/activity/receiver.ts';

test('cache restores original event time without making an old event fresh, and refuses invalid files or symlinks', () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(),'keypad-cache-test-')));
  try {
    const cache = new ActivityCache(join(dir,'activity.json')), store = new ActivityStore();
    const then = Date.now()-60000;
    store.accept({version:1,sessionId:'task-a',turnId:'turn-a',eventId:'event-a',event:'Stop',observedAt:then},then);
    cache.save(store);
    const restored = new ActivityStore(); cache.load(restored);
    const task = restored.project([{threads:[{id:'task-a',state:'unknown'}]}])[0].threads[0];
    assert.equal(task.state,'unknown'); assert.equal(task.observation.observedAt,then); assert.equal(task.observation.stale,true);
    writeFileSync(cache.path,'unrelated data'); cache.save(store);
    assert.equal(readFileSync(cache.path,'utf8'),'unrelated data');
    const target = join(dir,'transcript.jsonl'), link = join(dir,'link.json');
    writeFileSync(target,'preserve me'); symlinkSync(target,link);
    const linked = new ActivityCache(link); linked.load(new ActivityStore()); linked.save(store);
    assert.equal(readFileSync(target,'utf8'),'preserve me');
    restored.restore([{version:1,sessionId:'old',turnId:'t',eventId:'e',event:'Stop',observedAt:Date.now()-8*86400000}]);
    assert.equal(restored.entries.has('old'),false);
  } finally { rmSync(dir,{recursive:true,force:true}); }
});
