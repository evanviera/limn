use image::{DynamicImage, GenericImageView};
use std::{
    fs,
    io::Cursor,
    path::{Path, PathBuf},
    time::SystemTime,
};
use tauri::ipc::Response;

// A cached, downscaled rendering of an image attachment. `max_dimension` is the
// longest-side pixel budget; `suffix` distinguishes each tier's cache file so both
// can live side by side under the same folder.
pub(crate) struct PreviewTier {
    max_dimension: u32,
    suffix: &'static str,
}

// The tiny cover/row thumbnail. Large enough to stay crisp for a board card cover on
// a HiDPI display (~2x its ~300px width), tiny next to the originals it replaces.
pub(crate) const THUMBNAIL_TIER: PreviewTier = PreviewTier {
    max_dimension: 640,
    suffix: "",
};
// The lightbox rendering. Sized for a fit-to-screen viewer on a large HiDPI display,
// so opening a huge attachment decodes a few megapixels instead of tens. The true
// original is always a click away via "Open in default app".
pub(crate) const LIGHTBOX_TIER: PreviewTier = PreviewTier {
    max_dimension: 2560,
    suffix: "preview.",
};

// Cache subfolder under attachments/<card_id>/. Hidden so it reads as scratch data
// and never collides with a stored attachment name.
const THUMBNAIL_DIR: &str = ".thumbnails";

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
    let dest = dir.join(&stored_name);
    let bytes = fs::copy(&source, &dest).map_err(crate::display_err)?;

    // Pre-build the downscaled renderings so the first board render and the first
    // lightbox open are instant rather than decoding the full-resolution original on
    // the UI's critical path. Best effort: non-image attachments simply skip this.
    prebuild_previews(&dir.join(THUMBNAIL_DIR), &stored_name, &dest);

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

    // Drop the cached renderings alongside the original so the cache folder can empty
    // out and the card's attachment directory can be pruned when it is bare.
    let thumb_dir = dir.join(THUMBNAIL_DIR);
    for tier in [&THUMBNAIL_TIER, &LIGHTBOX_TIER] {
        for ext in THUMBNAIL_EXTENSIONS {
            let _ = fs::remove_file(thumb_dir.join(format!("{stored_name}.{}{ext}", tier.suffix)));
        }
    }
    remove_dir_if_empty(&thumb_dir);

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

// All three preview commands return their bytes as a raw binary IPC `Response`
// rather than a serde struct. That matters for large images: Tauri serializes a
// `Vec<u8>` return value as a JSON array of numbers, so an ~800 KB preview would
// balloon into multiple megabytes of JSON to build, transfer, and parse on every
// view. `Response` ships the bytes verbatim, which is what keeps flipping between
// large attachments in the lightbox instant.

#[tauri::command]
pub(crate) fn read_attachment_preview(
    path: String,
    card_id: String,
    stored_name: String,
) -> Result<Response, String> {
    Ok(Response::new(attachment_preview(&path, &card_id, &stored_name)?))
}

// The small ~640px cover/row thumbnail.
#[tauri::command]
pub(crate) fn read_attachment_thumbnail(
    path: String,
    card_id: String,
    stored_name: String,
) -> Result<Response, String> {
    Ok(Response::new(attachment_rendering(
        &path,
        &card_id,
        &stored_name,
        &THUMBNAIL_TIER,
    )?))
}

// The fit-to-screen ~2560px lightbox rendering.
#[tauri::command]
pub(crate) fn read_attachment_large_preview(
    path: String,
    card_id: String,
    stored_name: String,
) -> Result<Response, String> {
    Ok(Response::new(attachment_rendering(
        &path,
        &card_id,
        &stored_name,
        &LIGHTBOX_TIER,
    )?))
}

// Read an image attachment's raw bytes. Used directly for formats we cannot
// downscale (SVG, AVIF without a native codec), which are small enough as-is.
pub(crate) fn attachment_preview(
    path: &str,
    card_id: &str,
    stored_name: &str,
) -> Result<Vec<u8>, String> {
    let root = crate::workspace_root(path)?;
    validate_path_segment(card_id)?;
    validate_path_segment(stored_name)?;
    // Reject types we would never treat as an image before touching the disk.
    attachment_image_mime_type(stored_name)
        .ok_or_else(|| "Attachment is not a supported image type".to_string())?;

    let target = root.join("attachments").join(card_id).join(stored_name);
    if !target.is_file() {
        return Err("Attachment file does not exist".to_string());
    }

    fs::read(target).map_err(crate::display_err)
}

// Build (or reuse the cache of) a downscaled rendering for the given tier. This is
// what the board covers and the lightbox load instead of the multi-megapixel
// original, keeping both the IPC payload and the webview's decode work tiny.
// Undecodable formats transparently fall back to the raw file bytes.
pub(crate) fn attachment_rendering(
    path: &str,
    card_id: &str,
    stored_name: &str,
    tier: &PreviewTier,
) -> Result<Vec<u8>, String> {
    let root = crate::workspace_root(path)?;
    validate_path_segment(card_id)?;
    validate_path_segment(stored_name)?;

    let source = root.join("attachments").join(card_id).join(stored_name);
    if !source.is_file() {
        return Err("Attachment file does not exist".to_string());
    }

    match load_or_build_preview(&root, card_id, stored_name, &source, tier) {
        Some(bytes) => Ok(bytes),
        None => attachment_preview(path, card_id, stored_name),
    }
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

// The output formats a thumbnail can be cached as. JPEG for opaque images (small),
// PNG when the source carries transparency (so cut-outs and screenshots stay clean).
const THUMBNAIL_EXTENSIONS: [&str; 2] = ["jpg", "png"];

// Serve a cached rendering for the given tier when one is fresh, otherwise build
// (and cache) it. Returns None only when the source is not a raster image we can
// decode, letting the caller fall back to the raw bytes.
fn load_or_build_preview(
    root: &Path,
    card_id: &str,
    stored_name: &str,
    source: &Path,
    tier: &PreviewTier,
) -> Option<Vec<u8>> {
    let thumb_dir = root.join("attachments").join(card_id).join(THUMBNAIL_DIR);
    let source_mtime = modified_time(source);

    for ext in THUMBNAIL_EXTENSIONS {
        let candidate = thumb_dir.join(format!("{stored_name}.{}{ext}", tier.suffix));
        if let Some(bytes) = read_fresh_thumbnail(&candidate, source_mtime) {
            return Some(bytes);
        }
    }

    let image = image::open(source).ok()?;
    render_and_cache(&thumb_dir, stored_name, &image, tier)
}

// Decode the source once and cache every tier from it. Used when an attachment is
// added so both the board thumbnail and the lightbox preview are ready up front.
fn prebuild_previews(thumb_dir: &Path, stored_name: &str, source: &Path) {
    let Ok(image) = image::open(source) else {
        return;
    };
    for tier in [&THUMBNAIL_TIER, &LIGHTBOX_TIER] {
        let _ = render_and_cache(thumb_dir, stored_name, &image, tier);
    }
}

// Load a cached rendering if it exists and has not been outdated by a newer source.
fn read_fresh_thumbnail(candidate: &Path, source_mtime: Option<SystemTime>) -> Option<Vec<u8>> {
    let metadata = fs::metadata(candidate).ok()?;
    if let (Some(source), Ok(thumb)) = (source_mtime, metadata.modified()) {
        if source > thumb {
            return None;
        }
    }
    fs::read(candidate).ok()
}

// Shrink a decoded image to fit the tier's pixel budget, encode it (JPEG for opaque
// images, PNG when the source has transparency), and write it into the cache folder.
// Returns the freshly built bytes even if the cache write fails.
fn render_and_cache(
    thumb_dir: &Path,
    stored_name: &str,
    image: &DynamicImage,
    tier: &PreviewTier,
) -> Option<Vec<u8>> {
    let (width, height) = image.dimensions();
    let scaled_owned;
    let scaled = if width > tier.max_dimension || height > tier.max_dimension {
        scaled_owned = image.thumbnail(tier.max_dimension, tier.max_dimension);
        &scaled_owned
    } else {
        image
    };

    let (ext, bytes) = encode_preview(scaled)?;
    if fs::create_dir_all(thumb_dir).is_ok() {
        let _ = fs::write(
            thumb_dir.join(format!("{stored_name}.{}{ext}", tier.suffix)),
            &bytes,
        );
    }

    Some(bytes)
}

// Encode a (already downscaled) image to the smallest sensible format: JPEG for
// opaque images, PNG when it carries an alpha channel so transparency survives. The
// returned extension names the tier's cache file.
fn encode_preview(image: &DynamicImage) -> Option<(&'static str, Vec<u8>)> {
    let mut bytes: Vec<u8> = Vec::new();
    if image.color().has_alpha() {
        image
            .write_to(&mut Cursor::new(&mut bytes), image::ImageFormat::Png)
            .ok()?;
        Some(("png", bytes))
    } else {
        image::codecs::jpeg::JpegEncoder::new_with_quality(&mut Cursor::new(&mut bytes), 82)
            .encode_image(&image.to_rgb8())
            .ok()?;
        Some(("jpg", bytes))
    }
}

fn modified_time(path: &Path) -> Option<SystemTime> {
    fs::metadata(path).ok()?.modified().ok()
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
