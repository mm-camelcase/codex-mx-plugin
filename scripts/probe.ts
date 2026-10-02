import { CodexClient } from '../packages/codex-client/client.ts';
import { groupThreads, mapStatus } from '../packages/domain/model.js';
const client = new CodexClient({ databasePath: process.env.CODEX_STATE_DB });
try {
  await client.connect();
  const threads = await client.listThreads();
  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    source: 'saved-metadata',
    protection: 'macOS denies all filesystem writes and network access in the reader',
    codexProcessStarted: false,
    tasks: threads.length,
    directoryGroups: groupThreads(threads).length,
    truncated: client.truncated,
    states: [...new Set(threads.map(thread => mapStatus(thread.status)))],
    note: 'Counts only. No task IDs, names, previews, or filesystem paths are exported.'
  }, null, 2));
} catch (error) {
  console.error(error.message); process.exitCode = 1;
} finally { client.close(); }
