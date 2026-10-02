# Local activity observer

Implemented 9 September 2026. The plugin, protected worker, private receiver, and emulator integration are built. The user has installed the plugin and trusted its five hooks in the normal Codex environment. On 9 September, the bridge reported observations from three saved tasks, including Stop and fresh PreToolUse observations. The installed scripts and hook definitions match the tested source.

## Run

```sh
npm run start:events
```

Open the printed localhost URL, choose **Local Codex**, then **Read saved tasks**. This starts the receiver and enables protected metadata reading; it does not install hooks. `npm start` remains sample-only, and `npm run start:local` remains metadata-only.

Install **codex-keypad-observer** from the personal catalog and review its five hook definitions in Codex's hook settings. Trust only those definitions, then use a new disposable task to verify delivery. Existing tasks are not resumed or altered by the bridge. Hooks are skipped until trusted; installing a plugin alone does not trust them. [Codex hook review](https://learn.chatgpt.com/docs/hooks#review-and-trust-hooks)

The portable plugin source is `plugins/codex-keypad-observer/`. It uses the standard `hooks/hooks.json` layout and `${PLUGIN_ROOT}` paths. It requires macOS and `/usr/bin/python3`; the bridge requires Node 24.16+. The project is still a hardware prototype, not a completed Logitech integration. Projects now refresh automatically from the protected reader’s `projects` and `project_roots` tables every 10 seconds, along with explicit task project assignments when present. No manual catalog is loaded. Assignments take precedence over exact paths, followed by verified Git worktree relationships. Unmatched tasks remain accessible under All saved folders. Saved order may differ from the desktop sidebar; these are internal storage tables, not a supported public project API. Unsupported project schemas fall back to saved folders without repair.

## What the display means

| Observation | Label | Limit |
| --- | --- | --- |
| UserPromptSubmit, PreToolUse, PostToolUse | Activity seen | Evidence of recent activity; not a continuous running status |
| PermissionRequest | Approval seen | May subsequently be approved or denied without further observable activity |
| Stop | Stop seen | Other hooks may continue the turn; not proof of successful completion |
| No observation for 30 seconds | Unknown + last event | Silence does not establish idle, failure, or completion |

All labels are observations, not authoritative runtime state. Events can arrive out of order, including prompt and stop events from a very short turn. The timestamp is when the worker begins handling input, not a Codex-assigned event sequence. We retain the latest observed timestamp, reject older arrivals, and never infer completion from that ordering.

Interrupt is understood by the receiver but not registered in the initial plugin. User-question waits, cancellation, error coverage, already-running task activation, subagent identity, remote hosts, and cloud tasks remain unverified. Counts of genuinely running or waiting tasks remain unavailable. Unknown task IDs do not create fabricated projects; they are matched only if protected metadata discovery finds the task.

## Protection

- The launcher does not parse hook input. It starts the worker under macOS Seatbelt, with all filesystem writes denied and outbound networking restricted to one Unix socket. It discards worker stdout/stderr, has an 800 ms deadline, and returns an empty JSON object. Sandbox failure drops the event; there is no fallback.
- The worker reads at most 64 KiB from stdin, with a 500 ms overall deadline. It forwards only schema version, task ID, turn ID, event type, event ID, and observation timestamp. Prompts, outputs, transcript paths, tool arguments, and credentials are discarded. It never opens a transcript.
- The receiver uses `/private/tmp/codex-keypad-<uid>/events.sock`: owner-only directory permissions (0700), socket permissions (0600), ownership and symlink checks, 2 KiB messages, 500 ms connections, and at most 32 concurrent connections. It refuses an occupied destination without removing or replacing it.
- There is no HTTP event-ingestion endpoint. No observer code calls Codex RPC, answers approvals, deletes tasks, or repairs metadata. Browser snapshots are still served only on loopback with the existing host/origin checks.
- The bridge keeps at most 10,000 task observations and 4,096 deduplication IDs in memory. Sanitized observations are also saved to the project’s ignored `.local/activity.json`, using an atomic replacement and private file permissions. Invalid files and symlinks are refused. Restart restores original timestamps (up to seven days old), never treating old events as newly received. Observations expire after 30 seconds; browser connection loss immediately clears displayed activity states.

This socket trusts processes running as the same macOS user. It prevents access by other users through filesystem permissions; it does not authenticate one same-user process against another. A malicious process already running as this user could forge observations. Do not use this display to authorize consequential actions.

The launcher itself is a minimal unsandboxed supervisor; the process parsing input is OS-restricted. A host that already sandboxes hooks may reject nested Seatbelt setup. That case is tested and drops events silently rather than weakening protection. The existing metadata worker retains its separate deny-all-writes-and-network profile.

## Evidence

`npm test`: **30 passing tests**, using synthetic fixtures. Tests cover metadata preservation, nine observer mutation/network attempts, private socket boundaries, sensitive-field stripping, malformed/oversized payloads, neutral failure, the unmodified production launcher, duplicates, stale/out-of-order observations, aggregate labels, metadata refresh, and HTTP delivery boundaries.

`npm run prove:hooks`: the installed desktop engine **codex-cli 0.153.4** discovers the packaged hooks and delivers all five during a disposable task: UserPromptSubmit, PreToolUse, PermissionRequest, PostToolUse, Stop. Task IDs match the runtime. A local mock model produces a fixed harmless `printf` tool call and a final response; the harness answers only that fixture's approval. No account or paid model is used.

The proof runtime's OS sandbox denies reading the real home directory and permits writes only beneath its temporary test root. macOS forbids nested Seatbelt initialization, so this fixture substitutes direct execution of the unchanged worker under the outer policy. The unmodified production launcher and its stricter policy are separately tested. After the user installed and trusted the plugin, the running bridge also received events from ordinary desktop tasks. This confirms real delivery for the observed events, not complete lifecycle coverage.

Run the proof only while the event bridge is stopped: it needs the same fixed private socket and refuses to replace an existing one. Tests using the production launcher also need that socket free. A normally stopped receiver removes its own socket. An occupied or stale socket causes startup to fail; investigate its owner rather than deleting it automatically.

The plugin manifest passes the plugin-creator validator. The standalone HTML is rebuilt with fictional data only. No normal Codex configuration, saved task data, or transcript paths were modified during implementation; only the new personal plugin folder/catalog entry was added outside this repository.

## Sidebar reconciliation

The user’s 16 local projects were compared with Codex’s project tool on 9 September. Two folders that looked like duplicates of one documentation project were its main checkout and a separately named review worktree. Other duplicated names included worktrees and historical directories. The default view now uses the automatically discovered catalog; raw folder mode disambiguates those names.

For one saved task, the read-only task tool reported an idle runtime and completed turn. Its final reply asks whether to merge the PR or make more changes. That is a conversational question, not a live tool-approval request. The bridge received a Stop event, whose 30-second freshness expired. The UI now retains that event on the key and in the inspector, without claiming that reply questions are detected.

## Automatic discovery verification

The current database contains all 16 local project names and paths returned by Codex’s project tool. Its stored order differs from that tool’s sidebar order. Fixture tests simulate committed additions, renames, reordering, and removal, and prove each next read reflects the change while database, WAL, sidecars, and sentinel transcripts remain byte-identical to their pre-read state. A bridge test proves polling updates the catalog without reconnecting or importing a file. Missing/invalid project schemas clear the catalog and leave task-folder discovery available. The earlier ignored `.local/desktop-projects.json` snapshot is no longer read.
