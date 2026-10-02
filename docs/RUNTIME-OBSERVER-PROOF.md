# Runtime observer investigation

Follow-up: [desktop isolation check](DESKTOP-ISOLATION-CHECK.md) confirms separate storage overrides in the installed app; safe whole-desktop execution and the daemon setting are still untested.

Tested 9 September 2026, using the installed desktop engine `codex-cli 0.153.4` and desktop package `26.901.51231`.

**Result: accurate observation works when two clients share one runtime. A supported, automatic attachment to the current desktop runtime has not been established. This is an isolated proof, not an enabled live-demo feature.**

## What the executable proof established

Run `npm run prove:observer` on macOS with Node 24.16+. It uses a local mock model, two disposable runtime processes, and temporary data. It does not use the existing hook receiver and can run alongside the demo.

The first runtime has an owner client and an observer. Only the owner starts the fixture task, answers its fixture approval, and answers its fixture question. The observer sends only `initialize`, `thread/loaded/list`, and `thread/read` (with `includeTurns: false`), plus the `initialized` handshake. It never resumes a task or answers server requests.

| Scenario | Observer result |
| --- | --- |
| Model response held open | `active`, no waiting flags |
| Harmless fixture command requires approval | `active`, `waitingOnApproval` |
| Observer disconnects and reconnects during approval | Correct approval wait recovered by reading current state |
| Owner approves and the turn finishes | `idle` |
| Plan-mode fixture calls `request_user_input` | `active`, `waitingOnUserInput` |
| Owner answers and the turn finishes | `idle` |
| Separate runtime reads the same disposable task files | No loaded tasks; task status `notLoaded` |

The passive clients received `thread/started` and `thread/status/changed` notifications without calling resume. They also received `remoteControl/status/changed`. They received no approval or input requests in this experiment. The observer's reconnect did not require replaying task history. A completed reply containing an ordinary prose question still does not create a runtime input wait.

Each child runtime ran under macOS restrictions denying reads of the real user home, denying writes outside its disposable directory, and limiting network access to the fixture's loopback listener/model ports. No external model or account was used. Cleanup stops only fixture-owned processes and removes only their newly created directory. This does not prove that server-side reads have no storage side effects: the fixture runtime can write its own temporary data.

## Why this does not fix the current desktop installation

Read-only inspection found the current desktop engine launched as `app-server` without a listener override, which uses the default stdio transport. Its default `app-server-control/app-server-control.sock` is absent. No connection to a desktop control or private tools socket was attempted.

Installed application code (`app.asar`, `.vite/build/src-VqXTPopo.js`, transport class `uU.connect`) contains a shared-daemon branch. It requires `CODEX_APP_SERVER_USE_LOCAL_DAEMON=1`, no config overrides, compatible daemon version, and several other conditions. The running desktop command has config overrides. Merely setting the environment variable is therefore not an established solution. No desktop flags, runtime processes, or user configuration were changed.

The installed CLI advertises daemon management and a control-socket proxy. Those commands do not make an existing private stdio runtime attachable. Starting a separate daemon would reproduce the separate-runtime failure demonstrated above unless the desktop itself used that daemon.

Both normal and experimental generated protocol types were checked. Neither exposes a dedicated read-only observer role or `thread/subscribe` method. The fixture enforces its observer request allowlist in its own client; the shared endpoint itself still exposes powerful mutation APIs. An OS write restriction on an observer client would not prevent that endpoint from making writes on the client's behalf.

The first-party task tools available inside this conversation can read desktop status, but no supported standalone plugin interface to those tools was established. They are not a background API the shipped bridge can assume it has.

## Decision

- Keep the existing metadata/hook bridge labelled as observations. Do not silently turn a stale observation into a current runtime state.
- For an accurate observer product, obtain a supported desktop attachment mechanism and read-only authorization contract, or explicitly build an application where the UI and keypad use the same managed runtime. The latter changes the product and installation model; it is not ordinary plugin installation.
- Before shipping such an adapter, verify version compatibility, initial snapshots, event ordering, reconnects, multiple clients, error/interruption states, and server-enforced restrictions. Current evidence covers one installed version and bounded fixture scenarios, not production durability.

## Sources

- [Official App Server documentation](https://learn.chatgpt.com/docs/app-server): transport options; `thread/read` returns runtime status without loading/subscribing; loaded-task listing; status notifications. WebSocket transport is described as experimental and unsupported.
- [Official hooks documentation](https://learn.chatgpt.com/docs/hooks): lifecycle hooks, not an authoritative replayable status snapshot interface.
- [Official remote connections documentation](https://learn.chatgpt.com/docs/remote-connections): desktop-managed remote runtimes and device connections; no standalone read-only observer attachment contract established by this documentation.
- [Executable isolated proof](../scripts/prove-runtime-observer.mjs). Latest successful run: `2026-09-09T15:16:01.258Z`.

Searches of official documentation did not establish a supported desktop setting for the internal daemon branch. That is a finding about the inspected documentation and version, not proof that no future or private API exists.
