# Can the desktop use a separate test profile?

Checked 9 September 2026 by reading the installed desktop package and official documentation. **Separate desktop and Codex storage paths are explicitly implemented. A fully isolated running desktop instance has not been tested.** No second desktop was launched, and no user settings or Codex data were changed during this check.

## Confirmed in the installed application

Package: `/Applications/ChatGPT.app/Contents/Resources/app.asar`, version `26.901.51231`.

- `.vite/build/bootstrap-CfJ5wTIB.js`, function `w`: `CODEX_ELECTRON_USER_DATA_PATH` overrides the Electron `userData` directory before the single-instance lock is acquired.
- `.vite/build/window-all-closed-KNH8jchn.js`, function `TD`: an explicitly configured user-data path enables the packaged macOS instance-lock logic. The lock is requested after the user-data path is selected; actual independent startup is not yet exercised.
- `.vite/build/src-VqXTPopo.js`, `iA`/`aA`: `CODEX_HOME` selects Codex state storage instead of the default home location.
- `.vite/build/main-BT6ViFC-.js`, `GC`/`fue`: with explicit Electron user data, the startup code preserves the supplied `CODEX_HOME` across login-shell environment loading. It still imports other shell environment values.
- The same main bundle has a demo launcher (`FO.#t`) which starts another app instance using both `CODEX_HOME` and `CODEX_ELECTRON_USER_DATA_PATH`, plus `--user-data-dir`. Its built-in launcher is restricted to an internal production track. This is evidence that separate-instance storage was intentionally implemented, not proof of a supported public profile feature or a security sandbox.

## What a test profile means

It is another instance of the desktop application with an empty set of task files, separate desktop settings, and a disposable project. It is not a new project inside the current sidebar and not a copy of the user's existing chats. No separate ChatGPT account is inherently required just to select different local storage paths; whether the desktop can complete the intended mock-model test without sign-in has not been established.

Changing paths does not prohibit access to the rest of the Mac. Before a live test, the desktop and its children would need an enforced filesystem boundary and limited network access, or a suitably isolated OS/virtual-machine environment. The earlier runtime proof establishes such restrictions for the CLI child, not for the complete Electron desktop.

Other boundaries that require explicit treatment:

- SQLite storage can be overridden separately by `CODEX_SQLITE_HOME` or `sqlite_home`; do not inherit a real storage override.
- Login-shell startup may import real environment values or execute user shell configuration.
- Credentials may live in an OS credential store, not solely in the chosen folders. Do not copy or reuse normal login data for the experiment.
- A second instance may use OS services and helpers outside these directories. Restricting those services might prevent startup, which must fail safely rather than trigger relaxed permissions.
- Existing computer-use restrictions on the Codex app remain applicable. A test profile is not a way around them; any visual interaction must use a permitted surface or be performed by the user.

## Outcome

**The separate-profile mechanism exists; it can be prepared programmatically. Safe whole-desktop execution and the shared-daemon setting remain unverified.** The next experiment would first establish the complete isolation boundary, then test the desktop's shared-runtime connection using only disposable tasks. It must not enable the internal daemon setting in the user's normal desktop or assume this will make ordinary plugin installation sufficient.

Sources: [official state-location variables](https://learn.chatgpt.com/docs/config-file/environment-variables) and [credential storage](https://learn.chatgpt.com/docs/auth), plus the installed source locations above. Public documentation inspected did not establish a supported desktop test-profile or read-only observer feature.
