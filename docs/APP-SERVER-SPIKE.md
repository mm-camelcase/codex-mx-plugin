# Historical App Server spike — retired implementation

This is a historical record. Do not follow its former connection instructions. The transport was removed; see the [current investigation](../INVESTIGATION.md) and [protected reader](SAFETY.md).

Checked **9 September 2026** against the installed **Codex CLI 0.145.0**, locally generated protocol types, and official documentation. This is a working emulator and discovery spike, not a completed hardware plugin.

**Correction after testing:** live discovery is disabled. Initial `thread/list` calls did not set `useStateDbOnly`, so Codex could repair metadata despite the observer issuing only discovery requests. A stale-path error was subsequently reported. Both transcripts remain intact, but causation is unproven. See [the incident note](docs/METADATA-INCIDENT.md). The instructions and live results below describe the original investigation; the live connection and probe are currently blocked.

## Findings

| Capability | Evidence | Result |
| --- | --- | --- |
| Initialize App Server over stdio | Real `initialize` request, then `initialized` notification | Confirmed |
| Enumerate saved tasks | Paginated `thread/list`; 663 unique IDs, all source `vscode`; current workspace present | Confirmed on this machine |
| Candidate project grouping | 30 distinct `cwd` values | Confirmed directory grouping; desktop project equivalence unproven |
| Observe desktop runtime state from a new process | All 663 returned `notLoaded`; `thread/loaded/list` returned zero | Does not provide desktop-wide live state |
| State vocabulary | Generated `ThreadStatus` / `ThreadActiveFlag` types | Confirmed schema; real approval transition not observed |
| Desktop task navigation | No navigation method in generated App Server client requests; official-doc search did not establish a supported deep link | Unsupported in this prototype |
| Existing shared daemon | `codex app-server daemon version` found no control socket at its default location | No shared daemon connection verified |
| Dynamic Logitech workspace | Official Dynamic Folders documentation | Confirmed SDK concept; demonstrated API is C# |
| Node/macOS SDK | Official Node introduction documents beta support | Documented; not hardware-tested |
| New MX Keypad support | Supported Devices page names MX Creative Console, Actions Ring, and Loupedeck; does not separately name the new MX Keypad | Unverified |

The test did not establish that *every* desktop task is present. Archived tasks, spawned subagents, remote hosts, and cloud conversations are outside the default discovery scope. No desktop UI scraping or direct SQLite access is used.

## Reproduce

```sh
codex --version
codex app-server generate-ts --experimental --out /tmp/codex-keypad-protocol
npm run probe
npm start
```

Choose **Local Codex → Connect to Codex**. The observer starts a separate `codex app-server --listen stdio://` process using the normal Codex home. Codex must already be installed and configured. The diagnostic outputs counts and schema field names, not task titles, IDs, previews, or project paths. Codex itself may perform ordinary runtime initialization and metadata maintenance; “read-only” describes the application RPC calls.

The initial probe ran at `2026-09-09T08:28:37.019Z`. Its counts are a dated observation, not a product claim. Results will change as tasks are added or removed.

### Optional configuration

- `PORT=3001 npm start`: choose another loopback port.
- `CODEX_BIN=/absolute/path/to/codex npm start`: select a CLI binary.
- `CODEX_SOCKET=/absolute/path/to/control.sock npm start`: connect with the CLI's `app-server proxy --sock` to an existing compatible server instead of spawning an isolated observer. This path is implemented but not verified against a shared desktop server here. It does not create or reconfigure a daemon.

Never point a public host at the local bridge. Publish only the standalone `dist/index.html` artifact. Discovery is requested explicitly from the local UI; the default sample mode does not load real tasks.

## State interpretation

| Input | Display |
| --- | --- |
| `active` with `waitingOnApproval` or `waitingOnUserInput` | Needs you |
| `active` without those flags | Working |
| `idle` | Idle |
| `systemError` | Error |
| `notLoaded`, missing, or future status | Unknown |
| Observed `turn/completed`, successful result | Done |
| Observed failed / interrupted turn | Error / Idle |

Attention takes priority over errors and running work. A mixed group containing unknown states never appears wholly Done. Completion is not inferred from elapsed time, timestamps, or idle status. Poll snapshots reflect current server runtime status; a previously observed completion can later appear Idle or Unknown.

The bridge refreshes discovery every 10 seconds and forwards supported notifications over server-sent events. The separate process cannot subscribe to desktop-owned activity merely by listing or reading saved tasks. It never resumes a task to manufacture a subscription. Notifications and approval reductions are tested with synthetic events; desktop-wide live transitions remain unproven.

## Project and navigation boundaries

Groups use the exact working directory, preserving separate directories with identical basenames. Worktrees are not silently merged into saved desktop projects. Empty desktop projects cannot be discovered from a task list. Spawned task records are excluded to avoid flattening agent work into top-level projects.

Keys 1–6 hold content; keys 7–9 remain Back, Previous, and Next. All pages expose exactly nine keys. Selecting a task opens the local inspector. **Open in Codex** is disabled, with a copy-ID fallback. No unverified deep link is fired.

The `CodexNavigator` and `KeypadTarget` contracts isolate these unresolved integrations. The Logitech adapter throws an explicit unsupported error. Other launcher tiles are disabled placeholders, not integrations.

## Validation

- Automated tests cover initialization, discovery filters, cursor paging/deduplication, notifications, errors/timeouts, state semantics, roll-up, duplicate directory names, empty/partial pages, and loopback HTTP boundaries. The incident regression also checks that live access is blocked by default and requests explicitly disable scan-and-repair.
- Browser verification: project/task drill-down, numeric keyboard paging, Escape navigation, state-change roll-up, task inspector, diagnostics, disconnect/reconnect, and mobile overflow check.
- Live discovery verified against the actual installed Codex process, separate from fixture-based tests.
- The running HTTP bridge later returned 664 tasks in the same 30 directory groups, all Unknown, confirming discovery through the UI connection and subsequent polling.
- The 43 KB standalone build passes JavaScript syntax validation. Direct `file://` execution could not be browser-tested because the browser automation URL policy blocks local file URLs; the equivalent source interface was tested over loopback HTTP.
- No model turns were started. No approvals were answered. Hardware and desktop navigation remain deferred.

## Official sources

- [Codex App Server](https://learn.chatgpt.com/docs/app-server): handshake, task discovery, runtime statuses, notifications, and subscription semantics.
- [Logitech supported devices](https://logitech.github.io/actions-sdk-docs/supported-devices/): documented controller families and Actions Ring requirements.
- [Logitech Node.js introduction](https://logitech.github.io/actions-sdk-docs/nodejs/introduction/): beta availability and macOS support.
- [Logitech Dynamic Folders](https://logitech.github.io/actions-sdk-docs/csharp/plugin-features/implementing-dynamic-folders/): plugin-controlled pages, runtime labels, images, and navigation.
