// Pure helpers for the Slack "card moved to list" notification. The set of lists
// that should trigger a notification is stored as a single comma-separated string
// (WorkspaceSettings.slackMovedToListNames) so it survives folder sync as plain
// text; these helpers turn it into a match test. Names are compared trimmed and
// case-insensitively, and blank entries are ignored.

// Split the comma-separated config into normalized, de-duplicated list names.
export function parseMovedToListNames(raw: string): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const part of raw.split(",")) {
    const name = part.trim().toLowerCase();
    if (name && !seen.has(name)) {
      seen.add(name);
      names.push(name);
    }
  }
  return names;
}

// True when moving a card into a list named `listName` should notify Slack.
export function listNameTriggersMoveNotification(listName: string, raw: string): boolean {
  const target = listName.trim().toLowerCase();
  if (!target) {
    return false;
  }
  return parseMovedToListNames(raw).includes(target);
}
