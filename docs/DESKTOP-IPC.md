# Experimental desktop status observer

The local demo can read a Codex task's current runtime status through `~/.codex/ipc/ipc.sock`. It checks the newest recent task for each project visible on the keypad, plus a selected task on demand. This is an undocumented desktop/IDE protocol, separate from the published App Server API. The [CodexPetMonitor implementation](https://github.com/landuochong/CodexPetMonitor/blob/main/Sources/CodexPetMonitor/CodexIPCStatusMonitor.swift) and an independent [CoPets investigation](https://github.com/ReiSuzunami/CoPets/blob/main/docs/research/codex-app-parasitic-attachment.md) provided the protocol lead. The [official App Server documentation](https://learn.chatgpt.com/docs/app-server) defines `thread/status/changed` and its `waitingOnApproval` flag, but does not document this desktop IPC socket.

On 28 September 2026, the one-task probe initialized on the user's running socket and read `threadRuntimeStatus: { type: "active", activeFlags: [] }` for the current demo task. The browser then showed **Working** for that same task. Approval and user-input waits have a defined mapping and fixture coverage, but were not present during this live test.

Safety boundary:

- The socket and parent directory must be owned by the current user and inaccessible to group/other users.
- A short-lived worker runs under macOS `sandbox-exec` with all filesystem writes denied. It sends only `initialize`, `thread-stream-following-changed`, and `thread-stream-following-status-requested` for one task ID validated against protected saved metadata.
- Incoming snapshots may contain full conversation history. The worker never logs or stores it, decodes frames only up to 2 MB, streams larger frames to extract at most 4 KB around `threadRuntimeStatus`, and closes on frames above 32 MB.
- A browser can request checks only for task IDs already in the saved metadata. Checks are serialized, expire from the display after 45 seconds, and failures fall back to Unknown.

This is **not server-enforced read-only access**: the private IPC socket also supports control messages. Our fixed outbound allowlist and OS write denial reduce risk, but Codex has not published a stable observer contract. Do not describe this as a supported extension API or install third-party monitors on a user's profile as a prerequisite. A future Codex release may change the message shape or stop exposing the socket.
