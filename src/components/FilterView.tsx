import { useEffect, useMemo, useState } from "react";
import type { ArchivedFilter, Board, Card, CardFilter, CompletionFilter, DueFilterKind, Member, SavedView, FilterSort } from "../types";
import {
  EMPTY_FILTER,
  FILTER_PRESETS,
  UNASSIGNED_ASSIGNEE,
  collectLabels,
  filterCards,
  filterIsActive
} from "../lib/filter";
import { describeDue } from "../lib/dueDate";
import { countLabel, initials } from "../lib/format";
import { Icon } from "./icons";
import { MemberDots } from "./TaskCard";
import type { OpenContextMenu } from "./contextMenu";

export interface FilterViewProps {
  // Every card in the workspace (archived included); the view filters locally.
  cards: Card[];
  boards: Board[];
  members: Member[];
  // Who "you" are on this device, so the "My tasks" preset scopes to your cards.
  activeMemberId: string;
  savedViews: SavedView[];
  requestedFilter: FilterRequest | null;
  onOpenCard: (card: Card) => void;
  onExportCalendar: () => Promise<void>;
  // Persist the current filter as a new named view (App handles naming + write).
  onSaveView: (filter: CardFilter) => void;
  onRenameView: (view: SavedView) => void;
  onDeleteView: (view: SavedView) => void;
  onOpenContextMenu: OpenContextMenu;
  onCopyText: (text: string) => Promise<void>;
}

export interface FilterRequest {
  id: number;
  filter: CardFilter;
}

const DUE_OPTIONS: Array<{ value: DueFilterKind; label: string }> = [
  { value: "any", label: "Any due date" },
  { value: "overdue", label: "Overdue" },
  { value: "today", label: "Due today" },
  { value: "soon", label: "Due soon" },
  { value: "later", label: "Later" },
  { value: "has", label: "Has due date" },
  { value: "none", label: "No due date" }
];

const COMPLETION_OPTIONS: Array<{ value: CompletionFilter; label: string }> = [
  { value: "active", label: "Active" },
  { value: "completed", label: "Completed" },
  { value: "any", label: "Any status" }
];

const ARCHIVED_OPTIONS: Array<{ value: ArchivedFilter; label: string }> = [
  { value: "active", label: "Not archived" },
  { value: "archived", label: "Archived" },
  { value: "any", label: "Include archived" }
];

const SORT_OPTIONS: Array<{ value: FilterSort; label: string }> = [
  { value: "updated", label: "Recently updated" },
  { value: "created", label: "Recently created" },
  { value: "due", label: "Due date" },
  { value: "title", label: "Title (A–Z)" }
];

const DUE_LABELS = new Map(DUE_OPTIONS.map((option) => [option.value, option.label]));
const COMPLETION_LABELS = new Map(COMPLETION_OPTIONS.map((option) => [option.value, option.label]));
const ARCHIVED_LABELS = new Map(ARCHIVED_OPTIONS.map((option) => [option.value, option.label]));
const SORT_LABELS = new Map(SORT_OPTIONS.map((option) => [option.value, option.label]));

interface ActiveFilterChip {
  id: string;
  label: string;
  onRemove: () => void;
}

// Stable comparison key for a filter so an applied preset/saved view can be
// highlighted regardless of the order facets were toggled in.
function filterKey(filter: CardFilter): string {
  return JSON.stringify({
    text: filter.text.trim(),
    boardId: filter.boardId,
    assignees: [...filter.assignees].sort(),
    labels: [...filter.labels].map((label) => label.toLowerCase()).sort(),
    due: filter.due,
    completion: filter.completion,
    archived: filter.archived,
    sort: filter.sort
  });
}

// Cross-board filter: free-text plus assignee/label/board/due/status facets over
// every card, with built-in presets and workspace saved views. The engine lives
// in lib/filter.ts; this component is the control surface + results list.
export function FilterView(props: FilterViewProps) {
  const [filter, setFilter] = useState<CardFilter>(EMPTY_FILTER);

  const labels = useMemo(() => collectLabels(props.cards), [props.cards]);
  const results = useMemo(() => filterCards(props.cards, filter), [props.cards, filter]);
  const datedCount = useMemo(() => props.cards.filter((card) => !card.archived && card.due).length, [props.cards]);
  const checkIn = useMemo(() => {
    const scopedCards = filterCards(props.cards, {
      ...filter,
      due: "any",
      completion: "any",
      sort: "updated"
    });
    const activeScopedCards = scopedCards.filter((card) => !card.archived && !card.completed);
    return {
      dueSoon: activeScopedCards.filter((card) => {
        const status = describeDue(card.due).status;
        return status === "overdue" || status === "today" || status === "soon";
      }).length,
      unassigned: activeScopedCards.filter((card) => card.assignees.length === 0).length,
      noDueDate: activeScopedCards.filter((card) => describeDue(card.due).status === "none").length,
      completed: scopedCards.filter((card) => !card.archived && card.completed).length
    };
  }, [props.cards, filter]);
  const active = filterIsActive(filter);
  const currentKey = filterKey(filter);
  const matchedPresetId = FILTER_PRESETS.find((preset) => filterKey(preset.build(props.activeMemberId)) === currentKey)?.id;
  const matchedSavedViewId = props.savedViews.find((view) => filterKey(view.filter) === currentKey)?.id;

  useEffect(() => {
    if (props.requestedFilter) {
      setFilter(props.requestedFilter.filter);
    }
  }, [props.requestedFilter]);

  function boardName(boardId: string) {
    return props.boards.find((board) => board.id === boardId)?.name ?? "Unknown board";
  }

  function listName(boardId: string, listId: string) {
    return props.boards.find((board) => board.id === boardId)?.lists.find((list) => list.id === listId)?.name ?? "Unknown list";
  }

  function patch(changes: Partial<CardFilter>) {
    setFilter((current) => ({ ...current, ...changes }));
  }

  function memberName(memberId: string) {
    return props.members.find((member) => member.id === memberId)?.name ?? "Unknown member";
  }

  function toggleMembership(list: string[], value: string): string[] {
    return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
  }

  function removeMembership(list: string[], value: string): string[] {
    return list.filter((item) => item !== value);
  }

  function activeChips(): ActiveFilterChip[] {
    const chips: ActiveFilterChip[] = [];
    const text = filter.text.trim();
    if (text) {
      chips.push({ id: "text", label: `Text: ${text}`, onRemove: () => patch({ text: "" }) });
    }
    if (filter.boardId) {
      chips.push({ id: "board", label: `Board: ${boardName(filter.boardId)}`, onRemove: () => patch({ boardId: "" }) });
    }
    if (filter.due !== EMPTY_FILTER.due) {
      chips.push({ id: "due", label: `Due: ${DUE_LABELS.get(filter.due) ?? filter.due}`, onRemove: () => patch({ due: EMPTY_FILTER.due }) });
    }
    if (filter.completion !== EMPTY_FILTER.completion) {
      chips.push({
        id: "completion",
        label: `Status: ${COMPLETION_LABELS.get(filter.completion) ?? filter.completion}`,
        onRemove: () => patch({ completion: EMPTY_FILTER.completion })
      });
    }
    if (filter.archived !== EMPTY_FILTER.archived) {
      chips.push({
        id: "archived",
        label: `Archive: ${ARCHIVED_LABELS.get(filter.archived) ?? filter.archived}`,
        onRemove: () => patch({ archived: EMPTY_FILTER.archived })
      });
    }
    for (const assignee of filter.assignees) {
      chips.push({
        id: `assignee-${assignee}`,
        label: assignee === UNASSIGNED_ASSIGNEE ? "Assignee: Unassigned" : `Assignee: ${memberName(assignee)}`,
        onRemove: () => patch({ assignees: removeMembership(filter.assignees, assignee) })
      });
    }
    for (const label of filter.labels) {
      chips.push({
        id: `label-${label.toLowerCase()}`,
        label: `Label: ${label}`,
        onRemove: () => patch({ labels: removeMembership(filter.labels, label) })
      });
    }
    if (filter.sort !== EMPTY_FILTER.sort) {
      chips.push({ id: "sort", label: `Sort: ${SORT_LABELS.get(filter.sort) ?? filter.sort}`, onRemove: () => patch({ sort: EMPTY_FILTER.sort }) });
    }
    return chips;
  }

  const chips = activeChips();

  return (
    <section className="filter-view">
      <header className="content-header">
        <div>
          <p className="eyebrow">Workspace</p>
          <h1>Filter</h1>
          <p className="meta-line" data-testid="filter-result-count">{countLabel(results.length, "card")}</p>
        </div>
        <div className="header-actions">
          <button
            data-testid="filter-clear"
            disabled={!active}
            title={active ? "Reset all filters" : "No filters applied"}
            onClick={() => setFilter(EMPTY_FILTER)}
          >
            <Icon name="x" /> Clear
          </button>
          <button
            className="primary"
            data-testid="filter-save-view"
            disabled={!active || Boolean(matchedSavedViewId)}
            title={
              !active
                ? "Configure a filter to save"
                : matchedSavedViewId
                  ? "These filters are already saved"
                  : "Save the current filters as a view"
            }
            onClick={() => props.onSaveView(filter)}
          >
            <Icon name="save" /> Save view
          </button>
          <button
            data-testid="due-export"
            disabled={datedCount === 0}
            title={datedCount === 0 ? "No cards have a due date yet" : "Export due dates as a calendar file"}
            onClick={() => void props.onExportCalendar()}
          >
            <Icon name="calendar" /> Export .ics
          </button>
        </div>
      </header>

      <section className="filter-view-section">
        <div className="filter-section-heading">
          <span>Quick views</span>
          {props.savedViews.length > 0 && <span>{countLabel(props.savedViews.length, "saved view")}</span>}
        </div>
        <div className="filter-quicklist" data-testid="filter-presets">
          {FILTER_PRESETS.map((preset) => {
            const disabled = Boolean(preset.requiresIdentity) && !props.activeMemberId;
            return (
              <button
                key={preset.id}
                className={`filter-chip ${matchedPresetId === preset.id ? "active" : ""}`}
                data-testid={`filter-preset-${preset.id}`}
                disabled={disabled}
                title={disabled ? "Choose who you are (bottom-left) to use this view" : `Show ${preset.name}`}
                onClick={() => setFilter(preset.build(props.activeMemberId))}
              >
                {preset.name}
              </button>
            );
          })}
          {props.savedViews.map((view) => (
            <button
              key={view.id}
              className={`filter-chip saved ${matchedSavedViewId === view.id ? "active" : ""}`}
              data-testid={`filter-saved-${view.id}`}
              title={`Apply saved view "${view.name}"`}
              onClick={() => setFilter(view.filter)}
              onContextMenu={(event) => props.onOpenContextMenu(event, [
                { label: "Apply view", icon: "search", onSelect: () => setFilter(view.filter) },
                { label: "Rename view", icon: "edit", onSelect: () => props.onRenameView(view) },
                { label: "Copy view name", icon: "copy", onSelect: () => void props.onCopyText(view.name) },
                { type: "separator" },
                { label: "Delete view", icon: "trash", danger: true, onSelect: () => props.onDeleteView(view) }
              ], view.name)}
            >
              <Icon name="save" />
              {view.name}
            </button>
          ))}
        </div>
      </section>

      <div className="filter-checkin" aria-label="Task check-in" data-testid="filter-checkin">
        <button className="filter-checkin-item" data-testid="filter-checkin-due" onClick={() => patch({ due: "soon", completion: "active", archived: "active", sort: "due" })}>
          <Icon name="calendar" />
          <strong>{checkIn.dueSoon}</strong>
          <span>Due soon</span>
        </button>
        <button className="filter-checkin-item" data-testid="filter-checkin-unassigned" onClick={() => patch({ assignees: [UNASSIGNED_ASSIGNEE], due: "any", completion: "active", archived: "active" })}>
          <Icon name="users" />
          <strong>{checkIn.unassigned}</strong>
          <span>Unassigned</span>
        </button>
        <button className="filter-checkin-item" data-testid="filter-checkin-nodue" onClick={() => patch({ due: "none", completion: "active", archived: "active" })}>
          <Icon name="calendar" />
          <strong>{checkIn.noDueDate}</strong>
          <span>No due date</span>
        </button>
        <button className="filter-checkin-item" data-testid="filter-checkin-done" onClick={() => patch({ due: "any", completion: "completed", archived: "active" })}>
          <Icon name="check" />
          <strong>{checkIn.completed}</strong>
          <span>Done</span>
        </button>
      </div>

      <div className="filter-active-strip" data-testid="filter-active-summary">
        <span className="filter-active-label">Current view</span>
        <div className="filter-active-chips">
          {filter.completion === EMPTY_FILTER.completion && <span className="filter-state-chip">Active cards</span>}
          {filter.archived === EMPTY_FILTER.archived && <span className="filter-state-chip">Not archived</span>}
          {chips.length === 0 ? (
            <span className="filter-state-chip muted">Default sort</span>
          ) : chips.map((chip) => (
            <button
              key={chip.id}
              className="filter-state-chip removable"
              data-testid={`filter-active-${chip.id}`}
              title={`Remove ${chip.label}`}
              onClick={chip.onRemove}
            >
              <span>{chip.label}</span>
              <Icon name="x" />
            </button>
          ))}
        </div>
      </div>

      <div className="filter-controls">
        <div className="filter-input-row">
          <span className="filter-input-icon" aria-hidden="true"><Icon name="search" /></span>
          <input
            type="search"
            className="filter-input"
            data-testid="filter-input"
            placeholder="Filter by title, notes, or labels…"
            value={filter.text}
            onChange={(event) => patch({ text: event.target.value })}
          />
        </div>

        <div className="filter-selects">
          <label className="filter-select">
            <span>Board</span>
            <select data-testid="filter-board" value={filter.boardId} onChange={(event) => patch({ boardId: event.target.value })}>
              <option value="">All boards</option>
              {props.boards.map((board) => (
                <option key={board.id} value={board.id}>{board.name}</option>
              ))}
            </select>
          </label>
          <label className="filter-select">
            <span>Due</span>
            <select data-testid="filter-due" value={filter.due} onChange={(event) => patch({ due: event.target.value as DueFilterKind })}>
              {DUE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <label className="filter-select">
            <span>Status</span>
            <select data-testid="filter-completion" value={filter.completion} onChange={(event) => patch({ completion: event.target.value as CompletionFilter })}>
              {COMPLETION_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <label className="filter-select">
            <span>Archive</span>
            <select data-testid="filter-archived" value={filter.archived} onChange={(event) => patch({ archived: event.target.value as ArchivedFilter })}>
              {ARCHIVED_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <label className="filter-select">
            <span>Sort</span>
            <select data-testid="filter-sort" value={filter.sort} onChange={(event) => patch({ sort: event.target.value as FilterSort })}>
              {SORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
        </div>

        {props.members.length > 0 && (
          <div className="filter-facet" data-testid="filter-assignees">
            <span className="filter-facet-label">Assignee</span>
            <div className="filter-facet-chips">
              {props.members.map((member) => {
                const selected = filter.assignees.includes(member.id);
                return (
                  <button
                    key={member.id}
                    className={`filter-token ${selected ? "active" : ""}`}
                    data-testid={`filter-assignee-${member.id}`}
                    aria-pressed={selected}
                    onClick={() => patch({ assignees: toggleMembership(filter.assignees, member.id) })}
                  >
                    <span className="avatar small" style={{ background: member.color }}>{initials(member.name)}</span>
                    {member.name}
                  </button>
                );
              })}
              <button
                className={`filter-token ${filter.assignees.includes(UNASSIGNED_ASSIGNEE) ? "active" : ""}`}
                data-testid="filter-assignee-unassigned"
                aria-pressed={filter.assignees.includes(UNASSIGNED_ASSIGNEE)}
                onClick={() => patch({ assignees: toggleMembership(filter.assignees, UNASSIGNED_ASSIGNEE) })}
              >
                Unassigned
              </button>
            </div>
          </div>
        )}

        {labels.length > 0 && (
          <div className="filter-facet" data-testid="filter-labels">
            <span className="filter-facet-label">Labels</span>
            <div className="filter-facet-chips">
              {labels.map((label) => {
                const selected = filter.labels.some((item) => item.toLowerCase() === label.toLowerCase());
                return (
                  <button
                    key={label}
                    className={`filter-token ${selected ? "active" : ""}`}
                    data-testid={`filter-label-${label}`}
                    aria-pressed={selected}
                    onClick={() => patch({ labels: toggleMembership(filter.labels, label) })}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {results.length === 0 ? (
        <div className="empty-state" data-testid="filter-empty">
          <h2>{props.cards.length === 0 ? "No cards yet" : "No cards match"}</h2>
          <p>
            {props.cards.length === 0
              ? "Create a card to start tracking work."
              : "Try broadening your text, clearing a filter, or including completed and archived cards."}
          </p>
        </div>
      ) : (
        <ul className="filter-results">
          {results.map((card) => {
            const due = describeDue(card.due);
            const assignees = props.members.filter((member) => card.assignees.includes(member.id));
            return (
              <li key={card.id}>
                <button
                  className={`filter-row ${card.completed ? "completed" : ""}`}
                  data-testid={`filter-row-${card.id}`}
                  aria-label={`${card.title}, ${due.label}, ${boardName(card.boardId)}, ${listName(card.boardId, card.listId)}`}
                  onClick={() => props.onOpenCard(card)}
                  onContextMenu={(event) => props.onOpenContextMenu(event, [
                    { label: "Open card", icon: "edit", onSelect: () => props.onOpenCard(card) },
                    { label: "Copy title", icon: "copy", onSelect: () => void props.onCopyText(card.title) }
                  ], card.title)}
                >
                  <span className={`due-badge due-${card.completed ? "complete" : due.status}`}>{due.label}</span>
                  <span className="filter-row-main">
                    <span className="filter-row-title">
                      {card.completed && <span className="done-check" aria-hidden="true">✓ </span>}
                      {card.title}
                      {card.archived && <span className="filter-tag" title="Archived">Archived</span>}
                    </span>
                    <span className="filter-row-context">
                      {boardName(card.boardId)} · {listName(card.boardId, card.listId)}
                    </span>
                    {card.labels.length > 0 && (
                      <span className="filter-row-labels">
                        {card.labels.map((label) => (
                          <span className="filter-row-label" key={label}>{label}</span>
                        ))}
                      </span>
                    )}
                  </span>
                  <span className="filter-row-owner">
                    <MemberDots members={assignees} />
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
