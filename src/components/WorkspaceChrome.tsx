import type { MouseEvent as ReactMouseEvent, ReactNode } from "react";
import type { Board, BoardGroup, Member, View } from "../types";
import type { ThemeMode } from "../lib/constants";
import type { UpdateStatus } from "../lib/updateMessages";
import { countLabel, initials } from "../lib/format.js";
import { BoardNav } from "./BoardNav.js";
import { Icon, Spinner } from "./icons.js";

export interface BoardNavSections {
  grouped: Array<{ group: BoardGroup; boards: Board[] }>;
  ungrouped: Board[];
}

interface WelcomeScreenProps {
  contextMenu: ReactNode;
  // True when running outside the desktop shell (a plain browser tab), so no
  // backend exists to open a folder — the screen explains that instead of
  // offering an Open button that would silently fail.
  desktopRequired: boolean;
  error: string;
  opening: boolean;
  onContextMenu: (event: ReactMouseEvent<HTMLElement>) => void;
  onOpenWorkspace: () => void;
}

export function WelcomeScreen({
  contextMenu,
  desktopRequired,
  error,
  opening,
  onContextMenu,
  onOpenWorkspace
}: WelcomeScreenProps) {
  return (
    <main className="welcome" onContextMenu={onContextMenu}>
      <section className="welcome-panel">
        <p className="eyebrow">Limn</p>
        <h1>Local-first boards for a small trusted team.</h1>
        {desktopRequired ? (
          <>
            <p className="muted">
              Limn needs the desktop app to read and write your workspace folder — a browser tab
              can’t open one. Download and run the Limn desktop app to get started.
            </p>
            <p className="welcome-note" data-testid="welcome-desktop-required">
              Working on Limn itself? Open the dev server with the <code>?limnE2e</code> test harness
              to try the UI in a browser.
            </p>
          </>
        ) : (
          <>
            <p className="muted">Choose a folder to create or open a workspace. Limn writes boards and cards as readable files.</p>
            <button className="primary" data-testid="welcome-open-workspace" disabled={opening} onClick={onOpenWorkspace}>
              {opening ? (
                <>
                  <Spinner /> Opening…
                </>
              ) : (
                "Open workspace folder"
              )}
            </button>
          </>
        )}
        {error && <p className="error">{error}</p>}
      </section>
      {contextMenu}
    </main>
  );
}

interface WorkspaceSidebarProps {
  activeBoardId: string;
  activeMember: Member | null;
  boardGroups: BoardGroup[];
  boardNavSections: BoardNavSections;
  boards: Board[];
  dueReminders: number;
  inboxUnread: number;
  opening: boolean;
  themeMode: ThemeMode;
  view: View;
  onBoardContextMenu: (event: ReactMouseEvent<HTMLElement>, board: Board) => void;
  onCreateBoard: () => void;
  onCreateGroup: () => void;
  onGroupContextMenu: (event: ReactMouseEvent<HTMLElement>, group: BoardGroup) => void;
  onIdentityContextMenu: (event: ReactMouseEvent<HTMLElement>) => void;
  onMoveBoard: (boardId: string, groupId: string | undefined, index: number) => void;
  onOpenDueReminderFilter: () => void;
  onOpenWorkspace: () => void;
  onSelectBoard: (boardId: string) => void;
  onSetView: (view: View) => void;
  onToggleTheme: () => void;
}

export function WorkspaceSidebar({
  activeBoardId,
  activeMember,
  boardGroups,
  boardNavSections,
  boards,
  dueReminders,
  inboxUnread,
  opening,
  themeMode,
  view,
  onBoardContextMenu,
  onCreateBoard,
  onCreateGroup,
  onGroupContextMenu,
  onIdentityContextMenu,
  onMoveBoard,
  onOpenDueReminderFilter,
  onOpenWorkspace,
  onSelectBoard,
  onSetView,
  onToggleTheme
}: WorkspaceSidebarProps) {
  return (
    <aside className="sidebar">
      <button className="sidebar-action" data-testid="open-workspace" disabled={opening} onClick={onOpenWorkspace}>
        {opening ? (
          <>
            <Spinner /> Opening…
          </>
        ) : (
          <>
            <Icon name="folder" /> Open workspace
          </>
        )}
      </button>
      <BoardNav
        sections={boardNavSections}
        hasGroups={boardGroups.length > 0}
        totalBoards={boards.length}
        activeBoardId={activeBoardId}
        isBoardView={view === "board"}
        onSelectBoard={onSelectBoard}
        onMoveBoard={onMoveBoard}
        onBoardContextMenu={onBoardContextMenu}
        onGroupContextMenu={onGroupContextMenu}
        onCreateBoard={onCreateBoard}
        onCreateGroup={onCreateGroup}
      />
      <div className="sidebar-bottom">
        <button
          className="identity-select"
          data-testid="identity-select"
          title={activeMember ? `You are ${activeMember.name}. Change who you are.` : "Choose who you are to comment"}
          onClick={onIdentityContextMenu}
          onContextMenu={onIdentityContextMenu}
        >
          {activeMember ? (
            <>
              <span className="avatar small" style={{ background: activeMember.color }}>{initials(activeMember.name)}</span>
              <span className="identity-select-text">
                <span className="identity-select-label">You</span>
                <span className="identity-select-name">{activeMember.name}</span>
              </span>
            </>
          ) : (
            <>
              <Icon name="chat" />
              <span className="identity-select-text">Set who you are</span>
            </>
          )}
        </button>
        <button
          data-testid="theme-toggle"
          title={`Switch to ${themeMode === "dark" ? "light" : "dark"} mode`}
          onClick={onToggleTheme}
        >
          <Icon name={themeMode === "dark" ? "sun" : "moon"} /> {themeMode === "dark" ? "Light mode" : "Dark mode"}
        </button>
        <button
          className={view === "inbox" ? "active" : ""}
          data-testid="nav-inbox"
          onClick={() => onSetView("inbox")}
        >
          <Icon name="chat" /> Inbox
          {inboxUnread > 0 && <span className="nav-badge" data-testid="inbox-unread-count">{inboxUnread}</span>}
        </button>
        <button
          className={view === "filter" ? "active" : ""}
          data-testid="nav-filter"
          onClick={(event) => {
            const target = event.target as HTMLElement;
            if (target.closest("[data-testid='due-reminder-count']")) {
              onOpenDueReminderFilter();
              return;
            }
            onSetView("filter");
          }}
        >
          <Icon name="search" /> Filter
          {dueReminders > 0 && (
            <span
              className="nav-badge"
              data-testid="due-reminder-count"
              title={`${countLabel(dueReminders, "card")} overdue or due today. Click to filter by due date.`}
            >
              {dueReminders}
            </span>
          )}
        </button>
        <button className={view === "members" ? "active" : ""} data-testid="nav-members" onClick={() => onSetView("members")}>
          <Icon name="users" /> Members
        </button>
        <button className={view === "settings" ? "active" : ""} data-testid="nav-settings" onClick={() => onSetView("settings")}>
          <Icon name="settings" /> Settings
        </button>
      </div>
    </aside>
  );
}

interface WorkspaceBannersProps {
  cardsLoading: { loaded: number; total: number } | null;
  conflictsCount: number;
  error: string;
  notice: string;
  noticeKind: "info" | "warning";
  storageHint: string | null;
  updateBannerText: string;
  updateBannerVisible: boolean;
  updateStatus: UpdateStatus;
  onCancelCardLoad: () => void;
  onDismissMessage: () => void;
  onDismissStorageHint: () => void;
  onDismissUpdate: () => void;
  onInstallUpdate: () => void;
  onRestartAfterUpdate: () => void;
  onReviewConflicts: () => void;
}

export function WorkspaceBanners({
  cardsLoading,
  conflictsCount,
  error,
  notice,
  noticeKind,
  storageHint,
  updateBannerText,
  updateBannerVisible,
  updateStatus,
  onCancelCardLoad,
  onDismissMessage,
  onDismissStorageHint,
  onDismissUpdate,
  onInstallUpdate,
  onRestartAfterUpdate,
  onReviewConflicts
}: WorkspaceBannersProps) {
  return (
    <>
      {(error || notice) && (
        <div
          aria-live={error ? "assertive" : "polite"}
          className={`banner ${error ? "banner-error" : noticeKind === "warning" ? "banner-warning" : ""}`}
          role={error ? "alert" : "status"}
        >
          <span>{error || notice}</span>
          <button
            aria-label="Dismiss message"
            className="icon-button"
            data-testid="dismiss-banner"
            title="Dismiss"
            onClick={onDismissMessage}
          >
            <Icon name="x" />
          </button>
        </div>
      )}
      {cardsLoading && (
        <div
          aria-live="polite"
          className="banner banner-loading"
          data-testid="card-loading-banner"
          role="status"
        >
          <span className="card-loading-status">
            <Spinner />
            {cardsLoading.total > 0
              ? `Loading cards… ${Math.min(cardsLoading.loaded, cardsLoading.total)} of ${cardsLoading.total}`
              : "Loading cards…"}
          </span>
          <div className="banner-actions">
            {cardsLoading.total > 0 && (
              <div className="card-loading-track" aria-hidden="true">
                <div
                  className="card-loading-fill"
                  style={{ width: `${Math.min(100, Math.round((cardsLoading.loaded / cardsLoading.total) * 100))}%` }}
                />
              </div>
            )}
            <button data-testid="cancel-card-load" onClick={onCancelCardLoad}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {storageHint && (
        <div
          aria-live="polite"
          className="banner banner-warning"
          data-testid="cloud-storage-banner"
          role="status"
        >
          <span>
            This workspace is stored in {storageHint}. Files set to “online-only” download on first
            open, which can make Limn slow to load. For the best experience, set your sync app to keep
            this folder available offline.
          </span>
          <div className="banner-actions">
            <button data-testid="dismiss-cloud-banner" onClick={onDismissStorageHint}>
              Got it
            </button>
          </div>
        </div>
      )}
      {updateBannerVisible && (
        <div
          aria-live={updateStatus === "error" ? "assertive" : "polite"}
          className={`banner ${updateStatus === "error" ? "banner-error" : "banner-warning"}`}
          data-testid="update-banner"
          role={updateStatus === "error" ? "alert" : "status"}
        >
          <span>{updateBannerText}</span>
          <div className="banner-actions">
            {updateStatus === "available" && (
              <button data-testid="install-update" onClick={onInstallUpdate}>
                Install update
              </button>
            )}
            {updateStatus === "restart-ready" && (
              <button data-testid="restart-update" onClick={onRestartAfterUpdate}>
                Restart Limn
              </button>
            )}
            <button
              aria-label="Dismiss update message"
              className="icon-button"
              data-testid="dismiss-update-banner"
              title="Dismiss"
              onClick={onDismissUpdate}
            >
              <Icon name="x" />
            </button>
          </div>
        </div>
      )}
      {conflictsCount > 0 && (
        <div
          aria-live="polite"
          className="banner banner-warning"
          data-testid="conflict-banner"
          role="status"
        >
          <span>
            {countLabel(conflictsCount, "unresolved conflict")} — a copy was preserved when an edit
            couldn't be reconciled automatically.
          </span>
          <div className="banner-actions">
            <button data-testid="review-conflicts" onClick={onReviewConflicts}>
              Review conflicts
            </button>
          </div>
        </div>
      )}
    </>
  );
}
