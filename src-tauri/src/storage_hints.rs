// Recognize when a workspace path lives inside a known cloud-sync folder so the
// UI can warn that "online-only" files may load slowly. This is a pure,
// filesystem-free heuristic on the path string (matched case-insensitively);
// modern macOS mounts Dropbox/Drive/OneDrive/Box under ~/Library/CloudStorage,
// which the first pattern catches generically.
pub(crate) fn cloud_storage_hint(path: &str) -> Option<String> {
    let lower = path.replace('\\', "/").to_lowercase();
    let providers: [(&str, &str); 11] = [
        ("com~apple~clouddocs", "iCloud Drive"),
        ("/mobile documents/", "iCloud Drive"),
        ("dropbox", "Dropbox"),
        ("google drive", "Google Drive"),
        ("googledrive", "Google Drive"),
        ("google_drive", "Google Drive"),
        ("onedrive", "OneDrive"),
        ("/box/", "Box"),
        ("boxdrive", "Box"),
        ("pcloud", "pCloud"),
        ("/library/cloudstorage/", "a cloud storage folder"),
    ];
    for (needle, label) in providers {
        if lower.contains(needle) {
            return Some(label.to_string());
        }
    }
    None
}
