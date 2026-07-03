use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter, Manager, State, Window};

mod attachments;
mod menu;

use attachments::{
    add_attachment, delete_attachment, open_attachment, pick_attachment_files,
    read_attachment_preview,
};

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

#[derive(Serialize)]
struct TextFile {
    file_name: String,
    content: String,
}

#[derive(Serialize)]
struct WriteResult {
    relative_path: String,
    conflict: bool,
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

#[tauri::command]
fn load_workspace(path: String) -> Result<WorkspaceFiles, String> {
    init_workspace(path.clone())?;
    let root = workspace_root(&path)?;

    let (boards, board_warnings) = read_text_dir(&root.join("boards"), "json")?;
    let (cards, card_warnings) = read_text_dir(&root.join("cards"), "md")?;
    let warnings = board_warnings.into_iter().chain(card_warnings).collect();

    Ok(WorkspaceFiles {
        settings: read_to_string(root.join(".workspace/settings.json"))?,
        members: read_to_string(root.join(".workspace/members.json"))?,
        boards,
        cards,
        warnings,
    })
}

#[tauri::command]
fn write_workspace_settings(path: String, content: String) -> Result<(), String> {
    let root = workspace_root(&path)?;
    fs::create_dir_all(root.join(".workspace")).map_err(display_err)?;
    atomic_write(&root.join(".workspace/settings.json"), content)
}

#[tauri::command]
fn write_members(path: String, content: String) -> Result<(), String> {
    let root = workspace_root(&path)?;
    fs::create_dir_all(root.join(".workspace")).map_err(display_err)?;
    atomic_write(&root.join(".workspace/members.json"), content)
}

#[tauri::command]
fn write_board_file(path: String, file_name: String, content: String) -> Result<(), String> {
    let root = workspace_root(&path)?;
    validate_file_name(&file_name, "json")?;
    fs::create_dir_all(root.join("boards")).map_err(display_err)?;
    atomic_write(&root.join("boards").join(file_name), content)
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

    let target = root.join("cards").join(&file_name);
    let mut relative_path = format!("cards/{file_name}");
    let mut conflict = false;

    if let Some(expected) = expected_updated_at {
        if target.exists() {
            let current = fs::read_to_string(&target).map_err(display_err)?;
            if extract_frontmatter_value(&current, "updatedAt").as_deref()
                != Some(expected.as_str())
            {
                conflict = true;
                let stem = file_name.trim_end_matches(".md");
                let conflict_name = format!(
                    "{stem}_conflict_{}.md",
                    chrono::Utc::now().format("%Y%m%d%H%M%S%f")
                );
                relative_path = format!("cards/{conflict_name}");
                atomic_write(&root.join("cards").join(conflict_name), content)?;
                return Ok(WriteResult {
                    relative_path,
                    conflict,
                });
            }
        }
    }

    atomic_write(&target, content)?;
    Ok(WriteResult {
        relative_path,
        conflict,
    })
}

#[tauri::command]
fn delete_card_file(path: String, file_name: String) -> Result<(), String> {
    let root = workspace_root(&path)?;
    validate_file_name(&file_name, "md")?;
    let target = root.join("cards").join(&file_name);
    if target.exists() {
        fs::remove_file(&target).map_err(display_err)?;
    }
    // Cards are keyed by id and their attachments live in attachments/<id>/, so
    // delete that folder alongside the card file to avoid orphaned files.
    let card_id = file_name.trim_end_matches(".md");
    if !card_id.is_empty() {
        let attachments_dir = root.join("attachments").join(card_id);
        if attachments_dir.exists() {
            let _ = fs::remove_dir_all(attachments_dir);
        }
    }
    Ok(())
}

#[tauri::command]
fn delete_board_file(path: String, file_name: String) -> Result<(), String> {
    let root = workspace_root(&path)?;
    validate_file_name(&file_name, "json")?;
    let target = root.join("boards").join(file_name);
    if target.exists() {
        fs::remove_file(target).map_err(display_err)?;
    }
    Ok(())
}

#[tauri::command]
fn save_last_workspace(app: AppHandle, path: String) -> Result<(), String> {
    let file = last_workspace_file(&app)?;
    if let Some(parent) = file.parent() {
        fs::create_dir_all(parent).map_err(display_err)?;
    }
    atomic_write(&file, serde_json::json!({ "path": path }).to_string())
}

#[tauri::command]
fn get_last_workspace(app: AppHandle) -> Result<Option<String>, String> {
    let file = last_workspace_file(&app)?;
    if !file.exists() {
        return Ok(None);
    }
    let content = fs::read_to_string(file).map_err(display_err)?;
    let value: serde_json::Value = serde_json::from_str(&content).map_err(display_err)?;
    Ok(value
        .get("path")
        .and_then(|path| path.as_str())
        .map(ToOwned::to_owned))
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

    let mut watcher = notify::recommended_watcher(move |result: notify::Result<notify::Event>| {
        let Ok(event) = result else {
            return;
        };

        let now = Instant::now();
        let should_emit = event.paths.iter().any(|path| {
            let is_data = path
                .extension()
                .and_then(|extension| extension.to_str())
                .is_some_and(|extension| matches!(extension, "json" | "md"));
            if !is_data {
                return false;
            }

            let last_emit = last_emit_by_path.get(path).copied();
            let fresh = last_emit
                .map(|last| now.duration_since(last) > Duration::from_millis(250))
                .unwrap_or(true);
            if fresh {
                last_emit_by_path.insert(path.clone(), now);
            }
            fresh
        });

        if should_emit {
            let _ = watcher_window.emit("workspace-changed", ());
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

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(WatchState::default())
        .menu(menu::build_app_menu)
        .on_menu_event(|app, event| {
            let id = event.id().as_ref();
            if let Some(command) = id.strip_prefix("limn:") {
                let _ = app.emit("menu-command", command);
            }
        })
        .setup(|_app| {
            #[cfg(target_os = "windows")]
            if let Some(window) = _app.get_webview_window("main") {
                let _ = window.set_decorations(false);
                let _ = window.set_shadow(true);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            pick_workspace_folder,
            init_workspace,
            load_workspace,
            write_workspace_settings,
            write_members,
            write_board_file,
            write_card_file,
            delete_card_file,
            delete_board_file,
            pick_attachment_files,
            add_attachment,
            delete_attachment,
            open_attachment,
            read_attachment_preview,
            save_last_workspace,
            get_last_workspace,
            watch_workspace,
            post_slack,
            open_external,
            open_workspace_folder,
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
        "slackNotifications": {
            "cardMovedToDone": true,
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

fn last_workspace_file(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_config_dir()
        .map_err(display_err)?
        .join("last-workspace.json"))
}

fn display_err<E: std::fmt::Display>(error: E) -> String {
    error.to_string()
}

#[cfg(test)]
mod tests;
