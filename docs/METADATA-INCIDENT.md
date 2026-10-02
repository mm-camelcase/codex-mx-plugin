# Metadata-path incident — 9 September 2026

After live discovery testing, a desktop task failed to resume because its database path differed from the running task's active transcript path.

**Follow-up:** the App Server transport has since been removed. A replacement metadata reader runs under OS-enforced write denial; its fixture and real-read evidence is recorded in [SAFETY.md](SAFETY.md). Default startup still has local-data access off. The affected task's data has not been repaired or altered by this project.

## Confirmed

- Both transcript files named by the error exist; both were last modified before the demo investigation began.
- A read-only database query found the task unarchived but pointing to the older transcript.
- The initial observer used `thread/list` without `useStateDbOnly`.
- The locally generated protocol explicitly says omission preserves rollout scanning and metadata repair.
- No delete, archive, resume, or task-start request was issued by this project.

The observer could have changed metadata indirectly. There is no before/after database snapshot or write audit establishing that it caused this particular mismatch. Describing the initial integration simply as “read-only” was misleading.

## Containment

The running observer was stopped. The default HTTP bridge refused live connection requests and the probe was initially disabled. Adding `useStateDbOnly: true` would not prove that App Server startup had no other metadata effects, so the transport was subsequently removed entirely rather than re-enabled.

No transcript or Codex database entry was changed during incident diagnosis. Re-enabling live mode or repairing a running task's path requires a separate, reviewed recovery step. Future integration testing should use an isolated data fixture before touching the desktop's active data store.
