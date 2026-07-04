use tauri::{
    menu::{
        AboutMetadataBuilder, Menu, MenuItem, MenuItemBuilder, PredefinedMenuItem, Submenu,
        SubmenuBuilder, HELP_SUBMENU_ID, WINDOW_SUBMENU_ID,
    },
    AppHandle,
};

pub(crate) fn build_app_menu(app: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let about = AboutMetadataBuilder::new()
        .name(Some("Limn"))
        .version(Some(env!("CARGO_PKG_VERSION")))
        .comments(Some("Local-first task boards"))
        .authors(Some(vec!["Limn".to_string()]))
        .build();

    let app_menu = Submenu::with_items(
        app,
        "Limn",
        true,
        &[
            &PredefinedMenuItem::about(app, Some("About Limn"), Some(about))?,
            &PredefinedMenuItem::separator(app)?,
            &item(
                app,
                "limn:show-settings",
                "Settings...",
                Some("CmdOrCtrl+,"),
            )?,
            &item(
                app,
                "limn:check-updates",
                "Check for Updates...",
                Some("CmdOrCtrl+Shift+U"),
            )?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::services(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::hide(app, None)?,
            &PredefinedMenuItem::hide_others(app, None)?,
            &PredefinedMenuItem::show_all(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::quit(app, None)?,
        ],
    )?;

    let file_menu = Submenu::with_items(
        app,
        "File",
        true,
        &[
            &item(
                app,
                "limn:open-workspace",
                "Open Workspace...",
                Some("CmdOrCtrl+O"),
            )?,
            &item(
                app,
                "limn:open-workspace-folder",
                "Show Workspace Folder",
                Some("CmdOrCtrl+Shift+O"),
            )?,
            &item(
                app,
                "limn:reload-workspace",
                "Reload Workspace",
                Some("CmdOrCtrl+R"),
            )?,
            &PredefinedMenuItem::separator(app)?,
            &item(app, "limn:new-board", "New Board", Some("CmdOrCtrl+N"))?,
            &item(app, "limn:new-card", "New Card", Some("CmdOrCtrl+Shift+N"))?,
            &item(app, "limn:save-card", "Save Card", Some("CmdOrCtrl+S"))?,
            &item(app, "limn:close-card", "Close Card", Some("Esc"))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::close_window(app, None)?,
        ],
    )?;

    let edit_menu = Submenu::with_items(
        app,
        "Edit",
        true,
        &[
            &PredefinedMenuItem::undo(app, None)?,
            &PredefinedMenuItem::redo(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, None)?,
            &PredefinedMenuItem::copy(app, None)?,
            &PredefinedMenuItem::paste(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::select_all(app, None)?,
        ],
    )?;

    let view_menu = Submenu::with_items(
        app,
        "View",
        true,
        &[
            &item(app, "limn:show-board", "Show Board", Some("CmdOrCtrl+1"))?,
            &item(app, "limn:show-filter", "Filter Cards", Some("CmdOrCtrl+F"))?,
            &item(
                app,
                "limn:show-members",
                "Show Members",
                Some("CmdOrCtrl+2"),
            )?,
            &item(
                app,
                "limn:show-settings",
                "Show Settings",
                Some("CmdOrCtrl+3"),
            )?,
            &PredefinedMenuItem::separator(app)?,
            &item(
                app,
                "limn:toggle-theme",
                "Toggle Light/Dark Mode",
                Some("CmdOrCtrl+Shift+L"),
            )?,
            &PredefinedMenuItem::fullscreen(app, None)?,
        ],
    )?;

    let board_menu = Submenu::with_items(
        app,
        "Board",
        true,
        &[
            &item(app, "limn:new-board", "New Board", Some("CmdOrCtrl+N"))?,
            &item(
                app,
                "limn:rename-board",
                "Rename Board",
                Some("CmdOrCtrl+Shift+R"),
            )?,
            &item(app, "limn:delete-board", "Delete Board", None)?,
            &PredefinedMenuItem::separator(app)?,
            &item(app, "limn:add-list", "Add List", Some("CmdOrCtrl+L"))?,
        ],
    )?;

    let card_menu = Submenu::with_items(
        app,
        "Card",
        true,
        &[
            &item(app, "limn:new-card", "New Card", Some("CmdOrCtrl+Shift+N"))?,
            &item(app, "limn:save-card", "Save Card", Some("CmdOrCtrl+S"))?,
            &item(app, "limn:close-card", "Close Card", Some("Esc"))?,
            &PredefinedMenuItem::separator(app)?,
            &item(
                app,
                "limn:toggle-card-completed",
                "Toggle Complete",
                Some("CmdOrCtrl+Enter"),
            )?,
            &item(
                app,
                "limn:archive-card",
                "Archive Card",
                Some("CmdOrCtrl+Backspace"),
            )?,
            &item(app, "limn:delete-card", "Delete Card", None)?,
        ],
    )?;

    let window_menu = SubmenuBuilder::with_id(app, WINDOW_SUBMENU_ID, "Window")
        .minimize()
        .maximize()
        .separator()
        .close_window()
        .build()?;

    let help_menu = SubmenuBuilder::with_id(app, HELP_SUBMENU_ID, "Help")
        .item(&item(
            app,
            "limn:show-help",
            "Limn Help",
            Some("CmdOrCtrl+?"),
        )?)
        .item(&item(
            app,
            "limn:check-updates",
            "Check for Updates...",
            None,
        )?)
        .build()?;

    Menu::with_items(
        app,
        &[
            &app_menu,
            &file_menu,
            &edit_menu,
            &view_menu,
            &board_menu,
            &card_menu,
            &window_menu,
            &help_menu,
        ],
    )
}

fn item(
    app: &AppHandle,
    id: &str,
    text: &str,
    accelerator: Option<&str>,
) -> tauri::Result<MenuItem<tauri::Wry>> {
    let mut builder = MenuItemBuilder::with_id(id, text);
    if let Some(accelerator) = accelerator {
        builder = builder.accelerator(accelerator);
    }
    builder.build(app)
}
