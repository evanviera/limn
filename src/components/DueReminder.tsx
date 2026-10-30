import { countLabel } from "../lib/format.js";
import { Icon } from "./icons.js";

export function DueReminder({ count, onReview }: { count: number; onReview: () => void }) {
  if (count === 0) return null;
  return (
    <button type="button" className="due-reminder" data-testid="board-due-reminder" onClick={onReview}>
      <Icon name="calendar" />
      <span>{countLabel(count, "card")} assigned to you due or overdue</span>
      <span className="due-reminder-action">Review</span>
    </button>
  );
}
