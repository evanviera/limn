use serde::Serialize;
use std::{
    fs,
    path::{Path, PathBuf},
};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AttachmentPreview {
    pub(crate) mime_type: String,
    pub(crate) bytes: Vec<u8>,
}

#[tauri::command]
pub(crate) fn pick_attachment_files() -> Result<Vec<String>, String> {
    Ok(rfd::FileDialog::new()
        .set_title("Add attachments")
        .pick_files()
        .map(|paths| {
            paths
                .into_iter()
                .map(|path| path.to_string_lossy().to_string())
                .collect()
        })
        .unwrap_or_default())
}

#[tauri::command]
pub(crate) fn add_attachment(
    path: String,
    card_id: String,
    stored_name: String,
    source_path: String,
) -> Result<u64, String> {
    let root = crate::workspace_root(&path)?;
    validate_path_segment(&card_id)?;
    validate_path_segment(&stored_name)?;

    let source = PathBuf::from(&source_path);
    if !source.is_file() {
        return Err("Attachment source file was not found".to_string());
    }

    let dir = root.join("attachments").join(&card_id);
    fs::create_dir_all(&dir).map_err(crate::display_err)?;
    let bytes = fs::copy(&source, dir.join(&stored_name)).map_err(crate::display_err)?;
    Ok(bytes)
}

#[tauri::command]
pub(crate) fn delete_attachment(
    path: String,
    card_id: String,
    stored_name: String,
) -> Result<(), String> {
    let root = crate::workspace_root(&path)?;
    validate_path_segment(&card_id)?;
    validate_path_segment(&stored_name)?;

    let dir = root.join("attachments").join(&card_id);
    let target = dir.join(&stored_name);
    if target.exists() {
        fs::remove_file(&target).map_err(crate::display_err)?;
    }
    remove_dir_if_empty(&dir);
    Ok(())
}

#[tauri::command]
pub(crate) fn open_attachment(
    path: String,
    card_id: String,
    stored_name: String,
) -> Result<(), String> {
    let root = crate::workspace_root(&path)?;
    validate_path_segment(&card_id)?;
    validate_path_segment(&stored_name)?;

    let target = root.join("attachments").join(&card_id).join(&stored_name);
    if !target.exists() {
        return Err("Attachment file does not exist".to_string());
    }
    open::that(target).map_err(crate::display_err)
}

#[tauri::command]
pub(crate) fn reveal_attachment(
    path: String,
    card_id: String,
    stored_name: String,
) -> Result<(), String> {
    let root = crate::workspace_root(&path)?;
    validate_path_segment(&card_id)?;
    validate_path_segment(&stored_name)?;

    let target = root.join("attachments").join(&card_id).join(&stored_name);
    if !target.exists() {
        return Err("Attachment file does not exist".to_string());
    }
    reveal_in_file_manager(&target)
}

#[tauri::command]
pub(crate) fn read_attachment_preview(
    path: String,
    card_id: String,
    stored_name: String,
) -> Result<AttachmentPreview, String> {
    let root = crate::workspace_root(&path)?;
    validate_path_segment(&card_id)?;
    validate_path_segment(&stored_name)?;
    let mime_type = attachment_image_mime_type(&stored_name)
        .ok_or_else(|| "Attachment is not a supported image type".to_string())?;

    let target = root.join("attachments").join(&card_id).join(&stored_name);
    if !target.is_file() {
        return Err("Attachment file does not exist".to_string());
    }

    Ok(AttachmentPreview {
        mime_type: mime_type.to_string(),
        bytes: fs::read(target).map_err(crate::display_err)?,
    })
}

// Guard a single path segment (a card id or stored attachment name) so it can be
// safely joined onto the workspace path without escaping it.
fn validate_path_segment(segment: &str) -> Result<(), String> {
    if segment.is_empty()
        || segment.contains('/')
        || segment.contains('\\')
        || segment.starts_with('.')
    {
        return Err("Invalid attachment path".to_string());
    }
    Ok(())
}

// Reveal a file in the OS file manager, selecting it where the platform supports
// it (Finder on macOS, Explorer on Windows) and otherwise opening its folder.
fn reveal_in_file_manager(target: &Path) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg("-R")
            .arg(target)
            .spawn()
            .map(|_| ())
            .map_err(crate::display_err)
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(format!("/select,{}", target.display()))
            .spawn()
            .map(|_| ())
            .map_err(crate::display_err)
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let parent = target
            .parent()
            .ok_or_else(|| "Attachment has no parent directory".to_string())?;
        open::that(parent).map_err(crate::display_err)
    }
}

fn remove_dir_if_empty(dir: &Path) {
    if let Ok(mut entries) = fs::read_dir(dir) {
        if entries.next().is_none() {
            let _ = fs::remove_dir(dir);
        }
    }
}

fn attachment_image_mime_type(stored_name: &str) -> Option<&'static str> {
    let extension = Path::new(stored_name)
        .extension()
        .and_then(|extension| extension.to_str())?
        .to_ascii_lowercase();

    match extension.as_str() {
        "avif" => Some("image/avif"),
        "bmp" => Some("image/bmp"),
        "gif" => Some("image/gif"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "png" => Some("image/png"),
        "svg" => Some("image/svg+xml"),
        "webp" => Some("image/webp"),
        _ => None,
    }
}
