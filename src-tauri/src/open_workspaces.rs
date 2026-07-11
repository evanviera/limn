use serde::Serialize;
use std::{fs, path::PathBuf};
use tauri::{AppHandle, Manager};

// The set of workspaces the user has open as tabs, plus which one is active.
// Persisted in `last-workspace.json`; the historical single-`path` file migrates
// forward (its lone path becomes the sole open tab).
#[derive(Serialize)]
pub(crate) struct OpenWorkspaces {
    active: Option<String>,
    paths: Vec<String>,
}

#[tauri::command]
pub(crate) fn save_open_workspaces(
    app: AppHandle,
    paths: Vec<String>,
    active: String,
) -> Result<(), String> {
    let file = last_workspace_file(&app)?;
    if let Some(parent) = file.parent() {
        fs::create_dir_all(parent).map_err(crate::display_err)?;
    }
    let active = if active.is_empty() {
        serde_json::Value::Null
    } else {
        serde_json::Value::String(active)
    };
    crate::atomic_write(
        &file,
        serde_json::json!({ "path": active, "open": paths }).to_string(),
    )
}

#[tauri::command]
pub(crate) fn get_open_workspaces(app: AppHandle) -> Result<OpenWorkspaces, String> {
    let file = last_workspace_file(&app)?;
    if !file.exists() {
        return Ok(OpenWorkspaces {
            active: None,
            paths: Vec::new(),
        });
    }
    let content = fs::read_to_string(file).map_err(crate::display_err)?;
    let value: serde_json::Value = serde_json::from_str(&content).map_err(crate::display_err)?;
    let active = value
        .get("path")
        .and_then(|path| path.as_str())
        .map(ToOwned::to_owned);
    // Prefer the explicit open-tab list; fall back to the legacy single path so
    // files written by older versions still restore their one workspace.
    let paths = match value.get("open").and_then(|open| open.as_array()) {
        Some(items) => items
            .iter()
            .filter_map(|item| item.as_str().map(ToOwned::to_owned))
            .collect(),
        None => active.clone().into_iter().collect(),
    };
    Ok(OpenWorkspaces { active, paths })
}

fn last_workspace_file(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_config_dir()
        .map_err(crate::display_err)?
        .join("last-workspace.json"))
}
