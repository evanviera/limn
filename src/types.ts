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
