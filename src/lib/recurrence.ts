import type { Card, RecurrenceRule, RecurrenceUnit, Subtask } from "../types";

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export function parseLocalDate(value: string): { year: number; month: number; day: number } | null {
  const match = DATE_PATTERN.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
    ? { year, month, day }
    : null;
}

function formatDate(date: Date): string {
  return `${date.getFullYear().toString().padStart(4, "0")}-${(date.getMonth() + 1).toString().padStart(2, "0")}-${date.getDate().toString().padStart(2, "0")}`;
}

function addInterval(due: string, rule: RecurrenceRule): string {
  const parsed = parseLocalDate(due);
  if (!parsed) return due;
  if (rule.unit !== "month") {
    const date = new Date(parsed.year, parsed.month - 1, parsed.day);
    date.setDate(date.getDate() + rule.interval * (rule.unit === "week" ? 7 : 1));
    return formatDate(date);
  }
  const targetMonth = parsed.month - 1 + rule.interval;
  const targetYear = parsed.year + Math.floor(targetMonth / 12);
  const normalizedMonth = ((targetMonth % 12) + 12) % 12;
  const lastDay = new Date(targetYear, normalizedMonth + 1, 0).getDate();
  return formatDate(new Date(targetYear, normalizedMonth, Math.min(rule.anchorDay ?? parsed.day, lastDay)));
}

export function recurrenceValidation(rule: RecurrenceRule | undefined, due: string): string | null {
  if (!rule) return null;
  if (!Number.isInteger(rule.interval) || rule.interval <= 0) return "Interval must be a positive whole number.";
  if (!(rule.unit === "day" || rule.unit === "week" || rule.unit === "month")) return "Choose days, weeks, or months.";
  if (!parseLocalDate(due)) return "A recurrence rule requires a due date.";
  return null;
}

export function normalizeRecurrence(value: unknown, due: string): RecurrenceRule | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as { interval?: unknown; unit?: unknown; anchorDay?: unknown };
  const rule: RecurrenceRule = {
    interval: typeof raw.interval === "number" ? raw.interval : Number.NaN,
    unit: raw.unit as RecurrenceUnit,
    ...(typeof raw.anchorDay === "number" ? { anchorDay: raw.anchorDay } : {})
  };
  if (recurrenceValidation(rule, due)) return undefined;
  return rule.unit === "month" ? { ...rule, anchorDay: rule.anchorDay ?? parseLocalDate(due)!.day } : rule;
}

export function nextRecurrenceDate(due: string, rule: RecurrenceRule, today: string): string {
  let next = addInterval(due, rule);
  while (next <= today) next = addInterval(next, rule);
  return next;
}

export function recurrenceSummary(rule: RecurrenceRule): string {
  const unit = rule.interval === 1 ? rule.unit : `${rule.unit}s`;
  return `Every ${rule.interval} ${unit}`;
}

function resetSubtasks(subtasks: Subtask[]): Subtask[] {
  return subtasks.map((subtask) => ({ ...subtask, completed: false, items: subtask.items.map((item) => ({ ...item })) }));
}

export function buildRecurringSuccessor(source: Card, today: string, now: string): Card | null {
  if (!source.recurrence || !source.recurrenceNextId || recurrenceValidation(source.recurrence, source.due)) return null;
  const id = source.recurrenceNextId;
  return {
    id,
    title: source.title,
    boardId: source.boardId,
    listId: source.listId,
    assignees: [...source.assignees],
    labels: [...source.labels],
    due: nextRecurrenceDate(source.due, source.recurrence, today),
    recurrence: { ...source.recurrence },
    recurrenceSourceId: source.id,
    order: source.order,
    completed: false,
    archived: false,
    createdAt: now,
    updatedAt: now,
    activity: [{ id: `activity_${id}`, type: "created", message: "Created recurring card", createdAt: now }],
    subtasks: resetSubtasks(source.subtasks),
    attachments: [],
    comments: [],
    body: source.body,
    fileName: `${id}.md`
  };
}

export function localToday(date = new Date()): string {
  return formatDate(date);
}
