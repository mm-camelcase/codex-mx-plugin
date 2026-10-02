# Codex Agent Keypad

**A small control surface for work happening in Codex.**

A hardware-free prototype for a future Logitech keypad integration. Navigate **Home → Codex → Project → Task**, see attention roll up through the hierarchy, and try the interaction before connecting a physical device.

## Try the demo

Node.js 24.16+. No dependencies or API key required.

```sh
npm install
npm start
```

Open [localhost:3000](http://localhost:3000). Press **Codex → Infrastructure**, select a task, and try the sample state buttons. **1–9** press keys, **Esc** goes back, and **← / →** change pages.

## Read your saved Codex tasks

On macOS, stop the demo server and run:

```sh
npm run start:local
```

The local page selects **Local Codex** and connects when the bridge starts. The reader runs under macOS restrictions that deny filesystem writes and network access. It opens the metadata database read-only, never starts Codex, and never edits or repairs task paths. If a refresh fails, the page briefly shows stale data and the bridge retries through the same protected reader. Plain `npm start` keeps local-data access off.

This reads **saved task metadata**, so real task states initially show **Unknown**. Projects, names, saved order, and task assignments refresh automatically every 10 seconds. No manual catalog is needed. Repeated task titles, such as scheduled daily runs, occupy one key by default; **Show every saved run** reveals every distinct task. Nothing is removed from Codex. **All saved folders** keeps unmatched history accessible. The stored order can differ from the desktop sidebar.

## Try experimental desktop status

```sh
npm run start:desktop
```

The local bridge connects on startup and the browser opens in **Local Codex** mode. On the project keypad, the newest task in each visible project is checked if it changed within the last day; opening a project checks its most recent visible task, and selecting any task checks it on demand. The keypad can show **Working**, **Needs you** (approval or user input), **Idle**, or **Error** from Codex's live runtime flags. Checks run one at a time and expire after 45 seconds; unchecked tasks remain **Unknown**. Counts are labelled **seen**, since this is not an all-task observer.

The status worker can send only initialization and one-task follow/status requests to Codex's private local IPC socket. macOS denies it all filesystem writes. It discards conversation payloads and stops at a 32 MB frame limit. This protocol is undocumented and may change; the demo fails closed to Unknown. It has been tested against a real running desktop task, but approval and input-wait transitions still need live end-to-end validation. See [desktop IPC evidence and limits](docs/DESKTOP-IPC.md).

## Optional activity feed

```sh
npm run start:events
```

The companion **codex-keypad-observer** plugin sends small activity observations through a private local socket. Install and review its hooks in Codex before using a new task to try it. Labels say **Activity seen**, **Approval seen**, or **Stop seen**, then expire to Unknown after 30 seconds while retaining the last event for context. They do not claim continuous running status or successful completion. Sanitized observations are cached in this project’s ignored `.local/` directory; Codex files are never written. See [setup and evidence](docs/OBSERVER.md). Run `node server.ts --local-read --events --desktop-status` to combine both feeds.

## Standalone portfolio version

```sh
npm run build
```

Open or host **`dist/index.html`**. The single 46 KB file includes the interface and fictional data; no real task information is bundled. Real-data access requires the local bridge.

## Design and evidence

```text
Codex hooks → protected observer → private receiver ─┐
Saved metadata → protected reader ──────────────────┼→ local bridge
Desktop IPC → write-denied status worker ────────────┘
                                                        └→ HTML / keypad model
```

Plain HTML/CSS/JavaScript and TypeScript/Node. The emulator and future device share the same key model. In Local Codex mode, a task key uses the [documented `codex://threads/<thread-id>` link](https://learn.chatgpt.com/docs/reference/commands#deep-links) to request its local chat; Demo mode stays inside the emulator. Browser automation blocked the external-app jump, so that click still needs manual verification in the desktop app. Logitech hardware compatibility remains unverified. The desktop IPC is an experimental integration, not an official plugin API or universal installer.

The hook feed is proven with an isolated Codex runtime and has received real desktop task events after installation. Complete lifecycle coverage remains unverified.

A separate [runtime observer proof](docs/RUNTIME-OBSERVER-PROOF.md) confirms accurate working, approval-wait, input-wait, and idle states when clients share one runtime. The optional private IPC path now tests status against the existing desktop without starting another Codex server.

```sh
npm test             # 34 fixture tests; stop the event bridge first
npm run prove:hooks  # Isolated Codex + mock model; no account; stop bridge first
npm run prove:observer # Shared-runtime experiment; isolated data and local mock model
npm run probe        # Protected metadata read; aggregate counts only
```

Tests deliberately attempt writes, deletes, renames, truncation, SQL mutations, and sidecar creation against fixtures. All are blocked; fixture files remain byte-identical. Read [the safety evidence](docs/SAFETY.md) and [investigation](INVESTIGATION.md). The initial App Server approach was retired after a [metadata-path incident](docs/METADATA-INCIDENT.md).

Independent portfolio experiment; not affiliated with OpenAI or Logitech.
