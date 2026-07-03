export type View = "board" | "members" | "settings";

export interface WorkspaceSettings {
  schemaVersion: number;
  workspaceName: string;
  slackWebhookUrl: string;
  slackNotifications: SlackNotificationSettings;
  boardGroups: BoardGroup[];
  createdAt: string;
  updatedAt: string;
}

export interface SlackNotificationSettings {
  cardMovedToDone: boolean;
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
}

export interface BoardList {
  id: string;
  name: string;
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

export interface AttachmentPreviewData {
  mimeType: string;
  bytes: number[];
}

export interface Card {
  id: string;
  title: string;
  boardId: string;
  listId: string;
  assignees: string[];
  labels: string[];
  due: string;
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
}
