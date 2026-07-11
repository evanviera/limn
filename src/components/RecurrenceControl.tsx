import type { Dispatch, SetStateAction } from "react";
import type { Card, RecurrenceUnit } from "../types";
import { parseLocalDate, recurrenceValidation } from "../lib/recurrence.js";

export function RecurrenceControl({ draft, setDraft }: { draft: Card; setDraft: Dispatch<SetStateAction<Card>> }) {
  const error = recurrenceValidation(draft.recurrence, draft.due);
  const enabled = Boolean(draft.recurrence);
  const update = (interval: number, unit: RecurrenceUnit) => {
    const anchorDay = unit === "month" ? (draft.recurrence?.anchorDay ?? parseLocalDate(draft.due)?.day) : undefined;
    setDraft({ ...draft, recurrence: { interval, unit, ...(anchorDay ? { anchorDay } : {}) } });
  };
  return (
    <div className="recurrence-control" data-testid="recurrence-control">
      <label className="side-field side-field-select">
        <span>Repeat</span>
        <select
          data-testid="recurrence-mode"
          value={enabled ? "interval" : "none"}
          onChange={(event) => event.target.value === "none"
            ? setDraft({ ...draft, recurrence: undefined, recurrenceNextId: undefined })
            : update(1, "day")}
        >
          <option value="none">Non-repeating</option>
          <option value="interval">Every interval</option>
        </select>
      </label>
      {draft.recurrence && (
        <div className="recurrence-interval">
          <span>Every</span>
          <input
            aria-label="Repeat interval"
            data-testid="recurrence-interval"
            min="1"
            step="1"
            type="number"
            value={Number.isNaN(draft.recurrence.interval) ? "" : draft.recurrence.interval}
            onChange={(event) => update(event.target.valueAsNumber, draft.recurrence!.unit)}
          />
          <select
            aria-label="Repeat unit"
            data-testid="recurrence-unit"
            value={draft.recurrence.unit}
            onChange={(event) => update(draft.recurrence!.interval, event.target.value as RecurrenceUnit)}
          >
            <option value="day">day(s)</option>
            <option value="week">week(s)</option>
            <option value="month">month(s)</option>
          </select>
        </div>
      )}
      {draft.recurrence && <p className="recurrence-help">The next task is created when this one is completed.</p>}
      {error && <p className="field-error" data-testid="recurrence-error" role="alert">{error}</p>}
    </div>
  );
}
