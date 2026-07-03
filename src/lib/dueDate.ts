import type { Card } from "../types";

// Cards due within this many days (from today) read as "due soon" rather than
// merely "upcoming". Today (0) and tomorrow (1) are always included.
const SOON_DAYS = 3;

// Sort key for a card's due date. Cards with no due date sort last.
export function dueSortValue(card: Card): string {
  return card.due || "9999-12-31";
}

// Compare two cards by due date, breaking ties by creation time then title so
// the ordering is stable and deterministic.
export function compareCardsByDueDate(left: Card, right: Card): number {
  const dueComparison = dueSortValue(left).localeCompare(dueSortValue(right));
  if (dueComparison !== 0) {
    return dueComparison;
  }

  const createdComparison = left.createdAt.localeCompare(right.createdAt);
  if (createdComparison !== 0) {
    return createdComparison;
  }

  return left.title.localeCompare(right.title);
}

export type DueStatus = "none" | "overdue" | "today" | "soon" | "later";

export interface DueInfo {
  status: DueStatus;
  // Whole days from today to the due date: negative when overdue, 0 today,
  // positive in the future. null when the card has no due date.
  days: number | null;
  // Short label for badges, e.g. "Overdue by 2 days", "Due today", "Due
  // tomorrow", "Due in 3 days", or a short date like "Jul 15".
  label: string;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Parse a `YYYY-MM-DD` due string as a local calendar date (midnight local).
// Returns null for empty or malformed values, including impossible dates like
// 2026-02-31 that would otherwise roll over.
function parseDueDate(due: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(due.trim());
  if (!match) {
    return null;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null;
  }
  return date;
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

// Format a local date as the `YYYY-MM-DD` string an `<input type="date">` uses.
export function toDueInput(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// A `YYYY-MM-DD` string `offsetDays` from today (local), for due-date shortcuts.
export function dueInputFromToday(offsetDays: number, now: Date = new Date()): string {
  return toDueInput(new Date(now.getFullYear(), now.getMonth(), now.getDate() + offsetDays));
}

function formatShortDate(date: Date, now: Date): string {
  const options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  if (date.getFullYear() !== now.getFullYear()) {
    options.year = "numeric";
  }
  return date.toLocaleDateString(undefined, options);
}

// Classify a card's due date relative to `now` (defaults to the current time)
// into a status bucket, a day delta, and a display label.
export function describeDue(due: string, now: Date = new Date()): DueInfo {
  const dueDate = parseDueDate(due);
  if (!dueDate) {
    return { status: "none", days: null, label: "No due date" };
  }

  const today = startOfDay(now);
  const days = Math.round((dueDate.getTime() - today.getTime()) / MS_PER_DAY);

  if (days < 0) {
    const overdueBy = -days;
    return { status: "overdue", days, label: overdueBy === 1 ? "Overdue by 1 day" : `Overdue by ${overdueBy} days` };
  }
  if (days === 0) {
    return { status: "today", days, label: "Due today" };
  }
  if (days === 1) {
    return { status: "soon", days, label: "Due tomorrow" };
  }
  if (days <= SOON_DAYS) {
    return { status: "soon", days, label: `Due in ${days} days` };
  }
  return { status: "later", days, label: formatShortDate(dueDate, now) };
}

// Count active cards (not completed, not archived) that are overdue or due
// today — the "reminder" surface shown as a badge on the Due nav item.
export function dueReminderCount(cards: Card[], now: Date = new Date()): number {
  return cards.filter((card) => {
    if (card.completed || card.archived) {
      return false;
    }
    const status = describeDue(card.due, now).status;
    return status === "overdue" || status === "today";
  }).length;
}

export interface DueGroup {
  key: DueStatus;
  title: string;
  cards: Card[];
}

const DUE_GROUP_ORDER: Array<{ key: DueStatus; title: string }> = [
  { key: "overdue", title: "Overdue" },
  { key: "today", title: "Today" },
  { key: "soon", title: "Due soon" },
  { key: "later", title: "Upcoming" },
  { key: "none", title: "No due date" }
];

// Bucket cards by due status for the Due view. Each non-empty group is returned
// in overdue → upcoming → none order, with cards sorted by due date inside it.
export function groupCardsByDue(cards: Card[], now: Date = new Date()): DueGroup[] {
  const buckets: Record<DueStatus, Card[]> = { overdue: [], today: [], soon: [], later: [], none: [] };
  for (const card of cards) {
    buckets[describeDue(card.due, now).status].push(card);
  }
  return DUE_GROUP_ORDER.map(({ key, title }) => ({
    key,
    title,
    cards: buckets[key].slice().sort(compareCardsByDueDate)
  })).filter((group) => group.cards.length > 0);
}

export interface CalendarEntry {
  uid: string;
  title: string;
  // `YYYY-MM-DD`. Entries with a missing/invalid date are skipped.
  due: string;
  description?: string;
  completed?: boolean;
}

function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

// Fold a content line to 75 octets per RFC 5545 (continuation lines start with a
// single space). Uses code-unit length as a close-enough proxy for ASCII text.
function foldIcsLine(line: string): string {
  if (line.length <= 73) {
    return line;
  }
  const chunks: string[] = [];
  let remaining = line;
  chunks.push(remaining.slice(0, 73));
  remaining = remaining.slice(73);
  while (remaining.length > 72) {
    chunks.push(` ${remaining.slice(0, 72)}`);
    remaining = remaining.slice(72);
  }
  chunks.push(` ${remaining}`);
  return chunks.join("\r\n");
}

function icsAllDayStart(due: string): string {
  return due.replace(/-/g, "");
}

// All-day DTEND is exclusive, so it points at the day after the due date.
function icsAllDayEnd(due: string): string {
  const date = parseDueDate(due);
  if (!date) {
    return icsAllDayStart(due);
  }
  const next = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${next.getFullYear()}${pad(next.getMonth() + 1)}${pad(next.getDate())}`;
}

function icsTimestamp(now: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return (
    `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}` +
    `T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`
  );
}

// Build an iCalendar (.ics) document with one all-day VEVENT per entry that has
// a valid due date. Suitable for import into or subscription from any calendar
// app, keeping Limn's due dates in the same local-first, readable-file spirit.
export function buildCalendar(entries: CalendarEntry[], calendarName: string, now: Date = new Date()): string {
  const stamp = icsTimestamp(now);
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Limn//Task Board//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeIcsText(calendarName)}`
  ];

  for (const entry of entries) {
    const start = icsAllDayStart(entry.due);
    if (!/^\d{8}$/.test(start)) {
      continue;
    }
    lines.push(
      "BEGIN:VEVENT",
      `UID:${entry.uid}@limn`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${start}`,
      `DTEND;VALUE=DATE:${icsAllDayEnd(entry.due)}`,
      `SUMMARY:${escapeIcsText(`${entry.completed ? "✓ " : ""}${entry.title}`)}`
    );
    if (entry.description) {
      lines.push(`DESCRIPTION:${escapeIcsText(entry.description)}`);
    }
    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");
  return `${lines.map(foldIcsLine).join("\r\n")}\r\n`;
}
