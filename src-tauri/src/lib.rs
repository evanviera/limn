use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter, Manager, State, Window};
use tokio::sync::Semaphore;

// How many card/board files to read concurrently. Bounded so a huge workspace
// can't spawn thousands of blocking OS reads at once, but high enough that a
// cloud-synced vault of "online-only" placeholders hydrates in parallel instead
// of one slow download at a time.
const FILE_READ_CONCURRENCY: usize = 24;

// A single file read that blocks this long is treated as "not locally
// available" (typically a cloud placeholder still downloading) and skipped with
// a warning, so one stuck file can't hold the whole workspace load hostage. The
// orphaned read is left to finish in the background.
const FILE_READ_TIMEOUT: Duration = Duration::from_secs(20);

mod attachments;
mod menu;
mod open_workspaces;
mod persist;
mod storage_hints;

use attachments::{
    add_attachment, delete_attachment, open_attachment, pick_attachment_files,
    read_attachment_large_preview, read_attachment_preview, read_attachment_thumbnail,
    reveal_attachment,
};
use open_workspaces::{get_open_workspaces, save_open_workspaces};
use persist::{
    conditional_delete, conditional_write, ConflictFile, DeleteResult, WriteOutcome, WriteResult,
};
pub(crate) use storage_hints::cloud_storage_hint;

#[derive(Default)]
struct WatchState {
    watcher: Mutex<Option<(PathBuf, RecommendedWatcher)>>,
}

#[derive(Serialize)]
struct WorkspaceFiles {
    settings: String,
    members: String,
    boards: Vec<TextFile>,
    cards: Vec<TextFile>,
    warnings: Vec<String>,
}

// The cheap first phase of a progressive load: everything needed to paint the
// board shell (settings, members, board columns) plus the card count so the UI
// can show real "N of M" progress while the — potentially slow, cloud-hydrated —
// card files stream in via `load_workspace_cards`.
#[derive(Serialize)]
struct WorkspaceMeta {
    settings: String,
    members: String,
    boards: Vec<TextFile>,
    card_count: usize,
    warnings: Vec<String>,
    // A human-readable provider label (e.g. "Google Drive") when the workspace
    // path looks like it lives inside a cloud-sync folder, else null. The
    // frontend turns this into a one-time "pin this folder offline" hint.
    cloud_hint: Option<String>,
}

#[derive(Serialize)]
struct WorkspaceCards {
    cards: Vec<TextFile>,
    warnings: Vec<String>,
}

// Progress ticked out over the `workspace-load-progress` event as cards are read,
// so the loading UI can advance instead of showing an indeterminate spinner.
#[derive(Clone, Serialize)]
struct LoadProgress {
    loaded: usize,
    total: usize,
}

// One targeted file result for the incremental watch-refresh path. `content` is
// None when the file no longer exists on disk (it was deleted remotely), letting
// the frontend drop it without a full workspace reload.
#[derive(Serialize)]
struct WorkspaceFileResult {
    dir: String,
    file_name: String,
    content: Option<String>,
}

#[derive(Deserialize)]
struct FileRef {
    dir: String,
    name: String,
}

// Payload for the `workspace-changed` event: the workspace-relative paths of the
// data files that changed, so the frontend can reload incrementally.
#[derive(Clone, Serialize)]
struct WorkspaceChanged {
    paths: Vec<String>,
}

#[derive(Serialize)]
struct TextFile {
    file_name: String,
    content: String,
}

#[tauri::command]
fn pick_workspace_folder() -> Result<Option<String>, String> {
    Ok(rfd::FileDialog::new()
        .set_title("Open or create Limn workspace")
        .pick_folder()
        .map(|path| path.to_string_lossy().to_string()))
}

#[tauri::command]
fn init_workspace(path: String) -> Result<(), String> {
    let root = workspace_root(&path)?;
    fs::create_dir_all(root.join(".workspace")).map_err(display_err)?;
    fs::create_dir_all(root.join("boards")).map_err(display_err)?;
    fs::create_dir_all(root.join("cards")).map_err(display_err)?;

    let settings_path = root.join(".workspace/settings.json");
    if !settings_path.exists() {
        atomic_write(&settings_path, default_settings(&root)?)?;
    }

    let members_path = root.join(".workspace/members.json");
    if !members_path.exists() {
        atomic_write(
            &members_path,
            "{\n  \"schemaVersion\": 1,\n  \"members\": []\n}\n".to_string(),
        )?;
    }

    Ok(())
}

// Full workspace load (settings, members, boards, cards) in one call. Used by
// the watch-driven background refresh, where there is no spinner to feed with
// progress. Card and board files are read in parallel with a per-file timeout so
// a cloud-synced vault of placeholders hydrates concurrently rather than one
// slow download at a time. Progressive foreground opens use
// `load_workspace_meta` + `load_workspace_cards` instead.
#[tauri::command]
async fn load_workspace(path: String) -> Result<WorkspaceFiles, String> {
    init_workspace(path.clone())?;
    let root = workspace_root(&path)?;

    let board_paths = list_data_files(&root.join("boards"), "json");
    let card_paths = list_data_files(&root.join("cards"), "md");
    let (boards, board_warnings) = read_files_parallel(board_paths, None).await;
    let (cards, card_warnings) = read_files_parallel(card_paths, None).await;
    let warnings = board_warnings.into_iter().chain(card_warnings).collect();

    Ok(WorkspaceFiles {
        settings: read_to_string(root.join(".workspace/settings.json"))?,
        members: read_to_string(root.join(".workspace/members.json"))?,
        boards,
        cards,
        warnings,
    })
}

// Phase one of a progressive open: the small, essential files (settings,
// members, board columns) plus the card count and a cloud-storage hint. Returns
// fast so the UI can paint the board shell immediately, then stream cards in.
#[tauri::command]
async fn load_workspace_meta(path: String) -> Result<WorkspaceMeta, String> {
    init_workspace(path.clone())?;
    let root = workspace_root(&path)?;

    let board_paths = list_data_files(&root.join("boards"), "json");
    let card_count = list_data_files(&root.join("cards"), "md").len();
    let (boards, warnings) = read_files_parallel(board_paths, None).await;

    Ok(WorkspaceMeta {
        settings: read_to_string(root.join(".workspace/settings.json"))?,
        members: read_to_string(root.join(".workspace/members.json"))?,
        boards,
        card_count,
        warnings,
        cloud_hint: cloud_storage_hint(&path),
    })
}

// Phase two of a progressive open: the card files, read in parallel with a
// per-file timeout. Emits `workspace-load-progress` after each file so the UI can
// show "N of M" and the user isn't left staring at an indeterminate spinner.
#[tauri::command]
async fn load_workspace_cards(path: String, window: Window) -> Result<WorkspaceCards, String> {
    let root = workspace_root(&path)?;
    let card_paths = list_data_files(&root.join("cards"), "md");
    let (cards, warnings) = read_files_parallel(card_paths, Some(window)).await;
    Ok(WorkspaceCards { cards, warnings })
}

// Targeted read of specific workspace files (cards or boards) for the
// incremental watch-refresh path, so a one-card external edit re-reads one file
// instead of the whole vault. A file that no longer exists comes back with
// `content: None` so the caller can drop it.
#[tauri::command]
async fn read_workspace_files(
    path: String,
    files: Vec<FileRef>,
) -> Result<Vec<WorkspaceFileResult>, String> {
    let root = workspace_root(&path)?;
    let mut targets: Vec<(String, String, PathBuf)> = Vec::new();
    for file in files {
        let extension = match file.dir.as_str() {
            "cards" => "md",
            "boards" => "json",
            _ => return Err("Unsupported directory".to_string()),
        };
        validate_file_name(&file.name, extension)?;
        let full = root.join(&file.dir).join(&file.name);
        targets.push((file.dir, file.name, full));
    }

    let semaphore = Arc::new(Semaphore::new(FILE_READ_CONCURRENCY));
    let mut handles = Vec::with_capacity(targets.len());
    for (dir, file_name, full) in targets {
        let permit_source = semaphore.clone();
        handles.push(tokio::spawn(async move {
            let _permit = permit_source.acquire_owned().await.ok();
            let content = read_optional_with_timeout(full).await;
            WorkspaceFileResult {
                dir,
                file_name,
                content,
            }
        }));
    }

    let mut results = Vec::with_capacity(handles.len());
    for handle in handles {
        if let Ok(result) = handle.await {
            results.push(result);
        }
    }
    Ok(results)
}

// Read a file that may legitimately be absent (deleted since the watch event).
// A timeout or read error is treated the same as "not readable right now" and
// reported as None, which the incremental refresh handles as a removal.
async fn read_optional_with_timeout(path: PathBuf) -> Option<String> {
    let read_path = path.clone();
    match tokio::time::timeout(
        FILE_READ_TIMEOUT,
        tokio::task::spawn_blocking(move || fs::read_to_string(&read_path)),
    )
    .await
    {
        Ok(Ok(Ok(content))) => Some(content),
        _ => None,
    }
}

// Filter out watcher noise: hidden/temp files (dotfiles, editor swap files, and
// the `.<name>.tmp` staging files that `atomic_write` renames into place). A
// real board/card is never a dotfile, so this drops churn without missing edits.
fn is_ignored_watch_path(path: &Path) -> bool {
    path.file_name()
        .and_then(|name| name.to_str())
        .map(|name| name.starts_with('.'))
        .unwrap_or(true)
}

// List the data files (by extension) in a directory. This is a cheap metadata
// scan even on cloud-synced folders — only reading a file's *contents* forces a
// placeholder to hydrate — so it is safe to do up front to learn the file set.
fn list_data_files(dir: &Path, extension: &str) -> Vec<PathBuf> {
    let mut paths = Vec::new();
    let Ok(entries) = fs::read_dir(dir) else {
        return paths;
    };
    for entry in entries.flatten() {
        let entry_path = entry.path();
        if entry_path
            .extension()
            .and_then(|value| value.to_str())
            .is_some_and(|value| value == extension)
        {
            paths.push(entry_path);
        }
    }
    paths.sort();
    paths
}

// Read many files concurrently with a bounded worker count and a per-file
// timeout. On a local disk this is roughly as fast as a serial read; on a
// cloud-synced vault of "online-only" placeholders it turns N sequential
// on-demand downloads into N parallel ones. A file that doesn't arrive within
// the timeout is skipped with a warning that names it as still downloading, so
// the load always finishes instead of spinning forever. When `window` is set,
// a `workspace-load-progress` event is emitted after each file completes.
async fn read_files_parallel(
    paths: Vec<PathBuf>,
    window: Option<Window>,
) -> (Vec<TextFile>, Vec<String>) {
    let total = paths.len();
    let semaphore = Arc::new(Semaphore::new(FILE_READ_CONCURRENCY));
    let mut handles = Vec::with_capacity(total);

    for path in paths {
        let permit_source = semaphore.clone();
        handles.push(tokio::spawn(async move {
            let _permit = permit_source.acquire_owned().await.ok();
            let file_name = path
                .file_name()
                .map(|name| name.to_string_lossy().to_string())
                .unwrap_or_default();
            let read_path = path.clone();
            let outcome = tokio::time::timeout(
                FILE_READ_TIMEOUT,
                tokio::task::spawn_blocking(move || fs::read_to_string(&read_path)),
            )
            .await;
            match outcome {
                Ok(Ok(Ok(content))) => Ok(TextFile { file_name, content }),
                Ok(Ok(Err(error))) => Err(format!("{file_name} could not be read: {error}")),
                Ok(Err(_)) => Err(format!("{file_name} could not be read: task failed")),
                Err(_) => Err(format!(
                    "{file_name} is taking too long to download from cloud storage and was skipped. Set your sync app to keep this folder available offline."
                )),
            }
        }));
    }

    let mut files = Vec::new();
    let mut warnings = Vec::new();
    let mut done = 0usize;
    for handle in handles {
        match handle.await {
            Ok(Ok(file)) => files.push(file),
            Ok(Err(warning)) => warnings.push(warning),
            Err(_) => warnings.push("A file read task failed unexpectedly.".to_string()),
        }
        done += 1;
        if let Some(window) = &window {
            let _ = window.emit(
                "workspace-load-progress",
                LoadProgress { loaded: done, total },
            );
        }
    }

    files.sort_by(|a, b| a.file_name.cmp(&b.file_name));
    warnings.sort();
    (files, warnings)
}

#[tauri::command]
fn write_workspace_settings(
    path: String,
    content: String,
    expected_version: Option<String>,
) -> Result<WriteResult, String> {
    let root = workspace_root(&path)?;
    fs::create_dir_all(root.join(".workspace")).map_err(display_err)?;
    let outcome = conditional_write(
        &root.join(".workspace/settings.json"),
        &content,
        expected_version.as_deref(),
    )?;
    Ok(finish_write(outcome, ".workspace/settings.json".to_string()))
}

#[tauri::command]
fn write_members(
    path: String,
    content: String,
    expected_version: Option<String>,
) -> Result<WriteResult, String> {
    let root = workspace_root(&path)?;
    fs::create_dir_all(root.join(".workspace")).map_err(display_err)?;
    let outcome = conditional_write(
        &root.join(".workspace/members.json"),
        &content,
        expected_version.as_deref(),
    )?;
    Ok(finish_write(outcome, ".workspace/members.json".to_string()))
}

#[tauri::command]
fn write_board_file(
    path: String,
    file_name: String,
    content: String,
    expected_version: Option<String>,
) -> Result<WriteResult, String> {
    let root = workspace_root(&path)?;
    validate_file_name(&file_name, "json")?;
    fs::create_dir_all(root.join("boards")).map_err(display_err)?;
    let outcome = conditional_write(
        &root.join("boards").join(&file_name),
        &content,
        expected_version.as_deref(),
    )?;
    Ok(finish_write(outcome, format!("boards/{file_name}")))
}

#[tauri::command]
fn write_card_file(
    path: String,
    file_name: String,
    content: String,
    expected_updated_at: Option<String>,
) -> Result<WriteResult, String> {
    let root = workspace_root(&path)?;
    validate_file_name(&file_name, "md")?;
    fs::create_dir_all(root.join("cards")).map_err(display_err)?;
    let outcome = conditional_write(
        &root.join("cards").join(&file_name),
        &content,
        expected_updated_at.as_deref(),
    )?;
    Ok(finish_write(outcome, format!("cards/{file_name}")))
}

// Preserve a local version that could not be safely merged (a hard free-text
// conflict, or a save that lost every compare-and-swap retry). Cards keep the
// existing sibling-copy behaviour in `cards/`; other entities land in
// `.workspace/conflicts/` so they never masquerade as real boards/settings.
#[tauri::command]
fn write_conflict_copy(
    path: String,
    relative_dir: String,
    file_name: String,
    content: String,
) -> Result<String, String> {
    if !matches!(relative_dir.as_str(), "cards" | ".workspace/conflicts") {
        return Err("Unsupported conflict directory".to_string());
    }
    if file_name.contains('/')
        || file_name.contains('\\')
        || file_name.starts_with('.')
        || !file_name.contains('.')
    {
        return Err("Invalid file name".to_string());
    }
    let root = workspace_root(&path)?;
    persist::write_conflict_copy(&root, &relative_dir, &file_name, &content)
}

fn finish_write(outcome: WriteOutcome, relative_path: String) -> WriteResult {
    match outcome {
        WriteOutcome::Written => WriteResult {
            relative_path,
            conflict: false,
            current_content: None,
        },
        WriteOutcome::Conflict(current_content) => WriteResult {
            relative_path,
            conflict: true,
            current_content,
        },
    }
}

// Delete a card, but only if the on-disk version still matches
// `expected_updated_at`. If another device edited it since, the delete is
// refused: the current disk copy is preserved in `.workspace/conflicts/` and the
// conflict is reported so the caller can surface it. Attachments are removed only
// when the card is actually deleted, so a refused delete never orphans them.
#[tauri::command]
fn delete_card_file(
    path: String,
    file_name: String,
    expected_updated_at: Option<String>,
) -> Result<DeleteResult, String> {
    let root = workspace_root(&path)?;
    validate_file_name(&file_name, "md")?;
    let target = root.join("cards").join(&file_name);
    let result = conditional_delete(
        &root,
        &target,
        ".workspace/conflicts",
        &file_name,
        expected_updated_at.as_deref(),
    )?;

    if !result.conflict {
        // Cards are keyed by id and their attachments live in attachments/<id>/,
        // so delete that folder alongside the card file to avoid orphaned files.
        let card_id = file_name.trim_end_matches(".md");
        if !card_id.is_empty() {
            let attachments_dir = root.join("attachments").join(card_id);
            if attachments_dir.exists() {
                let _ = fs::remove_dir_all(attachments_dir);
            }
        }
    }

    Ok(result)
}

// Delete a board, but only if the on-disk version still matches
// `expected_version`; a concurrent edit is preserved as a conflict copy and
// reported rather than discarded. See `delete_card_file`.
#[tauri::command]
fn delete_board_file(
    path: String,
    file_name: String,
    expected_version: Option<String>,
) -> Result<DeleteResult, String> {
    let root = workspace_root(&path)?;
    validate_file_name(&file_name, "json")?;
    let target = root.join("boards").join(&file_name);
    conditional_delete(
        &root,
        &target,
        ".workspace/conflicts",
        &file_name,
        expected_version.as_deref(),
    )
}

// Enumerate every preserved conflict artifact for the in-app review UI.
#[tauri::command]
fn list_conflicts(path: String) -> Result<Vec<ConflictFile>, String> {
    let root = workspace_root(&path)?;
    persist::list_conflicts(&root)
}

// Discard a single conflict artifact once the user has resolved it.
#[tauri::command]
fn delete_conflict_file(path: String, relative_path: String) -> Result<(), String> {
    let root = workspace_root(&path)?;
    persist::delete_conflict(&root, &relative_path)
}

// Resolve a shared card link (`limn://card/<cardId>`): return the first of
// `paths` whose workspace holds that card. Cards are stored as `cards/<id>.md`,
// so the lookup is a plain file-existence check. The id is rejected if it could
// escape the `cards/` directory, so a malicious link can't probe the filesystem.
#[tauri::command]
fn find_card_workspace(card_id: String, paths: Vec<String>) -> Option<String> {
    if card_id.is_empty()
        || card_id.contains('/')
        || card_id.contains('\\')
        || card_id.contains("..")
    {
        return None;
    }
    let file_name = format!("{card_id}.md");
    paths
        .into_iter()
        .find(|path| PathBuf::from(path).join("cards").join(&file_name).is_file())
}

#[tauri::command]
fn watch_workspace(path: String, window: Window, state: State<WatchState>) -> Result<(), String> {
    let root = workspace_root(&path)?;
    let mut watcher_slot = state.watcher.lock().map_err(display_err)?;
    if watcher_slot
        .as_ref()
        .is_some_and(|(active_root, _)| active_root == &root)
    {
        return Ok(());
    }

    let mut last_emit_by_path: HashMap<PathBuf, Instant> = HashMap::new();
    let watcher_window = window.clone();
    let emit_root = root.clone();

    let mut watcher = notify::recommended_watcher(move |result: notify::Result<notify::Event>| {
        let Ok(event) = result else {
            return;
        };

        // Collect the workspace-relative paths of every data file this event
        // touched, deduplicating rapid repeats per path (cloud clients rewrite a
        // file several times as it syncs). Naming the changed paths lets the
        // frontend reload just those files instead of the whole vault.
        let now = Instant::now();
        let mut changed: Vec<String> = Vec::new();
        for path in &event.paths {
            let is_data = path
                .extension()
                .and_then(|extension| extension.to_str())
                .is_some_and(|extension| matches!(extension, "json" | "md"));
            if !is_data {
                continue;
            }
            if is_ignored_watch_path(path) {
                continue;
            }

            let last_emit = last_emit_by_path.get(path).copied();
            let fresh = last_emit
                .map(|last| now.duration_since(last) > Duration::from_millis(250))
                .unwrap_or(true);
            if !fresh {
                continue;
            }
            last_emit_by_path.insert(path.clone(), now);

            if let Ok(relative) = path.strip_prefix(&emit_root) {
                changed.push(relative.to_string_lossy().replace('\\', "/"));
            }
        }

        if !changed.is_empty() {
            let _ = watcher_window.emit("workspace-changed", WorkspaceChanged { paths: changed });
        }
    })
    .map_err(display_err)?;

    watcher
        .watch(&root, RecursiveMode::Recursive)
        .map_err(display_err)?;
    *watcher_slot = Some((root, watcher));
    Ok(())
}

#[tauri::command]
async fn post_slack(webhook_url: String, message: String) -> Result<(), String> {
    let client = reqwest::Client::new();
    let response = client
        .post(webhook_url)
        .json(&serde_json::json!({ "text": message }))
        .send()
        .await
        .map_err(display_err)?;

    if !response.status().is_success() {
        return Err(format!("Slack webhook returned {}", response.status()));
    }

    Ok(())
}

#[tauri::command]
fn open_external(url: String) -> Result<(), String> {
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return Err("Unsupported URL".to_string());
    }
    open::that(url).map_err(display_err)
}

#[tauri::command]
fn open_workspace_folder(path: String) -> Result<(), String> {
    let root = workspace_root(&path)?;
    if !root.exists() {
        return Err("Workspace folder does not exist".to_string());
    }
    open::that(root).map_err(display_err)
}

#[tauri::command]
fn restart_app(app: AppHandle) {
    app.restart();
}

// Write an iCalendar export into the workspace's `exports/` folder. Keeping the
// .ics inside the synced folder fits Limn's local-first, readable-file model.
// Returns the workspace-relative path so the UI can report where it landed.
#[tauri::command]
fn export_calendar(path: String, content: String) -> Result<String, String> {
    let root = workspace_root(&path)?;
    let relative = "exports/limn-due-dates.ics";
    atomic_write(&root.join("exports").join("limn-due-dates.ics"), content)?;
    Ok(relative.to_string())
}

pub fn run() {
    let mut builder = tauri::Builder::default();

    // The single-instance plugin must be registered first so a `limn://` link
    // routes into the already-running app instead of spawning a second copy. On
    // Windows/Linux the OS delivers the link as an argument to that second
    // process; we focus the existing window and forward the URL to the frontend.
    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_focus();
            }
            for arg in argv.iter().skip(1) {
                if arg.starts_with("limn://") {
                    let _ = app.emit("deep-link", arg.clone());
                }
            }
        }));
    }

    builder
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_deep_link::init())
        .manage(WatchState::default())
        .menu(menu::build_app_menu)
        .on_menu_event(|app, event| {
            let id = event.id().as_ref();
            if let Some(command) = id.strip_prefix("limn:") {
                let _ = app.emit("menu-command", command);
            }
        })
        .setup(|app| {
            #[cfg(target_os = "windows")]
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_decorations(false);
                let _ = window.set_shadow(true);
            }
            // macOS delivers deep links to the running app via Apple events; the
            // plugin surfaces them here. Focus the window and hand the URL to the
            // frontend, which resolves the card id against the open workspaces.
            #[cfg(desktop)]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                let handle = app.handle().clone();
                app.deep_link().on_open_url(move |event| {
                    if let Some(window) = handle.get_webview_window("main") {
                        let _ = window.set_focus();
                    }
                    for url in event.urls() {
                        let _ = handle.emit("deep-link", url.to_string());
                    }
                });
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            pick_workspace_folder,
            init_workspace,
            load_workspace,
            load_workspace_meta,
            load_workspace_cards,
            read_workspace_files,
            write_workspace_settings,
            write_members,
            write_board_file,
            write_card_file,
            write_conflict_copy,
            delete_card_file,
            delete_board_file,
            list_conflicts,
            delete_conflict_file,
            pick_attachment_files,
            add_attachment,
            delete_attachment,
            open_attachment,
            reveal_attachment,
            read_attachment_preview,
            read_attachment_thumbnail,
            read_attachment_large_preview,
            save_open_workspaces,
            get_open_workspaces,
            find_card_workspace,
            watch_workspace,
            post_slack,
            open_external,
            open_workspace_folder,
            export_calendar,
            restart_app
        ])
        .run(tauri::generate_context!())
        .expect("error while running Limn");
}

fn workspace_root(path: &str) -> Result<PathBuf, String> {
    let root = PathBuf::from(path);
    if root.as_os_str().is_empty() {
        return Err("Workspace path is empty".to_string());
    }
    Ok(root)
}

#[cfg(test)]
fn read_text_dir(path: &Path, extension: &str) -> Result<(Vec<TextFile>, Vec<String>), String> {
    let mut files = Vec::new();
    let mut warnings = Vec::new();
    if !path.exists() {
        return Ok((files, warnings));
    }

    for entry in fs::read_dir(path).map_err(display_err)? {
        let entry = entry.map_err(display_err)?;
        let entry_path = entry.path();
        if entry_path
            .extension()
            .and_then(|value| value.to_str())
            .is_some_and(|value| value == extension)
        {
            let file_name = entry.file_name().to_string_lossy().to_string();
            match fs::read_to_string(entry_path) {
                Ok(content) => files.push(TextFile { file_name, content }),
                Err(error) => warnings.push(format!("{file_name} could not be read: {error}")),
            }
        }
    }

    files.sort_by(|a, b| a.file_name.cmp(&b.file_name));
    warnings.sort();
    Ok((files, warnings))
}

fn read_to_string(path: PathBuf) -> Result<String, String> {
    fs::read_to_string(path).map_err(display_err)
}

fn atomic_write(path: &Path, content: String) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(display_err)?;
    }

    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| "Invalid file name".to_string())?;
    let tmp = path.with_file_name(format!(".{file_name}.tmp"));
    fs::write(&tmp, content).map_err(display_err)?;
    fs::rename(tmp, path).map_err(display_err)
}

fn default_settings(root: &Path) -> Result<String, String> {
    let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    let name = root
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("Limn Workspace");

    serde_json::to_string_pretty(&serde_json::json!({
        "schemaVersion": 1,
        "workspaceName": name,
        "slackWebhookUrl": "",
        "slackMovedToListNames": "Done",
        "slackNotifications": {
            "cardCompleted": true,
            "cardAssigned": true,
            "subtaskCompleted": true
        },
        "createdAt": now,
        "updatedAt": now
    }))
    .map_err(display_err)
    .map(|content| format!("{content}\n"))
}

fn validate_file_name(file_name: &str, extension: &str) -> Result<(), String> {
    if file_name.contains('/') || file_name.contains('\\') || file_name.starts_with('.') {
        return Err("Invalid file name".to_string());
    }
    if !file_name.ends_with(&format!(".{extension}")) {
        return Err(format!("Expected .{extension} file"));
    }
    Ok(())
}

fn extract_frontmatter_value(content: &str, key: &str) -> Option<String> {
    let mut lines = content.lines();
    if lines.next()? != "---" {
        return None;
    }

    for line in lines {
        if line == "---" {
            break;
        }

        let Some((line_key, raw_value)) = line.split_once(':') else {
            continue;
        };

        if line_key.trim() == key {
            return Some(raw_value.trim().trim_matches('"').to_string());
        }
    }

    None
}

fn display_err<E: std::fmt::Display>(error: E) -> String {
    error.to_string()
}

#[cfg(test)]
mod tests;
