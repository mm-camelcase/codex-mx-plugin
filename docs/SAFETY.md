# Protected metadata reader

Validated on macOS 26.5.1, Node.js 24.16.0, SQLite 3.53.0, on 9 September 2026.

## Production boundary

Only the child metadata worker opens Codex's database. The parent serves static files and in-memory results. The child is launched with a fixed macOS profile:

```scheme
(version 1)
(allow default)
(deny file-write*)
(deny network*)
```

The prohibition applies to every filesystem path, including the database, its WAL/SHM/journal sidecars, and transcripts. The profile is not supplied by the browser or an environment override. The child inherits neither `NODE_OPTIONS` nor Codex configuration environment variables. A missing/failing sandbox does not trigger direct execution of the reader.

The SQLite connection is separately read-only and defensive, with extension loading disabled. Query-only mode and a restrictive authorizer reject write SQL, mutable pragmas, attachments, schema changes, and arbitrary functions. The only production query is a bounded metadata SELECT in a short transaction; its inputs are not taken from the browser. No Codex process, command, RPC, or socket is used.

Real-data access is off in the default server. `npm run start:local` explicitly enables it and starts the protected reader when the bridge starts. Reads end when the worker exits; a failed refresh marks the snapshot stale and retries through the same protected worker on the next polling interval.

## Automated evidence

`npm test` creates disposable fixture directories and SQLite databases. It never resolves the user's default Codex database. Tests establish:

1. A metadata read includes committed WAL entries while excluding archived and spawned-task rows.
2. Database, WAL, SHM, and transcript contents, sizes, modification times, and modes remain unchanged by the reader.
3. macOS blocks attempted overwrite, delete, rename, truncate, chmod, directory creation, writable SQLite access, and journal creation against the fixtures.
4. SQLite protections independently reject DELETE, UPDATE of a stale path, DROP, ATTACH, writable-schema changes, and VACUUM.
5. Uncommitted data is excluded, and an intentionally stale transcript pointer stays untouched.
6. A missing database is not created. Malformed files and unsupported schemas are not repaired. Final symlinks are rejected.
7. Missing WAL sidecars are not created; the read fails.
8. Worker timeouts fail closed and inherited Node runtime injection options are not executed.
9. The HTTP bridge rejects cross-origin/host requests and arbitrary filesystem access. Its default configuration cannot start a reader.
10. The existing keypad/state tests still pass.

All **16 tests pass**. Fixture cleanup applies only to the unique temporary directories created by each test. The deliberate destructive probes run only against those fixtures—not the real database.

A subsequent real-data read used the same protected launcher and returned 670 tasks. No destructive probe was directed at real data. Whole-database hashes during desktop activity would not establish causation, because Codex itself can legitimately write concurrently; source-preservation assertions therefore use controlled fixtures.

## Scope

This is protection against this reader modifying task data, not a general guarantee against machine failure, operating-system vulnerabilities, malicious replacement of the program, or unrelated applications. Runtime compatibility failures result in no data being shown, never a request to turn off the protection. Local task navigation uses the documented `codex://threads/<thread-id>` link; desktop status uses the separate experimental observer described in [DESKTOP-IPC.md](DESKTOP-IPC.md).

## References

- [Node 24.16 SQLite API](https://nodejs.org/download/release/v24.16.0/docs/api/sqlite.html): read-only connections, authorizers, defensive mode, and extension controls.
- [SQLite WAL documentation](https://www.sqlite.org/wal.html): transaction snapshots and conditions for reading WAL databases without write permission.
- Local `/usr/bin/sandbox-exec`, validated through the destructive fixture tests above.
# Observer extension

The optional activity feed has a separate protected worker and private Unix receiver. See [OBSERVER.md](OBSERVER.md) for its write/network restrictions, 30-test suite, isolated runtime proof, trust boundary, and remaining desktop activation check. The metadata-reader safeguards below remain in place.
