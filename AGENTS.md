# Codex Agent Keypad — Agent Guide

Hardware-free prototype of a Logitech-style keypad for navigating Codex work (Home → Codex → Project → Task). See [README.md](README.md) for the user-facing overview.

This is the canonical instruction file for coding agents. `CLAUDE.md` imports it; edit this file, not that one.

## Stack

- Node.js 24.16+ (`.tool-versions`), ESM, native TypeScript stripping — run `.ts` files directly with `node`. No build step for the server, no runtime dependencies.
- Frontend: plain HTML/CSS/JS in `public/`.
- Tests: `node --test` (built-in runner).

## Commands

```sh
npm start               # Demo server on localhost:3000, fictional data only
npm run start:local     # + protected read of saved Codex metadata (macOS)
npm run start:desktop   # + experimental desktop IPC status worker
npm run start:events    # + observer plugin activity feed
npm test                # Fixture tests; stop any running event bridge first
npm run build           # Single-file portfolio build → dist/index.html
npm run probe           # Protected metadata read, aggregate counts only
npm run prove:hooks     # Isolated Codex + mock model hook proof
npm run prove:observer  # Shared-runtime observer experiment
```

## Layout

- `server.ts` — local HTTP bridge; serves `public/` and in-memory results.
- `packages/domain/` — contracts, keypad/navigation model, project grouping.
- `packages/keypad-model/` — key definitions shared by emulator and future device.
- `packages/codex-client/` — sandboxed metadata reader and desktop IPC status worker.
- `packages/activity/` — observer event receiver and cache.
- `packages/logitech-adapter/`, `packages/navigation/` — stubs / unsupported paths.
- `plugins/codex-keypad-observer/` — Codex plugin (hooks + Python observer).
- `scripts/` — build, probes, and proof harnesses.
- `tests/` — fixture-based tests, including deliberate mutation attempts.
- `docs/` — safety evidence, investigations, and incident write-ups.
- `docs/hero/` — three.js scene and recorder for the README banner (`keypad.webp`). Not part of the app; re-record with `npm i --no-save playwright-core && node docs/hero/record.mjs`.

## Safety rules (non-negotiable)

This project reads the user's real Codex data. Read [docs/SAFETY.md](docs/SAFETY.md) and [docs/METADATA-INCIDENT.md](docs/METADATA-INCIDENT.md) before touching `packages/codex-client/`, `server.ts`, or the observer plugin.

- Never write to, repair, migrate, or "fix" anything under Codex's data directory — database, WAL/SHM sidecars, transcripts, or task paths.
- Only the sandboxed child worker may open Codex's database. Keep the macOS profile fixed (`deny file-write*`, `deny network*`); never let browser input or env vars alter it, and never fall back to unsandboxed execution.
- Keep SQLite read-only with the restrictive authorizer; queries must not take browser-supplied input.
- Desktop IPC worker: only initialization and single-task follow/status requests. Discard conversation payloads. Fail closed to **Unknown**.
- Tests must use disposable fixtures only — never resolve the real Codex database. Destructive probes target fixtures exclusively.
- Do not start Codex or the App Server from this project (retired after the metadata incident).
- Local caches go in the git-ignored `.local/` directory only.

## Conventions

- Status labels must not overclaim: use **seen**, **Unknown**, expiring states; don't imply continuous or complete observation.
- Demo mode and `dist/` contain fictional data only — never bundle real task information.
- Keep the emulator and future hardware on the same key model.
- When adding a capability, add or update evidence in `docs/` and keep README claims in line with what's actually verified.
- `README.md` is the short, human-facing story for the portfolio. Technical detail (run modes, architecture, evidence tables) belongs in `docs/TECHNICAL.md`.
- Run `npm test` before considering a change done.
