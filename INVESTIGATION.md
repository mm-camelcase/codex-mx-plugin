# Codex Agent Keypad — current investigation

Updated **9 September 2026**. The original App Server transport has been removed from executable application code. Its historical results are preserved in [APP-SERVER-SPIKE.md](docs/APP-SERVER-SPIKE.md); they do not describe the current reader.

Follow-up: the [hook observer](docs/OBSERVER.md) is implemented with 30 passing fixture tests and an isolated Codex runtime proof. The user has installed and trusted it; the bridge has received real observations from three desktop tasks. Real statuses remain Unknown until matching observations arrive; those observations are explicitly labeled rather than treated as authoritative state.

## What is established

| Capability | Current evidence |
| --- | --- |
| Hardware-free keypad interaction | Browser-verified hierarchy, keyboard control, paging, selection, diagnostics, and simulated state transitions |
| Saved-task discovery | Protected reader found 670 real tasks at `2026-09-09T08:58:41.908Z` |
| Write protection | macOS denies filesystem writes for the reader; eight deliberate destructive fixture operations were blocked |
| Consistent metadata reads | Read-only SQLite transaction includes committed WAL changes and excludes uncommitted writes |
| Source preservation | Controlled tests leave database, WAL, shared-memory file, and transcript hashes, lengths, modes, and modification times unchanged |
| Error handling | Missing/broken/schema-incompatible databases, unavailable sidecars, and timeouts fail without repair or an unprotected fallback |
| Application boundary | Loopback HTTP only, same-origin connection requests, fixed static file allowlist, no arbitrary SQL/file/RPC endpoint |

No real transcript or metadata pointer was repaired during this work. The counts above are a dated observation, not a completeness claim.

## Current architecture

The Node bridge starts a short-lived metadata worker under `/usr/bin/sandbox-exec`. A fixed profile denies all filesystem writes and network operations. No shell or Codex executable is involved, and inherited `NODE_OPTIONS` are removed. The worker has three additional database protections: `readOnly: true`, query-only mode, and an SQL authorizer that rejects mutations, schema changes, attachments, and extension-related operations.

The worker reads a fixed set of columns from the `threads` table in a single transaction. It also reads bounded `.git` and `commondir` administrative pointers to identify linked worktrees without running Git. It does not scan, open, move, or repair transcript files. In particular, it does not select or update `rollout_path`. Results return through stdout; the bridge serves metadata only to its local browser client. Separately, sanitized hook observations are cached in this project’s ignored `.local/` directory, never in Codex storage. Worker lifetime is bounded to five seconds and output to 16 MB.

This intentionally replaces the App Server API with a narrow, implementation-dependent metadata reader after the API's implicit repair behavior caused a safety concern. Private schema dependence is a compatibility tradeoff. Unknown schema fails closed; no migration or auto-repair is attempted.

## Running it

- `npm start`: sample demo; local-data connection requests are refused.
- `npm run start:local`: make the protected reader available; reading starts when **Read saved tasks** is clicked and refreshes every ten seconds while connected.
- `npm run probe`: one protected read with aggregate output only; no continuous polling.
- `PORT=3001 npm run start:local`: choose another loopback port.
- `CODEX_STATE_DB=/absolute/path/state_5.sqlite npm run start:local`: explicitly select a compatible metadata database. The default is `~/.codex/state_5.sqlite`.

The protected reader requires macOS with a working `sandbox-exec` and Node 24.16+. There is no Linux/Windows fallback, no `CODEX_BIN` override, and no connection to a shared desktop socket. Sample mode and the standalone HTML remain independent of Codex.

If WAL sidecars need creation/recovery or the database is busy, the reader fails instead of obtaining write access. It never opens an active database with SQLite's `immutable` shortcut and never assembles a snapshot by copying a moving database/WAL pair. Busy errors leave the last successful browser snapshot explicitly stale.

## Limits that remain

- Saved metadata does not provide desktop runtime status. Every real task receives an unavailable raw status and displays **Unknown**; no `notLoaded` runtime response is fabricated.
- Saved project tables now supply names, root paths, and stored order automatically; explicit task assignments win over path/worktree matching. Empty saved projects are included. Stored order differs from the current sidebar tool; exact visual sidebar parity is not established. Unknown project schemas fall back to raw folder grouping without a manual import. Remote/cloud tasks, archived tasks, and noninteractive/subagent sources remain excluded or unavailable.
- At most 10,000 tasks are read per refresh. Truncation is disclosed.
- Direct desktop navigation and physical Logitech integration remain unsupported. Device SDK findings from the original spike are documented but not hardware-tested.
- The safety tests establish observed behavior and OS enforcement on this Mac; they do not prove freedom from every possible OS/runtime defect or from later changes to the program. There is no automatic weakening of protections on failure.

See [SAFETY.md](docs/SAFETY.md) for the test boundary and [VALIDATION.md](docs/VALIDATION.md) for the demo walkthrough.
