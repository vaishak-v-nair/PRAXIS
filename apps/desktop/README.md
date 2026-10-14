# PRAXIS desktop

The optional Tauri 2 desktop app opens the existing Workbench UI and Python
review engine on this computer. Its native folder picker only prefills intake;
it never begins a paid review or runs submitted project code. Source review
works without Docker. Browser/runtime checks retain the existing explicit trust
and network decisions. The core CLI still has zero runtime dependencies.

## Develop locally

Install the official Tauri prerequisites (Rust/MSVC plus WebView2 on Windows,
Xcode on macOS, WebKitGTK development libraries on Linux) and the existing
Workbench development dependencies. From the repository root:

```powershell
npm ci --prefix apps/desktop
npm run build:workbench
npm run dev --prefix apps/desktop
```

Development uses the checkout's already prepared Workbench and Python environment.
Its engine fingerprint must match an existing CLI review before sharing it; a
different engine snapshot displays an incompatibility instead of creating a
second backend against the same job store.

## Build a consumer artifact

```powershell
npm run test --prefix apps/desktop
node --test "test/review-service*.test.js"
npm run prepare:runtime --prefix apps/desktop
npm run smoke:runtime --prefix apps/desktop
npm run build --prefix apps/desktop
```

For a Windows development-shell lifecycle check using the packaged runtime:

```powershell
cargo build --manifest-path apps/desktop/src-tauri/Cargo.toml --locked
npm run smoke:native --prefix apps/desktop
```

This creates its own temporary project and job store, verifies the real native
process and API, exercises duplicate launch and process-loss recovery, and keeps
manual picker/tray/close behavior and signed clean installation as separate gates.

Prepare builds an allowlisted staging copy of the canonical Workbench as a Next
standalone server, freezes the same Python backend with PyInstaller, and copies
the native build's Node binary. Runtimes, UI assets, hashes and notices are
bundled; credentials, private memory, project snapshots, dependency-development
folders and job history are excluded. Generated output is ignored by Git.
The real runtime smoke removes globally installed Node/Python from PATH and
reviews an actual source fixture using the bundled executables.

Source review in a completed installer needs neither global Node nor global Python.
The Windows installer includes the WebView2 offline installer; it does not fetch
application dependencies when a consumer installs or opens PRAXIS.
Optional Chromium browser checks can require a separately authorized download;
Docker remains optional and is never silently substituted with host execution.
Executing a submitted project's build or tests still requires that project's
language toolchain and dependencies, or an explicitly selected Docker runtime.

## Lifecycle and security

The native shell owns only fixed runtime executables. The project webview has
no arbitrary shell/filesystem/plugin permissions. The same dependency-free
Review service manager acquires one private per-user lease before backend
startup recovery touches shared jobs. Endpoint discovery requires a protected
descriptor, instance nonce and authenticated challenge. An occupied port is
never killed or trusted. Direct API requests require the instance capability;
browser/desktop access uses a one-use opening link and HttpOnly session cookie.
The startup mascot is the existing public tray render from
`src/tray/icons-mac/idle.png`; no private brand-vault files enter this app.

Close keeps work running in the tray. The PRAXIS menu reopens it, chooses a
folder, opens the same job store in a browser, or quits. Quit checks real active
jobs and asks before interrupting them. A native-control crash closes the
supervisor pipe; its owned services stop and recorded evidence remains. Existing
data, environment settings and `.praxis` memory are never imported or moved.

## Release status

Native build CI covers Windows x64, macOS arm64/x64 and Ubuntu 22.04 x64. CI
artifacts are development builds. Public download links and automatic updates
must wait for exact-artifact clean installation, native picker/tray/lifecycle
acceptance, Windows code signing, macOS signing/notarization and the separate
release gate. No signing or clean-machine validation is implied by a compile.

```powershell
npm run check:release --prefix apps/desktop
```

That command fails while the required signed-artifact evidence is missing.
Claimed `signature.verified` or notarization fields cannot open it: Windows
artifacts must pass an actual native Authenticode check. Independently verified
cross-platform signature/notarization attestations are not implemented yet, so
the aggregate public release gate stays closed even if metadata says all targets
passed. Development artifacts are usable without satisfying that public gate.
API keys currently use the existing Workbench local settings path; it is a
private local file, not an OS keychain. OS-keychain storage and signed automatic
updating remain release obligations rather than fabricated completed features.

Vendor references: [Tauri capabilities](https://v2.tauri.app/security/capabilities/),
[single-instance](https://v2.tauri.app/plugin/single-instance/),
[native tray](https://v2.tauri.app/learn/system-tray/),
[Next standalone server](https://nextjs.org/docs/app/api-reference/config/next-config-js/output),
[PyInstaller packaging](https://pyinstaller.org/en/stable/usage.html).
