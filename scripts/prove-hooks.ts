/** Explicit integration proof. Entire Codex runtime is confined to a disposable home.
 * Uses a local mock model, never an OpenAI account or existing task. */
import { mkdtemp, mkdir, cp, writeFile, readFile, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { createServer } from 'node:http';
import { createInterface } from 'node:readline';
import { startActivityReceiver } from '../packages/activity/receiver.ts';

const root = await mkdtemp('/private/tmp/keypad-codex-proof-');
const binary = '/Applications/ChatGPT.app/Contents/Resources/codex';
const received: any[] = [];
let requests = 0;
const mock = createServer((req, res) => {
  if (!req.url?.endsWith('/responses') || req.method !== 'POST') { res.writeHead(404).end(); return; }
  requests++;
  let body = ''; req.on('data', chunk => body += chunk);
  req.on('end', () => {
    if (requests === 1 && !JSON.parse(body).tools?.some((t: any) => t.name === 'exec_command')) throw new Error('Fixture requires exec_command');
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const assistantMessage = { id: 'msg_test', type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'Isolated hook proof complete.', annotations: [] }] };
    const message = requests === 1 ? { id: 'call_fixture', type: 'function_call', call_id: 'fixture_exec', name: 'exec_command', arguments: JSON.stringify({ cmd: '/usr/bin/printf fixture', sandbox_permissions: 'require_escalated', justification: 'Disposable hook fixture only', max_output_tokens: 32 }), status: 'completed' } : assistantMessage;
    const response = { id: 'resp_test', object: 'response', model: 'keypad-test', status: 'completed', output: [message], usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } } };
    for (const [type, data] of [
      ['response.created', { response: { ...response, status: 'in_progress', output: [] } }],
      ['response.output_item.added', { output_index: 0, item: { ...message, status: 'in_progress', content: [] } }],
      ['response.output_text.delta', { item_id: message.id, output_index: 0, content_index: 0, delta: 'Isolated hook proof complete.' }],
      ['response.output_item.done', { output_index: 0, item: message }],
      ['response.completed', { response }]
    ] as const) res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
    res.end();
  });
});
await new Promise<void>(resolve => mock.listen(0, '127.0.0.1', resolve));
const port = (mock.address() as any).port;
const env = { HOME: root, CODEX_HOME: `${root}/codex`, TMPDIR: `${root}/tmp`, PATH: '/usr/bin:/bin', LANG: 'en_US.UTF-8', RUST_LOG: 'error' };
const profile = `(version 1)(allow default)(deny file-read* (subpath ${JSON.stringify(homedir())}))(deny file-write*)(allow file-write* (subpath "${root}"))(deny network*)(allow network-outbound (remote ip "localhost:${port}"))(allow network-outbound (literal "/private/tmp/codex-keypad-${process.getuid!()}/events.sock"))`;
function run(args: string[]) {
  return spawn('/usr/bin/sandbox-exec', ['-p', profile, binary, ...args], { env, cwd: root, stdio: 'pipe' });
}
async function command(args: string[]) {
  const child = run(args); let stdout = '', stderr = '';
  child.stdout.on('data', chunk => stdout += chunk); child.stderr.on('data', chunk => stderr += chunk); child.stdin.end();
  const timer = setTimeout(() => child.kill(), 10000);
  const code = await new Promise(resolve => child.once('close', resolve)); clearTimeout(timer);
  if (code !== 0) throw new Error(`Isolated command failed: ${stderr.slice(-1500)}`);
  return stdout;
}
let receiver: Awaited<ReturnType<typeof startActivityReceiver>> | undefined;
let child: ReturnType<typeof run> | undefined;
try {
  await mkdir(env.CODEX_HOME); await mkdir(env.TMPDIR);
  const marketplace = `${root}/marketplace`;
  await mkdir(`${marketplace}/.agents/plugins`, { recursive: true });
  await cp(new URL('../plugins/codex-keypad-observer', import.meta.url), `${marketplace}/plugins/codex-keypad-observer`, { recursive: true });
  // macOS cannot apply a second Seatbelt sandbox inside this test's outer sandbox.
  // The fixture invokes the unchanged worker directly under the outer policy.
  // The production launcher + stricter worker policy are tested independently.
  const hookFile = `${marketplace}/plugins/codex-keypad-observer/hooks/hooks.json`;
  const hookConfig = JSON.parse(await readFile(hookFile, 'utf8'));
  for (const groups of Object.values(hookConfig.hooks) as any[]) {
    groups[0].hooks[0].command = `/usr/bin/python3 -I -B "${marketplace}/plugins/codex-keypad-observer/scripts/worker.py" "/private/tmp/codex-keypad-${process.getuid!()}/events.sock"`;
  }
  await writeFile(hookFile, JSON.stringify(hookConfig));
  await writeFile(`${marketplace}/.agents/plugins/marketplace.json`, JSON.stringify({ name: 'keypad-proof', plugins: [{ name: 'codex-keypad-observer', source: { source: 'local', path: './plugins/codex-keypad-observer' }, policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' }, category: 'Productivity' }] }));
  await writeFile(`${env.CODEX_HOME}/config.toml`, `model = "keypad-test"\nmodel_provider = "fixture"\n[model_providers.fixture]\nname = "Local test fixture"\nbase_url = "http://127.0.0.1:${port}/v1"\nwire_api = "responses"\nrequires_openai_auth = false\n`);
  console.log('Isolated engine:', (await command(['--version'])).trim());
  await command(['plugin', 'marketplace', 'add', marketplace]);
  await command(['plugin', 'add', 'codex-keypad-observer@keypad-proof']);
  receiver = await startActivityReceiver(event => received.push(event));
  child = run(['app-server', '--listen', 'stdio://']);
  child.stderr.on('data', () => {});
  const diagnostics: any[] = [];
  let id = 0;
  const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  const lines = createInterface({ input: child.stdout });
  let completed = false;
  lines.on('line', line => {
    try {
      const message = JSON.parse(line);
      if (message.id && pending.has(message.id)) {
        const request = pending.get(message.id)!; pending.delete(message.id);
        if (message.error) request.reject(new Error(JSON.stringify(message.error))); else request.resolve(message.result);
      }
      if (message.method === 'item/commandExecution/requestApproval') {
        child!.stdin.write(JSON.stringify({ id: message.id, result: { decision: 'accept' } }) + '\n');
      }
      if (message.method === 'turn/completed') completed = true;
      if (/hook|warning|error/i.test(message.method || '') || message.method === 'turn/completed') diagnostics.push(message);
    } catch {}
  });
  async function rpc(method: string, params: any) {
    const requestId = ++id;
    return new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(requestId); reject(new Error(`Timed out: ${method}`)); }, 10000);
      pending.set(requestId, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } });
      child!.stdin.write(JSON.stringify({ id: requestId, method, params }) + '\n');
    });
  }
  await rpc('initialize', { clientInfo: { name: 'keypad_isolated_proof', version: '0.1.0' }, capabilities: { experimentalApi: true } });
  child.stdin.write(JSON.stringify({ method: 'initialized', params: {} }) + '\n');
  const hooks = await rpc('hooks/list', { cwds: [root] });
  const definitions = hooks.data?.flatMap((entry: any) => entry.hooks) || [];
  console.log('Discovered hooks:', definitions.map((hook: any) => ({ event: hook.eventName, trust: hook.trustStatus })));
  if (definitions.length !== 5) throw new Error(`Expected 5 plugin hooks, got ${definitions.length}. ${JSON.stringify(hooks).slice(0, 2000)}`);
  // Trust only the five source-reviewed fixture definitions in the disposable home.
  // No trust bypass flag and no real user configuration is involved.
  await rpc('config/batchWrite', { edits: [{ keyPath: 'hooks.state', value: Object.fromEntries(definitions.map((hook: any) => [hook.key, { enabled: true, trusted_hash: hook.currentHash }])), mergeStrategy: 'upsert' }], reloadUserConfig: true });
  
  const { thread } = await rpc('thread/start', { cwd: root, approvalPolicy: 'on-request', sandbox: 'read-only' });
  await rpc('turn/start', { threadId: thread.id, input: [{ type: 'text', text: 'Return the fixture confirmation.' }] });
  const expected = ['UserPromptSubmit', 'PreToolUse', 'PermissionRequest', 'PostToolUse', 'Stop'];
  const until = Date.now() + 8000;
  while (Date.now() < until && (!completed || !expected.every(name => received.some(e => e.event === name)))) await new Promise(resolve => setTimeout(resolve, 50));
  if (!completed || !expected.every(name => received.some(e => e.event === name))) throw new Error(`Incomplete hook delivery: completed=${completed}, modelRequests=${requests}, events=${JSON.stringify(received)}, diagnostics=${JSON.stringify(diagnostics).slice(-6000)}`);
  if (!received.every(e => e.sessionId === thread.id)) throw new Error('Hook/task ID correlation failed.');
  console.log(JSON.stringify({ completed, localMockRequests: requests, observedEvents: received.map(e => e.event), taskIdsMatch: true, realCodexDataAccessible: false, testBoundary: 'worker under outer sandbox; production launcher tested separately' }));
} finally {
  child?.kill();
  if (child) await new Promise(resolve => { if (child!.exitCode !== null || child!.signalCode !== null) resolve(null); else child!.once('close', resolve); });
  await receiver?.close();
  await new Promise(resolve => mock.close(resolve));
  await rm(root, { recursive: true, force: true });
}
