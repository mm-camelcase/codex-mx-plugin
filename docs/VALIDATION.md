# Walk through the demo

1. Start with **Demo**, then press **Codex**. It reports two tasks needing attention.
2. Press **Infrastructure**. Six tasks appear; **Next** reveals the remaining two.
3. Select **ECS deployment**. Its ID and state appear in the inspector; sample tasks stay in the emulator.
4. Press **Done**, close the inspector, and go back. Infrastructure now shows its two working tasks. Go Home: the Codex attention count has dropped from two to one.
5. Press **Needs you**. The sample ECS task and its ancestors regain their attention badge.
6. Use **Simulate disconnect**. Keys retain their last known state, an offline notice appears, and state buttons are disabled. Reconnect and reset.
7. Open **Show diagnostics** to inspect the state events and the nine-key model.
8. For saved real metadata on macOS, start with `npm run start:local` and open the local page. The protected reader connects on startup; saved metadata alone cannot establish live activity. Use `npm run start:desktop` for experimental live checks of recent visible tasks. Task keys link to local Codex chats through the documented `codex://threads/<thread-id>` URL. Plain `npm start` keeps real-data access off.

Keyboard: 1–9 activate positions; Escape closes the inspector or goes back; arrow keys page. Other launcher apps are intentionally disabled.

Automated checks use synthetic fixtures. Browser checks exercise the actual HTML interface. The current probe is a separate OS-protected metadata read; it does not contact a Codex server. None of these establishes hardware compatibility or desktop-wide live notifications. See [SAFETY.md](SAFETY.md).
