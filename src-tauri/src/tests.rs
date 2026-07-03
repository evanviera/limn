use super::*;
use std::{
    io::{Read, Write},
    net::TcpListener,
    thread,
};

#[test]
fn workspace_init_and_load_creates_expected_layout() {
    let root = test_workspace("init_and_load");
    let path = root.to_string_lossy().to_string();

    init_workspace(path.clone()).expect("workspace initializes");
    let files = load_workspace(path).expect("workspace loads");

    assert!(root.join(".workspace/settings.json").exists());
    assert!(root.join(".workspace/members.json").exists());
    assert!(root.join("boards").exists());
    assert!(root.join("cards").exists());
    assert!(files.settings.contains("schemaVersion"));
    assert!(files.members.contains("\"members\""));

    let _ = fs::remove_dir_all(root);
}

#[test]
fn card_write_uses_conflict_copy_when_updated_at_changed() {
    let root = test_workspace("conflict_copy");
    let path = root.to_string_lossy().to_string();
    init_workspace(path.clone()).expect("workspace initializes");

    let original = card_markdown("card_test", "2026-06-27T00:00:00.000Z", "Original");
    write_card_file(path.clone(), "card_test.md".to_string(), original, None).expect("card writes");

    let changed = card_markdown("card_test", "2026-06-27T01:00:00.000Z", "Changed elsewhere");
    write_card_file(
        path.clone(),
        "card_test.md".to_string(),
        changed,
        Some("2026-06-27T00:00:00.000Z".to_string()),
    )
    .expect("second card write succeeds");

    let conflict = card_markdown("card_test", "2026-06-27T02:00:00.000Z", "User edit");
    let result = write_card_file(
        path,
        "card_test.md".to_string(),
        conflict,
        Some("2026-06-27T00:00:00.000Z".to_string()),
    )
    .expect("conflict card writes");

    assert!(result.conflict);
    assert!(result
        .relative_path
        .starts_with("cards/card_test_conflict_"));

    let (card_files, warnings) = read_text_dir(&root.join("cards"), "md").expect("cards load");
    assert_eq!(card_files.len(), 2);
    assert!(warnings.is_empty());

    let _ = fs::remove_dir_all(root);
}

#[test]
fn repeated_conflicts_get_distinct_copy_names() {
    let root = test_workspace("conflict_copy_names");
    let path = root.to_string_lossy().to_string();
    init_workspace(path.clone()).expect("workspace initializes");

    let original = card_markdown("card_test", "2026-06-27T00:00:00.000Z", "Original");
    write_card_file(path.clone(), "card_test.md".to_string(), original, None).expect("card writes");

    let changed = card_markdown("card_test", "2026-06-27T01:00:00.000Z", "Changed elsewhere");
    write_card_file(
        path.clone(),
        "card_test.md".to_string(),
        changed,
        Some("2026-06-27T00:00:00.000Z".to_string()),
    )
    .expect("second card write succeeds");

    let first = write_card_file(
        path.clone(),
        "card_test.md".to_string(),
        card_markdown("card_test", "2026-06-27T02:00:00.000Z", "User edit 1"),
        Some("2026-06-27T00:00:00.000Z".to_string()),
    )
    .expect("first conflict writes");
    let second = write_card_file(
        path,
        "card_test.md".to_string(),
        card_markdown("card_test", "2026-06-27T03:00:00.000Z", "User edit 2"),
        Some("2026-06-27T00:00:00.000Z".to_string()),
    )
    .expect("second conflict writes");

    assert_ne!(first.relative_path, second.relative_path);
    let (card_files, warnings) = read_text_dir(&root.join("cards"), "md").expect("cards load");
    assert_eq!(card_files.len(), 3);
    assert!(warnings.is_empty());

    let _ = fs::remove_dir_all(root);
}

#[test]
fn unreadable_text_files_are_reported_without_failing_workspace_load() {
    let root = test_workspace("invalid_utf8");
    let path = root.to_string_lossy().to_string();
    init_workspace(path.clone()).expect("workspace initializes");
    fs::write(root.join("cards/bad.md"), [0xff, 0xfe]).expect("invalid card writes");

    let files = load_workspace(path).expect("workspace loads");

    assert!(files.cards.is_empty());
    assert_eq!(files.warnings.len(), 1);
    assert!(files.warnings[0].contains("bad.md could not be read"));

    let _ = fs::remove_dir_all(root);
}

#[test]
fn attachments_are_copied_and_deleted_with_their_card() {
    let root = test_workspace("attachments");
    let path = root.to_string_lossy().to_string();
    init_workspace(path.clone()).expect("workspace initializes");

    let source = root.join("source.txt");
    fs::write(&source, b"hello attachment").expect("source writes");

    let size = add_attachment(
        path.clone(),
        "card_att".to_string(),
        "att_1-source.txt".to_string(),
        source.to_string_lossy().to_string(),
    )
    .expect("attachment copies");
    assert_eq!(size, 16);

    let stored = root.join("attachments/card_att/att_1-source.txt");
    assert!(stored.exists());
    assert_eq!(
        fs::read(&stored).expect("stored reads"),
        b"hello attachment"
    );

    write_card_file(
        path.clone(),
        "card_att.md".to_string(),
        card_markdown("card_att", "2026-06-27T00:00:00.000Z", "Body"),
        None,
    )
    .expect("card writes");
    delete_card_file(path.clone(), "card_att.md".to_string()).expect("card deletes");
    assert!(!root.join("attachments/card_att").exists());

    let _ = fs::remove_dir_all(root);
}

#[test]
fn delete_attachment_removes_file_and_empty_folder() {
    let root = test_workspace("attachment_delete");
    let path = root.to_string_lossy().to_string();
    init_workspace(path.clone()).expect("workspace initializes");

    let source = root.join("logo.png");
    fs::write(&source, b"png-bytes").expect("source writes");
    add_attachment(
        path.clone(),
        "card_x".to_string(),
        "att_2-logo.png".to_string(),
        source.to_string_lossy().to_string(),
    )
    .expect("attachment copies");

    delete_attachment(
        path.clone(),
        "card_x".to_string(),
        "att_2-logo.png".to_string(),
    )
    .expect("attachment deletes");
    assert!(!root.join("attachments/card_x/att_2-logo.png").exists());
    assert!(!root.join("attachments/card_x").exists());

    let _ = fs::remove_dir_all(root);
}

#[test]
fn image_attachment_preview_reads_only_supported_images() {
    let root = test_workspace("attachment_preview");
    let path = root.to_string_lossy().to_string();
    init_workspace(path.clone()).expect("workspace initializes");

    let source = root.join("logo.png");
    fs::write(&source, b"png-bytes").expect("source writes");
    add_attachment(
        path.clone(),
        "card_x".to_string(),
        "att_2-logo.png".to_string(),
        source.to_string_lossy().to_string(),
    )
    .expect("attachment copies");

    let preview = read_attachment_preview(
        path.clone(),
        "card_x".to_string(),
        "att_2-logo.png".to_string(),
    )
    .expect("image preview reads");
    assert_eq!(preview.mime_type, "image/png");
    assert_eq!(preview.bytes, b"png-bytes");

    let source = root.join("notes.txt");
    fs::write(&source, b"text").expect("source writes");
    add_attachment(
        path.clone(),
        "card_x".to_string(),
        "att_3-notes.txt".to_string(),
        source.to_string_lossy().to_string(),
    )
    .expect("attachment copies");
    let unsupported = read_attachment_preview(
        path.clone(),
        "card_x".to_string(),
        "att_3-notes.txt".to_string(),
    )
    .expect_err("text preview rejected");
    assert!(unsupported.contains("supported image"));

    let _ = fs::remove_dir_all(root);
}

#[test]
fn attachment_commands_reject_path_traversal() {
    let root = test_workspace("attachment_traversal");
    let path = root.to_string_lossy().to_string();
    init_workspace(path.clone()).expect("workspace initializes");

    let source = root.join("data.bin");
    fs::write(&source, b"x").expect("source writes");
    let source_path = source.to_string_lossy().to_string();

    let bad_card = add_attachment(
        path.clone(),
        "..".to_string(),
        "att.bin".to_string(),
        source_path.clone(),
    )
    .expect_err("traversal card id rejected");
    assert!(bad_card.contains("Invalid attachment path"));

    let bad_name = add_attachment(
        path,
        "card_ok".to_string(),
        "../escape.bin".to_string(),
        source_path,
    )
    .expect_err("traversal stored name rejected");
    assert!(bad_name.contains("Invalid attachment path"));

    let _ = fs::remove_dir_all(root);
}

#[test]
fn export_calendar_writes_ics_into_exports_folder() {
    let root = test_workspace("export_calendar");
    let path = root.to_string_lossy().to_string();
    init_workspace(path.clone()).expect("workspace initializes");

    let ics = "BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n".to_string();
    let relative = export_calendar(path, ics.clone()).expect("calendar exports");
    assert_eq!(relative, "exports/limn-due-dates.ics");

    let written = root.join("exports/limn-due-dates.ics");
    assert!(written.exists());
    assert_eq!(fs::read_to_string(&written).expect("ics reads"), ics);

    let _ = fs::remove_dir_all(root);
}

#[tokio::test]
async fn post_slack_sends_expected_payload() {
    let server = TestHttpServer::start(200, "ok");
    post_slack(server.url(), "Task completed: Demo".to_string())
        .await
        .expect("slack post succeeds");

    let request = server.request();
    assert!(request.contains("POST / HTTP/1.1"));
    assert!(request.contains(r#""text":"Task completed: Demo""#));
}

#[tokio::test]
async fn post_slack_reports_non_success_status() {
    let server = TestHttpServer::start(500, "nope");
    let error = post_slack(server.url(), "Task completed: Demo".to_string())
        .await
        .expect_err("slack post fails");

    assert!(error.contains("Slack webhook returned 500"));
    assert!(server
        .request()
        .contains(r#""text":"Task completed: Demo""#));
}

fn test_workspace(name: &str) -> PathBuf {
    let root = std::env::temp_dir().join(format!(
        "limn_{name}_{}",
        chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default()
    ));
    let _ = fs::remove_dir_all(&root);
    root
}

fn card_markdown(id: &str, updated_at: &str, body: &str) -> String {
    format!(
        "---\nid: {id}\ntitle: Test card\nboardId: board_main\nlistId: todo\nassignees: []\nlabels: []\ndue: \ncompleted: false\narchived: false\ncreatedAt: 2026-06-27T00:00:00.000Z\nupdatedAt: {updated_at}\nactivity: []\n---\n{body}\n"
    )
}

struct TestHttpServer {
    address: String,
    handle: thread::JoinHandle<String>,
}

impl TestHttpServer {
    fn start(status: u16, body: &'static str) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").expect("test server binds");
        let address = listener
            .local_addr()
            .expect("test server address")
            .to_string();
        let handle = thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("test server accepts request");
            let mut request = Vec::new();
            let mut buffer = [0_u8; 4096];
            loop {
                let read = stream.read(&mut buffer).expect("request reads");
                if read == 0 {
                    break;
                }
                request.extend_from_slice(&buffer[..read]);
                if request.windows(4).any(|window| window == b"\r\n\r\n") {
                    let text = String::from_utf8_lossy(&request);
                    let content_length = text
                        .lines()
                        .find_map(|line| line.strip_prefix("content-length: "))
                        .or_else(|| {
                            text.lines()
                                .find_map(|line| line.strip_prefix("Content-Length: "))
                        })
                        .and_then(|value| value.trim().parse::<usize>().ok())
                        .unwrap_or(0);
                    let header_len = request
                        .windows(4)
                        .position(|window| window == b"\r\n\r\n")
                        .map(|index| index + 4)
                        .unwrap_or(request.len());
                    if request.len() >= header_len + content_length {
                        break;
                    }
                }
            }

            let response = format!(
                "HTTP/1.1 {status} OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            );
            stream
                .write_all(response.as_bytes())
                .expect("test response writes");
            String::from_utf8_lossy(&request).to_string()
        });

        Self { address, handle }
    }

    fn url(&self) -> String {
        format!("http://{}", self.address)
    }

    fn request(self) -> String {
        self.handle.join().expect("test server joins")
    }
}
