fn main() {
    // App commands otherwise bypass the capability allowlist by default.
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&["startup_status", "retry_startup"]),
    ))
    .expect("PRAXIS desktop capability generation failed");
}
