/** Explicit experiment only. Never connects to the user's desktop runtime.
 * Two clients share a disposable runtime; a third uses a separate runtime.
 * A local mock model holds a turn open and requests approval of a fixture printf.
 */
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';

const root = await mkdtemp('/private/tmp/keypad-runtime-observer-');
const processes = [], clients = [], pendingModel = [];
let modelCalls = 0;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, description) {
  const deadline = Date.now() + 8000;
  while (!predicate()) {
    if (Date.now() > deadline) throw Error(`Timed out: ${description}`);
    await delay(20);
  }
}
function finishModel(response, tool) {
  response.writeHead(200, { 'Content-Type': 'text/event-stream' });
  const item = tool === 'question' ? { id: 'fc_question', type: 'function_call', call_id: 'fixture_question', name: 'request_user_input', arguments: JSON.stringify({ questions: [{ id: 'fixture_choice', header: 'Fixture', question: 'Choose a fixture option.', options: [{ label: 'Alpha', description: 'First fixture option.' }, { label: 'Beta', description: 'Second fixture option.' }] }] }), status: 'completed' }
    : tool ? { id: 'fc_fixture', type: 'function_call', call_id: 'fixture_exec', name: 'exec_command', arguments: JSON.stringify({ cmd: '/usr/bin/printf fixture', sandbox_permissions: 'require_escalated', justification: 'Disposable observer fixture only', max_output_tokens: 32 }), status: 'completed' }
    : { id: 'msg_fixture', type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'Fixture complete.', annotations: [] }] };
  const result = { id: 'resp_fixture', object: 'response', model: 'keypad-test', status: 'completed', output: [item], usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } } };
  for (const [type, data] of [
    ['response.created', { response: { ...result, status: 'in_progress', output: [] } }],
    ['response.output_item.added', { output_index: 0, item: { ...item, status: 'in_progress' } }],
    ['response.output_item.done', { output_index: 0, item }],
    ['response.completed', { response: result }]
  ]) response.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
  response.end();
}
const mock = createServer((req, res) => {
  if (req.method !== 'POST' || !req.url?.endsWith('/responses')) { res.writeHead(404).end(); return; }
  req.resume();
  req.on('end', () => { modelCalls++; if (modelCalls === 1) pendingModel.push(res); else finishModel(res, modelCalls === 3 ? 'question' : false); });
});
async function freePort() {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
async function runtime(port, modelPort) {
  const profile = `(version 1)(allow default)(deny file-read* (subpath ${JSON.stringify(homedir())}))(deny file-write*)(allow file-write* (subpath ${JSON.stringify(root)}))(deny network*)(allow network-bind (local ip "localhost:${port}"))(allow network-inbound (local ip "localhost:${port}"))(allow network-outbound (remote ip "localhost:${modelPort}"))`;
  const child = spawn('/usr/bin/sandbox-exec', ['-p', profile, '/Applications/ChatGPT.app/Contents/Resources/codex', 'app-server', '--listen', `ws://127.0.0.1:${port}`], {
    cwd: root, env: { HOME: root, CODEX_HOME: `${root}/codex`, TMPDIR: `${root}/tmp`, PATH: '/usr/bin:/bin', RUST_LOG: 'error' }, stdio: ['ignore', 'pipe', 'pipe']
  });
  processes.push(child);
  let errors = '';
  child.stderr.on('data', c => { errors = (errors + c).slice(-3000); }); child.stdout.resume();
  const deadline = Date.now() + 8000;
  while (true) {
    if (child.exitCode !== null) throw Error(`Fixture runtime exited: ${errors}`);
    try { if ((await fetch(`http://127.0.0.1:${port}/readyz`)).ok) break; } catch {}
    if (Date.now() > deadline) throw Error(`Fixture listener unavailable: ${errors}`);
    await delay(40);
  }
}
async function connect(port, observer = false) {
  const socket = new WebSocket(`ws://127.0.0.1:${port}`);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  const pending = new Map(), notifications = [], requests = [], sent = [];
  let next = 0;
  socket.onmessage = event => {
    const msg = JSON.parse(event.data);
    if (msg.method) { (msg.id === undefined ? notifications : requests).push(msg); return; }
    const waiting = pending.get(msg.id);
    if (waiting) { pending.delete(msg.id); clearTimeout(waiting.timer); msg.error ? waiting.reject(Error(JSON.stringify(msg.error))) : waiting.resolve(msg.result); }
  };
  const client = { socket, notifications, requests, sent,
    rpc(method, params = {}) {
      if (observer && !['initialize', 'thread/loaded/list', 'thread/read'].includes(method)) throw Error('Observer request outside read-only allowlist');
      sent.push(method); const id = ++next;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(id); reject(Error(`RPC timeout: ${method}`)); }, 8000);
        pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params }));
      });
    }
  };
  clients.push(client);
  await client.rpc('initialize', { clientInfo: { name: observer ? 'keypad_observer_fixture' : 'keypad_owner_fixture', version: '0.1.0' }, capabilities: { experimentalApi: true } });
  socket.send(JSON.stringify({ method: 'initialized', params: {} }));
  return client;
}
try {
  await mkdir(`${root}/codex`); await mkdir(`${root}/tmp`);
  await new Promise(resolve => mock.listen(0, '127.0.0.1', resolve));
  const modelPort = mock.address().port, sharedPort = await freePort(), separatePort = await freePort();
  await writeFile(`${root}/codex/config.toml`, `model = "keypad-test"\nmodel_provider = "fixture"\n[model_providers.fixture]\nname = "Local fixture"\nbase_url = "http://127.0.0.1:${modelPort}/v1"\nwire_api = "responses"\nrequires_openai_auth = false\n`);
  await runtime(sharedPort, modelPort);
  const owner = await connect(sharedPort), observer = await connect(sharedPort, true);
  const { thread } = await owner.rpc('thread/start', { cwd: root, approvalPolicy: 'on-request', sandbox: 'read-only' });
  await owner.rpc('turn/start', { threadId: thread.id, input: [{ type: 'text', text: 'Run the disposable fixture.' }] });
  await until(() => pendingModel.length, 'held model response');
  const loaded = await observer.rpc('thread/loaded/list');
  assert(loaded.data.includes(thread.id));
  const read = client => client.rpc('thread/read', { threadId: thread.id, includeTurns: false }).then(r => r.thread.status);
  const working = await read(observer); assert.equal(working.type, 'active');
  finishModel(pendingModel.shift(), true);
  await until(() => owner.requests.some(r => r.method === 'item/commandExecution/requestApproval'), 'fixture approval');
  const approval = await read(observer);
  assert(approval.activeFlags.includes('waitingOnApproval'));
  observer.socket.close();
  const reconnected = await connect(sharedPort, true);
  const recovered = await read(reconnected); assert(recovered.activeFlags.includes('waitingOnApproval'));
  // Same disposable data, different process: demonstrate that shared storage is not shared runtime.
  await runtime(separatePort, modelPort);
  const separate = await connect(separatePort, true);
  const separateLoaded = await separate.rpc('thread/loaded/list');
  assert(!separateLoaded.data.includes(thread.id));
  const separateState = await read(separate); assert.equal(separateState.type, 'notLoaded');
  const request = owner.requests.find(r => r.method === 'item/commandExecution/requestApproval');
  owner.socket.send(JSON.stringify({ id: request.id, result: { decision: 'accept' } }));
  await until(() => owner.notifications.some(r => r.method === 'turn/completed'), 'fixture completion');
  const idle = await read(reconnected); assert.equal(idle.type, 'idle');
  await owner.rpc('turn/start', { threadId: thread.id, input: [{ type: 'text', text: 'Ask the fixture question.' }], collaborationMode: { mode: 'plan', settings: { model: 'keypad-test', reasoning_effort: null, developer_instructions: null } } });
  await until(() => owner.requests.some(r => r.method === 'item/tool/requestUserInput'), 'fixture question');
  const waitingForInput = await read(reconnected); assert(waitingForInput.activeFlags.includes('waitingOnUserInput'));
  const question = owner.requests.find(r => r.method === 'item/tool/requestUserInput');
  owner.socket.send(JSON.stringify({ id: question.id, result: { answers: { fixture_choice: { answers: ['Alpha'] } } } }));
  await until(() => owner.notifications.filter(r => r.method === 'turn/completed').length === 2, 'question turn completion');
  const afterAnswer = await read(reconnected); assert.equal(afterAnswer.type, 'idle');
  const report = {
    testedAt: new Date().toISOString(), engine: 'codex-cli 0.153.4', realHomeAccess: false, externalModelRequests: false,
    sameRuntime: { working, approval, recoveredAfterReconnect: recovered, afterCompletion: idle, waitingForInput, afterAnswer },
    separateRuntime: { loadedCount: separateLoaded.data.length, sameTaskStatus: separateState },
    passiveNotifications: [...new Set([...observer.notifications, ...reconnected.notifications].map(n => n.method))],
    observerReceivedApprovalRequests: observer.requests.length + reconnected.requests.length,
    observerMethods: [...new Set([...observer.sent, ...reconnected.sent])],
    limitations: ['Local shared WebSocket fixture, not a connection to Codex Desktop', 'No read-only capability enforced by app-server', 'Questions in final prose do not create a runtime wait', 'No durability or production load test']
  };
  console.log(JSON.stringify(report, null, 2));
} finally {
  for (const client of clients) client.socket.close();
  for (const child of processes) child.kill();
  await Promise.all(processes.map(child => child.exitCode !== null || child.signalCode !== null ? null : new Promise(resolve => child.once('close', resolve))));
  mock.closeAllConnections(); await new Promise(resolve => mock.close(resolve));
  await rm(root, { recursive: true, force: true });
}
