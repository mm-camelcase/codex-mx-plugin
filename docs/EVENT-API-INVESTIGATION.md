# Codex events: integration decision

**Follow-up:** the [runtime observer experiment](RUNTIME-OBSERVER-PROOF.md) now proves that a passive second client on a shared runtime can read current status and receive status notifications without resuming a task. The current desktop uses private stdio, and a supported plugin attachment mechanism remains unresolved. The historical recommendation below is retained for context.

Investigated 9 September 2026. **Recommendation: prototype an observer hook feed, retain the protected metadata reader, and keep real runtime status marked Unknown until event coverage is proven.** This is a design recommendation, not an enabled integration.

Implementation follow-up: see [OBSERVER.md](OBSERVER.md). The code and isolated proof now exist; normal desktop activation still requires plugin installation and hook review. The investigation below records the original decision and its limits.

## Available routes

| Route | What it offers | Decision for this project |
| --- | --- | --- |
| App Server JSON-RPC notifications | Runtime status, turn lifecycle, approval/user-input flags | Richest interface when our integration owns the runtime; an independent desktop observer connection remains unproven |
| Codex lifecycle hooks | Runtime invokes an extension at lifecycle points | Best candidate for observing existing local work without resuming tasks |
| `notify` callback | Completion signal | Possible completion supplement; insufficient for a full status display |
| Protected SQLite reader | Saved task names and working directories | Keep for discovery; it cannot establish whether a task is running |
| Transcript watching | Persisted conversation records | Do not use as the primary event interface |
| Desktop internal IPC | App implementation details | Do not build a supported plugin around undocumented internals |

App Server emits `thread/status/changed` for loaded tasks and `turn/completed` with completed, interrupted, or failed status. Its documented event workflow follows start/resume; `thread/read` neither loads nor subscribes. A second server's in-memory task state is not automatically the desktop server's state. Also, `thread/list` defaults to scanning transcripts and repairing metadata unless `useStateDbOnly` is true. That option is not an OS write restriction on the server. [App Server documentation](https://learn.chatgpt.com/docs/app-server)

Hooks support prompt submission, tool activity, permission requests, stops, and session lifecycle. Plugins can package them; definitions require trust review. Background command hooks cannot control the triggering operation, but delivery can finish out of order or be cancelled at session end. `PermissionRequest` precedes the approval decision; another hook can approve it. `Stop` can cause continuation through other hooks, so it is not conclusive completion. Transcripts are explicitly not a stable hook interface. [Hooks documentation](https://learn.chatgpt.com/docs/hooks)

The separate `notify` setting currently supports only `agent-turn-complete`, with task and turn identifiers. Its payload also contains conversation text, which our design would discard. Terminal approval notifications are a different facility. [Advanced configuration](https://learn.chatgpt.com/docs/config-file/config-advanced#notifications)

## Installed evidence

Read-only inspection of installed application code and previously generated protocol types established:

- Standalone CLI **0.145.0** exposes `thread/status/changed`, `waitingOnApproval`, `waitingOnUserInput`, and hook command handlers with an `async` option. Its generated client request union has no `thread/subscribe` method and its initialize capabilities have no explicit read-only observer role.
- That CLI's `HookEventName` omits `Interrupt`, although current documentation includes it. The installed desktop and standalone CLI must not be assumed to have identical backend capabilities.
- Desktop package **26.901.51231**, at `/Applications/ChatGPT.app`, contains hook listing/review UI and consumes runtime status notifications. This supports investigating hooks for desktop use; it does not prove configured hooks fire in every task.
- Its transport selection code uses stdio unless several conditions select a local daemon, including an explicit environment flag. Finding socket support in code does not establish an available public desktop event endpoint.
- An `interactive/liveSessions/list` string appears in an internal method categorization table, but not in the inspected generated client protocol. No public contract was found; a string alone is insufficient evidence of a usable API.

Inspection locations: `app.asar` entries `.vite/build/src-VqXTPopo.js`, `.vite/build/main-BT6ViFC-.js`, and `webview/assets/app-initial-cadb12d4a15e.js`; generated `ClientRequest.ts`, `InitializeCapabilities.ts`, `v2/HookEventName.ts`, `v2/ConfiguredHookHandler.ts`, and `v2/ThreadStatus.ts` under `/tmp/codex-keypad-protocol`. Temporary generated files are local evidence, not a project dependency.

## Proposed architecture

```text
Codex's existing runtime → observer hook → private local event receiver
                                                        ↓
Saved metadata → OS-protected reader → local bridge → HTML / hardware
```

The hook adapter would be a reusable integration component, eventually packaged with a Codex plugin. The HTML is the emulator; the bridge is the local backend shared by the emulator and future hardware. The deployed standalone portfolio page would continue to use fictional data.

Proposed safeguards:

1. Register only explicitly supported background events. Skip synchronous-only session-end handling initially. Do not call start, resume, archive, delete, repair, or approval APIs.
2. Restrict the observer process at the OS level: no writes to Codex storage and access only to its fixed event destination. The metadata worker keeps its existing stricter restrictions. A hook's normal execution permissions are not sufficient protection by themselves.
3. Send only allowlisted identifiers, event type, optional tool name, and bounded directory metadata. Discard prompts, outputs, transcript paths, and credentials. Treat every field as data, never shell or filesystem instructions.
4. Use a private local socket with an explicit peer/access policy, bounded messages and timeouts. Keep events in bridge memory initially. A missing receiver drops the event promptly; it must not interfere with ongoing work.
5. Produce no model-visible output or decisions. Verify the neutral output contract for each supported event/version, including Stop, before installation. Do not bypass Codex's hook trust review.
6. Separate observations from inferred UI state. A permission-request observation is only possible attention; it does not prove the user is waiting. A stop observation is provisional. Unknown, stale, interrupted, and completed must remain distinct.

## Proof still required

An isolated test project should establish desktop/backend compatibility, task-ID correlation, approval and user-question coverage, true completion versus continuation, cancellation, concurrent tasks, event ordering, and behavior after bridge restart. Tool hooks may help identify question tools, but no complete question-wait/resolution feed has been established. No reliable heartbeat or replay has been established either; silence must not mean idle or completed.

First test the receiver and state reducer with synthetic events, including malformed input and deliberate write attempts against fixtures. Then prepare a reviewable plugin definition and exercise it in an isolated Codex home. Only after that should an opt-in disposable desktop task test verify real delivery. Do not test by resuming or changing existing work.

This investigation changed documentation only. It did not register hooks, modify Codex configuration, connect to desktop sockets, start another App Server, or edit task data. Current live mode still supplies saved metadata with **Unknown** runtime status. See [existing safety evidence](SAFETY.md).
