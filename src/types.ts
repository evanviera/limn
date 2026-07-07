export type View = "board" | "filter" | "members" | "settings";

// One open workspace tab: its folder path plus a display name (the workspace's
// configured name once loaded, otherwise the folder's base name).
export interface OpenWorkspaceRef {
  path: string;
  name: string;
}

// The persisted set of open workspace tabs and which one is active, as returned
// by the `get_open_workspaces` command.
export interface OpenWorkspacesState {
  active: string | null;
  paths: string[];
}

export interface WorkspaceSettings {
  schemaVersion: number;
  workspaceName: string;
  slackWebhookUrl: string;
  // Comma-separated list names that trigger a "card moved to list" Slack
  // notification. Matched case-insensitively against the destination list's
  // name; empty means no move notifications are sent. Lists are user-named, so
  // this is configurable rather than hard-coded to a "Done" column.
  slackMovedToListNames: string;
  slackNotifications: SlackNotificationSettings;
  boardGroups: BoardGroup[];
  savedViews: SavedView[];
  createdAt: string;
  updatedAt: string;
}

// Which due-date window a filter is scoped to. Semantics are day-delta based;
// see lib/filter.ts.
export type DueFilterKind = "any" | "overdue" | "today" | "soon" | "later" | "has" | "none";

export type CompletionFilter = "active" | "completed" | "any";

export type ArchivedFilter = "active" | "archived" | "any";

export type FilterSort = "updated" | "created" | "due" | "title";

// A card query: free text plus structured facets and a sort. Fully serializable
// so it can be persisted as a named SavedView in the workspace settings.
export interface CardFilter {
  // Free text; whitespace-separated terms are AND-matched against title, notes,
  // and labels.
  text: string;
  // "" = every board.
  boardId: string;
  // Member ids to match (a card matches if assigned to ANY of them). The
  // UNASSIGNED_ASSIGNEE sentinel additionally matches cards with no assignee.
  assignees: string[];
  // Label names to match (a card matches if it carries ANY of them).
  labels: string[];
  due: DueFilterKind;
  completion: CompletionFilter;
  archived: ArchivedFilter;
  sort: FilterSort;
}

// A named, reusable card query. Stored in the workspace settings so it is
// folder-synced and shared by everyone on the workspace.
export interface SavedView {
  id: string;
  name: string;
  filter: CardFilter;
  createdAt: string;
  updatedAt: string;
}

export interface SlackNotificationSettings {
  cardCompleted: boolean;
  cardAssigned: boolean;
  subtaskCompleted: boolean;
}

export interface BoardGroup {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface Member {
  id: string;
  name: string;
  color: string;
  slackHandle?: string;
}

export interface MembersFile {
  schemaVersion: number;
  members: Member[];
  // Optimistic-concurrency token for conflict-aware writes. Older members.json
  // files predate this field; the loader defaults it so the first save stamps it.
  updatedAt: string;
}

export interface BoardList {
  id: string;
  name: string;
  // When true the list is rendered as a narrow rail to save horizontal space.
  collapsed?: boolean;
}

export interface Board {
  schemaVersion: number;
  id: string;
  name: string;
  groupId?: string;
  lists: BoardList[];
  createdAt: string;
  updatedAt: string;
}

export interface ActivityEvent {
  id: string;
  type: "created" | "updated" | "moved" | "assigned" | "completed" | "archived";
  message: string;
  createdAt: string;
}

export interface SubtaskListItem {
  id: string;
  text: string;
  url: string;
}

export interface Subtask {
  id: string;
  title: string;
  completed: boolean;
  url: string;
  items: SubtaskListItem[];
}

export interface Comment {
  id: string;
  // Member id of the author. May reference a member that was later removed; the
  // stored authorName keeps the comment readable when that happens.
  authorId: string;
  // Snapshot of the author's display name at post time so the discussion stays
  // attributable even after a member is renamed or removed.
  authorName: string;
  body: string;
  createdAt: string;
  // Set only when the comment has been edited after posting.
  editedAt?: string;
}

export interface Attachment {
  id: string;
  // Original file name, shown to the user.
  name: string;
  // File name on disk under attachments/<cardId>/. Sanitized + id-prefixed so it
  // is collision-free and safe to join onto a path.
  storedName: string;
  // Size in bytes, as reported by the copy that placed the file in the workspace.
  size: number;
  addedAt: string;
}

export interface Card {
  id: string;
  title: string;
  boardId: string;
  listId: string;
  assignees: string[];
  labels: string[];
  due: string;
  // Manual sort position within a list. Cards sort by this value ascending, with
  // due date as the tiebreaker. A shared value of 0 means "unordered": such a
  // list falls back to pure due-date sorting until a card is dragged to reorder.
  order: number;
  completed: boolean;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
  activity: ActivityEvent[];
  subtasks: Subtask[];
  attachments: Attachment[];
  comments: Comment[];
  body: string;
  fileName: string;
}

export interface WorkspaceFiles {
  settings: string;
  members: string;
  boards: Array<{ file_name: string; content: string }>;
  cards: Array<{ file_name: string; content: string }>;
  warnings: string[];
}

export interface WriteResult {
  relative_path: string;
  conflict: boolean;
  // On conflict: the current on-disk content to three-way-merge against, or null
  // when the file was deleted remotely. Absent/null on a clean write.
  current_content?: string | null;
}

export interface DeleteResult {
  conflict: boolean;
  // Present only on a conflict: the workspace-relative path where the current
  // on-disk version was preserved instead of being deleted.
  copy_path?: string | null;
}

// A preserved conflict artifact (a `_conflict_` copy under cards/ or
// .workspace/conflicts/) as enumerated by the `list_conflicts` command.
export interface ConflictFile {
  relative_path: string;
  file_name: string;
  content: string;
}
