import { useMemo, useState } from "react";
import type { Board, Card, Member } from "../types";
import { describeDue, groupCardsByDue } from "../lib/dueDate";
import { countLabel } from "../lib/format";
import { Icon } from "./icons";
import { MemberDots } from "./BoardView";
import type { OpenContextMenu } from "./contextMenu";

export interface DueViewProps {
  cards: Card[];
  boards: Board[];
  members: Member[];
  onOpenCard: (card: Card) => void;
  onExportCalendar: () => Promise<void>;
  onOpenContextMenu: OpenContextMenu;
  onCopyText: (text: string) => Promise<void>;
}

// Cross-board due-date workspace: every card, grouped by how soon it is due
// (Overdue → Today → Due soon → Upcoming → No due date) so work can be triaged
// and rescued regardless of which board it lives on.
export function DueView(props: DueViewProps) {
  const [showCompleted, setShowCompleted] = useState(false);

  function boardName(boardId: string) {
    return props.boards.find((board) => board.id === boardId)?.name ?? "Unknown board";
  }

  function listName(boardId: string, listId: string) {
    return props.boards.find((board) => board.id === boardId)?.lists.find((list) => list.id === listId)?.name ?? "Unknown list";
  }

  const scopedCards = useMemo(
    () => props.cards.filter((card) => !card.archived && (showCompleted || !card.completed)),
    [props.cards, showCompleted]
  );
  const groups = useMemo(() => groupCardsByDue(scopedCards), [scopedCards]);
  const datedCount = useMemo(() => props.cards.filter((card) => !card.archived && card.due).length, [props.cards]);
  const shownCount = groups.reduce((sum, group) => sum + group.cards.length, 0);

  return (
    <section className="due-view">
      <header className="content-header">
        <div>
          <p className="eyebrow">Workspace</p>
          <h1>Due dates</h1>
          <p className="meta-line">{countLabel(shownCount, "card")}</p>
        </div>
        <div className="header-actions">
          <label className="due-filter">
            <input
              type="checkbox"
              data-testid="due-show-completed"
              checked={showCompleted}
              onChange={(event) => setShowCompleted(event.target.checked)}
            />
            <span>Show completed</span>
          </label>
          <button
            className="primary"
            data-testid="due-export"
            disabled={datedCount === 0}
            title={datedCount === 0 ? "No cards have a due date yet" : "Export due dates as a calendar file"}
            onClick={() => void props.onExportCalendar()}
          >
            <Icon name="calendar" /> Export .ics
          </button>
        </div>
      </header>

      {groups.length === 0 ? (
        <div className="empty-state" data-testid="due-empty">
          <h2>Nothing scheduled</h2>
          <p>Cards with a due date appear here, grouped by how soon they are due.</p>
        </div>
      ) : (
        <div className="due-groups">
          {groups.map((group) => (
            <section className="due-group" data-testid={`due-group-${group.key}`} key={group.key}>
              <header className={`due-group-header due-${group.key}`}>
                <h2>{group.title}</h2>
                <span>{group.cards.length}</span>
              </header>
              <ul className="due-list">
                {group.cards.map((card) => {
                  const due = describeDue(card.due);
                  return (
                    <li key={card.id}>
                      <button
                        className={`due-row ${card.completed ? "completed" : ""}`}
                        data-testid={`due-row-${card.id}`}
                        onClick={() => props.onOpenCard(card)}
                        onContextMenu={(event) => props.onOpenContextMenu(event, [
                          { label: "Open card", icon: "edit", onSelect: () => props.onOpenCard(card) },
                          { label: "Copy title", icon: "copy", onSelect: () => void props.onCopyText(card.title) }
                        ], card.title)}
                      >
                        <span className={`due-badge due-${card.completed ? "complete" : due.status}`}>{due.label}</span>
                        <span className="due-row-title">
                          {card.completed && <span className="done-check" aria-hidden="true">✓ </span>}
                          {card.title}
                        </span>
                        <span className="due-row-context">
                          {boardName(card.boardId)} · {listName(card.boardId, card.listId)}
                        </span>
                        <MemberDots members={props.members.filter((member) => card.assignees.includes(member.id))} />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </section>
  );
}
