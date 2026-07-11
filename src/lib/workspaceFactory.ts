import type { Board, Card, Comment, SlackNotificationSettings, WorkspaceSettings } from "../types";

export const SCHEMA_VERSION = 1;

export const DEFAULT_SLACK_NOTIFICATIONS: SlackNotificationSettings = {
  cardCompleted: true,
  cardAssigned: true,
  subtaskCompleted: true
};

// New boards ship with a "Done" list, so defaulting the move-notification
// targets to "Done" preserves the historical out-of-box behavior.
export const DEFAULT_MOVED_TO_LIST_NAMES = "Done";

export function createDefaultSettings(workspaceName: string): WorkspaceSettings {
  const now = timestamp();
  return {
    schemaVersion: SCHEMA_VERSION,
    workspaceName,
    slackWebhookUrl: "",
    slackMovedToListNames: DEFAULT_MOVED_TO_LIST_NAMES,
    slackNotifications: { ...DEFAULT_SLACK_NOTIFICATIONS },
    boardGroups: [],
    savedViews: [],
    createdAt: now,
    updatedAt: now
  };
}

export function createBoard(name: string): Board {
  const now = timestamp();
  const id = makeId("board");
  return {
    schemaVersion: SCHEMA_VERSION,
    id,
    name,
    order: 0,
    lists: [
      { id: "todo", name: "To Do" },
      { id: "in-progress", name: "In Progress" },
      { id: "done", name: "Done" }
    ],
    createdAt: now,
    updatedAt: now
  };
}

export function createCard(boardId: string, listId: string, title: string): Card {
  const now = timestamp();
  const id = makeId("card");
  return {
    id,
    title,
    boardId,
    listId,
    assignees: [],
    labels: [],
    due: "",
    order: 0,
    completed: false,
    archived: false,
    createdAt: now,
    updatedAt: now,
    activity: [
      {
        id: makeId("activity"),
        type: "created",
        message: "Created card",
        createdAt: now
      }
    ],
    subtasks: [],
    attachments: [],
    comments: [],
    body: "",
    fileName: `${id}.md`
  };
}

// Build a discussion comment. The author's display name is snapshotted here so a
// later member rename/removal doesn't orphan the comment's attribution.
export function createComment(authorId: string, authorName: string, body: string): Comment {
  return {
    id: makeId("comment"),
    authorId,
    authorName,
    body,
    createdAt: timestamp()
  };
}

export function cardFileName(id: string): string {
  return `${id}.md`;
}

export function boardFileName(id: string): string {
  return `${id}.json`;
}

export function makeId(prefix: string): string {
  const random = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}${random}`;
}

export function timestamp(): string {
  return new Date().toISOString();
}

export function addActivity(card: Card, type: Card["activity"][number]["type"], message: string): Card {
  const now = timestamp();
  return {
    ...card,
    updatedAt: now,
    activity: [
      {
        id: makeId("activity"),
        type,
        message,
        createdAt: now
      },
      ...card.activity
    ]
  };
}
