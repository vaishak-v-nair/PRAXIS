#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    io::{BufRead, BufReader, Write},
    path::PathBuf,
    process::{Child, ChildStdin, Command, Stdio},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        mpsc, Arc, Mutex,
    },
    time::Duration,
};
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Manager, RunEvent, WindowEvent,
};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use tauri_plugin_opener::OpenerExt;

#[derive(Default)]
struct Startup {
    message: String,
    error: Option<String>,
    origin: Option<String>,
    owned: bool,
}
struct Service {
    input: Mutex<Option<ChildStdin>>,
    child: Mutex<Option<Child>>,
    pending: Mutex<HashMap<u64, mpsc::SyncSender<Result<Value, String>>>>,
    sequence: AtomicU64,
    startup: Mutex<Startup>,
    bootstrap: Mutex<Option<tauri::Url>>,
    stopping: AtomicBool,
    tray_available: AtomicBool,
}
impl Default for Service {
    fn default() -> Self {
        Self {
            input: Mutex::new(None),
            child: Mutex::new(None),
            pending: Mutex::new(HashMap::new()),
            sequence: AtomicU64::new(1),
            startup: Mutex::new(Startup::default()),
            bootstrap: Mutex::new(None),
            stopping: AtomicBool::new(false),
            tray_available: AtomicBool::new(false),
        }
    }
}
impl Service {
    fn request(&self, method: &str, params: Value) -> Result<Value, String> {
        let id = self.sequence.fetch_add(1, Ordering::SeqCst);
        let (sender, receiver) = mpsc::sync_channel(1);
        {
            let mut pending = self
                .pending
                .lock()
                .map_err(|_| "Desktop state unavailable")?;
            if pending.len() >= 64 {
                return Err(
                    "Too many pending desktop actions. Wait for the local Review service.".into(),
                );
            }
            pending.insert(id, sender);
        }
        let result = (|| {
            let mut input = self
                .input
                .lock()
                .map_err(|_| "Desktop control unavailable")?;
            let stream = input
                .as_mut()
                .ok_or("The Review service is not connected.")?;
            let mut frame = params;
            frame["id"] = json!(id);
            frame["method"] = json!(method);
            writeln!(stream, "{}", frame).map_err(|_| "The local Review control pipe stopped.")?;
            stream
                .flush()
                .map_err(|_| "The local Review control pipe stopped.")?;
            drop(input);
            receiver
                .recv_timeout(Duration::from_secs(15))
                .map_err(|_| {
                    "The local Review service did not respond. Existing evidence was preserved."
                        .to_string()
                })?
        })();
        self.pending
            .lock()
            .map_err(|_| "Desktop state unavailable")?
            .remove(&id);
        result
    }
}

fn failure(app: &tauri::AppHandle, message: String) {
    if let Ok(mut state) = app.state::<Arc<Service>>().startup.lock() {
        state.error = Some(message.clone());
    }
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        if let Ok(bootstrap) = app.state::<Arc<Service>>().bootstrap.lock() {
            if let Some(url) = bootstrap.as_ref() {
                let _ = window.navigate(url.clone());
            }
        }
    }
    app.dialog()
        .message(message)
        .title("PRAXIS needs attention")
        .kind(MessageDialogKind::Error)
        .show(|_| {});
}

fn workspace_url(origin: &str, address: &str) -> Result<tauri::Url, String> {
    let origin = tauri::Url::parse(origin).map_err(|_| "Invalid local workspace origin.")?;
    let url = tauri::Url::parse(address).map_err(|_| "Invalid local workspace address.")?;
    if origin.scheme() != "http"
        || origin.host_str() != Some("127.0.0.1")
        || origin.port().is_none()
        || origin.path() != "/"
        || origin.query().is_some()
        || origin.fragment().is_some()
        || !origin.username().is_empty()
        || origin.password().is_some()
        || url.origin() != origin.origin()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err("The workspace address does not belong to this local Review instance.".into());
    }
    Ok(url)
}

fn data_directory(default: PathBuf) -> Result<PathBuf, String> {
    #[cfg(debug_assertions)]
    if let Some(override_path) = std::env::var_os("PRAXIS_DESKTOP_DATA_ROOT") {
        let override_path = PathBuf::from(override_path);
        if !override_path.is_absolute() || override_path.parent().is_none() {
            return Err("A desktop test data directory must be absolute and dedicated.".into());
        }
        return Ok(override_path);
    }
    // Release artifacts always use the same per-user store as the CLI.
    Ok(default)
}

// Tauri's canonical executable/resource paths can contain the Windows verbatim
// namespace prefix. Node cannot resolve its main module from that prefix. Keep
// the same absolute disk/UNC location while removing only that namespace form;
// opaque device namespaces are not valid application runtime locations.
fn execution_path(path: PathBuf) -> Result<PathBuf, String> {
    if !path.is_absolute() {
        return Err("The bundled runtime location must be absolute.".into());
    }
    #[cfg(windows)]
    {
        use std::ffi::OsString;
        use std::path::{Component, Prefix};
        let mut components = path.components();
        let mut normalized = match components.next() {
            Some(Component::Prefix(prefix)) => match prefix.kind() {
                Prefix::VerbatimDisk(drive) => PathBuf::from(format!("{}:\\", drive as char)),
                Prefix::VerbatimUNC(server, share) => {
                    let mut root = OsString::from(r"\\");
                    root.push(server);
                    root.push(r"\");
                    root.push(share);
                    PathBuf::from(root)
                }
                Prefix::Verbatim(_) | Prefix::DeviceNS(_) => {
                    return Err(
                        "An opaque Windows device path cannot supply the bundled runtime.".into(),
                    );
                }
                _ => return Ok(path),
            },
            _ => return Ok(path),
        };
        for component in components {
            if !matches!(component, Component::RootDir) {
                normalized.push(component.as_os_str());
            }
        }
        return Ok(normalized);
    }
    #[cfg(not(windows))]
    Ok(path)
}

fn open(app: &tauri::AppHandle, target: String, browser: bool) {
    let app = app.clone();
    std::thread::spawn(move || {
        match app
            .state::<Arc<Service>>()
            .request("open", json!({"target":target}))
        {
            Ok(value) => {
                if let Some(url) = value["url"].as_str() {
                    let origin = app
                        .state::<Arc<Service>>()
                        .startup
                        .lock()
                        .ok()
                        .and_then(|state| state.origin.clone());
                    let url = match origin
                        .as_deref()
                        .and_then(|origin| workspace_url(origin, url).ok())
                    {
                        Some(url) => url,
                        None => {
                            failure(
                                &app,
                                "The local workspace address could not be authenticated.".into(),
                            );
                            return;
                        }
                    };
                    if browser {
                        if app.opener().open_url(url, None::<&str>).is_err() {
                            failure(
                                &app,
                                "The browser could not open. Reopen PRAXIS from its tray menu."
                                    .into(),
                            );
                        }
                    } else if let Some(window) = app.get_webview_window("main") {
                        let _ = window.navigate(url);
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
            }
            Err(error) => failure(&app, error),
        }
    });
}

fn quit(app: &tauri::AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || {
        let status = app.state::<Arc<Service>>().request("status", json!({}));
        let active = status
            .as_ref()
            .ok()
            .and_then(|value| value["activeJobs"].as_u64());
        if active.unwrap_or(1) > 0 {
            let dialog_app = app.clone();
            let description = active.map(|count| format!("{count} review(s) are still running. Quit will interrupt them and preserve recorded evidence. Closing the window keeps them running.")).unwrap_or("Review activity could not be read. Quit may interrupt work. Existing evidence will be preserved.".into());
            app.dialog()
                .message(description)
                .title("Quit PRAXIS?")
                .buttons(MessageDialogButtons::OkCancelCustom(
                    "Quit and interrupt".into(),
                    "Keep working".into(),
                ))
                .show(move |confirmed| {
                    if confirmed {
                        stop_and_exit(&dialog_app, true);
                    }
                });
        } else {
            stop_and_exit(&app, false);
        }
    });
}
fn stop_and_exit(app: &tauri::AppHandle, force: bool) {
    let app = app.clone();
    std::thread::spawn(move || {
        app.state::<Arc<Service>>()
            .stopping
            .store(true, Ordering::SeqCst);
        match app
            .state::<Arc<Service>>()
            .request("quit", json!({"force":force}))
        {
            Ok(_) => app.exit(0),
            Err(error) => {
                app.state::<Arc<Service>>()
                    .stopping
                    .store(false, Ordering::SeqCst);
                failure(&app, error);
            }
        }
    });
}

fn begin(app: &tauri::AppHandle) -> Result<(), String> {
    let service = app.state::<Arc<Service>>().inner().clone();
    if service
        .child
        .lock()
        .map_err(|_| "Desktop process state unavailable")?
        .as_mut()
        .is_some_and(|child| child.try_wait().ok().flatten().is_none())
    {
        return Err("The Review service is already starting or connected.".into());
    }
    let resource = app
        .path()
        .resource_dir()
        .map_err(|error| error.to_string())?;
    let runtime = execution_path(if cfg!(debug_assertions) {
        std::env::var_os("PRAXIS_DESKTOP_RUNTIME")
            .map(PathBuf::from)
            .unwrap_or(resource.join("runtime"))
    } else {
        resource.join("runtime")
    })?;
    let node = execution_path(if cfg!(debug_assertions) {
        std::env::var_os("PRAXIS_DESKTOP_NODE")
            .map(PathBuf::from)
            .unwrap_or(runtime.join(if cfg!(windows) { "node.exe" } else { "node" }))
    } else {
        runtime.join(if cfg!(windows) { "node.exe" } else { "node" })
    })?;
    let data = data_directory(
        app.path()
            .local_data_dir()
            .map_err(|error| error.to_string())?
            .join("PRAXIS")
            .join("ProjectReview")
            .join("data"),
    )?;
    let data_base = data
        .parent()
        .ok_or("The Review data directory has no private parent.")?;
    std::fs::create_dir_all(&data).map_err(|error| error.to_string())?;
    let mut command = Command::new(node);
    command
        .arg(runtime.join("supervisor.mjs"))
        .current_dir(&runtime)
        .env("PRAXIS_DESKTOP_DATA_ROOT", &data)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped());
    // Logs stay local and never include the private endpoint capability.
    let logfile = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(data_base.join("review-service.log"))
        .map_err(|error| error.to_string())?;
    command.stderr(Stdio::from(logfile));
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let mut child = command.spawn().map_err(|_| "The bundled Review runtime could not start. Reinstall this desktop build or use the source route.".to_string())?;
    let output = child
        .stdout
        .take()
        .ok_or("The Review startup pipe was unavailable.")?;
    *service
        .input
        .lock()
        .map_err(|_| "Desktop control unavailable")? = child.stdin.take();
    *service
        .child
        .lock()
        .map_err(|_| "Desktop process state unavailable")? = Some(child);
    *service
        .startup
        .lock()
        .map_err(|_| "Desktop startup state unavailable")? = Startup {
        message: "Starting the existing project-review engine…".into(),
        ..Startup::default()
    };
    let app = app.clone();
    std::thread::spawn(move || {
        for line in BufReader::new(output).lines() {
            let value: Value = match line
                .ok()
                .filter(|line| line.len() < 16384)
                .and_then(|line| serde_json::from_str(&line).ok())
            {
                Some(value) => value,
                None => continue,
            };
            if value["event"] == "ready" {
                let url = match value["origin"]
                    .as_str()
                    .zip(value["url"].as_str())
                    .and_then(|(origin, url)| workspace_url(origin, url).ok())
                {
                    Some(url) => url,
                    None => {
                        failure(
                            &app,
                            "The Review process returned an invalid local workspace address."
                                .into(),
                        );
                        continue;
                    }
                };
                if let Ok(mut state) = service.startup.lock() {
                    state.message = "Local workspace connected.".into();
                    state.origin = value["origin"].as_str().map(String::from);
                    state.owned = value["owned"].as_bool().unwrap_or(false);
                }
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.navigate(url);
                }
            } else if value["event"] == "error" {
                failure(
                    &app,
                    value["error"]
                        .as_str()
                        .unwrap_or("Review startup failed.")
                        .into(),
                );
            } else if let Some(id) = value["id"].as_u64() {
                if let Ok(mut pending) = service.pending.lock() {
                    if let Some(sender) = pending.remove(&id) {
                        let result = value["error"]
                            .as_str()
                            .map(|error| Err(error.to_string()))
                            .unwrap_or_else(|| Ok(value["result"].clone()));
                        let _ = sender.send(result);
                    }
                }
            }
        }
        if let Ok(mut input) = service.input.lock() {
            *input = None;
        }
        if let Ok(mut pending) = service.pending.lock() {
            for (_, sender) in pending.drain() {
                let _ = sender.send(Err(
                    "The local Review process stopped. Recorded evidence remains on disk.".into(),
                ));
            }
        }
        if !service.stopping.load(Ordering::SeqCst) {
            failure(&app, "The local Review process stopped. Reopen PRAXIS; recorded evidence remains on disk.".into());
        }
    });
    Ok(())
}

#[tauri::command]
fn startup_status(state: tauri::State<'_, Arc<Service>>) -> Value {
    match state.startup.lock() {
        Ok(value) => json!({"message":value.message,"error":value.error}),
        Err(_) => json!({"error":"Desktop startup state unavailable."}),
    }
}
#[tauri::command]
fn retry_startup(app: tauri::AppHandle) -> Result<(), String> {
    begin(&app)
}

fn main() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(Arc::new(Service::default()))
        .invoke_handler(tauri::generate_handler![startup_status, retry_startup])
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                *app.state::<Arc<Service>>()
                    .bootstrap
                    .lock()
                    .map_err(|_| "Desktop startup state unavailable")? = Some(window.url()?);
            }
            let open_item = MenuItem::with_id(app, "open", "Open PRAXIS", true, None::<&str>)?;
            let folder_item =
                MenuItem::with_id(app, "folder", "Choose project folder…", true, None::<&str>)?;
            let browser_item =
                MenuItem::with_id(app, "browser", "Open in browser", true, None::<&str>)?;
            let history_item =
                MenuItem::with_id(app, "history", "Recent reviews", true, None::<&str>)?;
            let settings_item = MenuItem::with_id(app, "settings", "Settings", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit PRAXIS", true, None::<&str>)?;
            let menu = Menu::with_items(
                app,
                &[
                    &open_item,
                    &folder_item,
                    &browser_item,
                    &history_item,
                    &settings_item,
                    &quit_item,
                ],
            )?;
            app.set_menu(menu.clone())?;
            app.on_menu_event(|app, event| match event.id().as_ref() {
                "open" => open(app, "/".into(), false),
                "browser" => open(app, "/".into(), true),
                "history" => open(app, "/?view=history".into(), false),
                "settings" => open(app, "/?view=settings".into(), false),
                "quit" => quit(app),
                "folder" => {
                    let app = app.clone();
                    app.clone()
                        .dialog()
                        .file()
                        .set_title("Choose your project folder")
                        .pick_folder(move |folder| {
                            if let Some(folder) = folder {
                                if let Ok(folder) = folder.into_path() {
                                    let mut url = tauri::Url::parse("http://127.0.0.1/").unwrap();
                                    url.query_pairs_mut()
                                        .append_pair("project", &folder.to_string_lossy());
                                    open(
                                        &app,
                                        format!(
                                            "/{}",
                                            url.query()
                                                .map(|query| format!("?{query}"))
                                                .unwrap_or_default()
                                        ),
                                        false,
                                    );
                                }
                            }
                        });
                }
                _ => {}
            });
            let image = tauri::image::Image::from_bytes(include_bytes!("../icons/128x128.png"))?;
            match TrayIconBuilder::new()
                .icon(image)
                .tooltip("PRAXIS · local project review")
                .menu(&menu)
                .show_menu_on_left_click(true)
                .build(app)
            {
                Ok(_) => app
                    .state::<Arc<Service>>()
                    .tray_available
                    .store(true, Ordering::SeqCst),
                Err(error) => {
                    eprintln!("Tray unavailable; closing the window will offer to quit: {error}")
                }
            }
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                if let Err(error) = begin(&handle) {
                    failure(&handle, error);
                }
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                if window
                    .state::<Arc<Service>>()
                    .tray_available
                    .load(Ordering::SeqCst)
                {
                    let _ = window.hide();
                } else {
                    quit(window.app_handle());
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("PRAXIS desktop initialization failed");
    app.run(|app, event| {
        if let RunEvent::ExitRequested { api, code, .. } = event {
            if code.is_none() {
                api.prevent_exit();
                quit(app);
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn workspace_navigation_remains_on_the_authenticated_instance() {
        let origin = "http://127.0.0.1:4179";
        assert!(workspace_url(origin, "http://127.0.0.1:4179/__praxis/bootstrap#ticket").is_ok());
        for address in [
            "http://127.0.0.1:4180/",
            "https://example.com/",
            "javascript:alert(1)",
            "http://user@127.0.0.1:4179/",
        ] {
            assert!(workspace_url(origin, address).is_err());
        }
        assert!(workspace_url("http://example.com:4179", "http://example.com:4179/").is_err());
    }
    #[test]
    fn failed_requests_do_not_leak_pending_native_actions() {
        let service = Service::default();
        for _ in 0..70 {
            assert!(service.request("status", json!({})).is_err());
        }
        assert!(service.pending.lock().unwrap().is_empty());
    }
    #[test]
    fn runtime_locations_must_remain_absolute() {
        assert!(execution_path(PathBuf::from("runtime/node")).is_err());
    }
    #[cfg(windows)]
    #[test]
    fn windows_disk_namespace_paths_keep_the_same_absolute_runtime_location() {
        assert_eq!(
            execution_path(PathBuf::from(r"\\?\E:\PRAXIS Folder\runtime\node.exe")).unwrap(),
            PathBuf::from(r"E:\PRAXIS Folder\runtime\node.exe")
        );
        let ordinary = PathBuf::from(r"E:\PRAXIS Folder\runtime\node.exe");
        assert_eq!(execution_path(ordinary.clone()).unwrap(), ordinary);
    }
    #[cfg(windows)]
    #[test]
    fn windows_unc_namespace_paths_preserve_server_share_and_unicode() {
        assert_eq!(
            execution_path(PathBuf::from(
                r"\\?\UNC\server\share\PRAXIS Ω\runtime\node.exe"
            ))
            .unwrap(),
            PathBuf::from(r"\\server\share\PRAXIS Ω\runtime\node.exe")
        );
        for device in [
            r"\\.\device\runtime\node.exe",
            r"\\?\GLOBALROOT\Device\runtime\node.exe",
        ] {
            assert!(execution_path(PathBuf::from(device)).is_err());
        }
    }
}
