import { useEffect, useId, useMemo, useState } from "react";
import type { Board, Card } from "../types";
import type { BoardNavSections } from "./WorkspaceChrome";
import type { BoardViewProps } from "./BoardView";
import { countLabel } from "../lib/format.js";
import { compareCardsByOrder } from "../lib/ordering.js";
import { readOverviewCollapsedIds, writeOverviewCollapsedIds } from "../lib/viewPreferences.js";
import { EmptyState } from "./dialogs.js";
import { Icon } from "./icons.js";
import { TaskCardBody } from "./TaskCard.js";

type OverviewViewProps = Pick<BoardViewProps,
  "members" | "dropTargetCardId" | "onToggleSubtask" | "onOpenAttachment" |
  "onRevealAttachment" | "onOpenContextMenu" | "onCopyText"
> & {
  sections: BoardNavSections;
  cards: Card[];
  workspacePath: string;
  onOpenCard: (card: Card) => void;
  onCreateBoard: () => void;
};

export function OverviewView(props: OverviewViewProps) {
  const idPrefix = useId();
  const [collapsedIds, setCollapsedIds] = useState(() => readOverviewCollapsedIds(props.workspacePath));
  useEffect(() => {
    writeOverviewCollapsedIds(props.workspacePath, collapsedIds);
  }, [props.workspacePath, collapsedIds]);

  const boards = useMemo(() => [
    ...props.sections.grouped.flatMap(section => section.boards), ...props.sections.ungrouped
  ], [props.sections]);
  // List IDs can repeat across boards (including the default "todo"). Keep
  // both IDs in the index so every card stays in its actual board and list.
  const cardsByBoard = useMemo(() => {
    const index = new Map<string, Map<string, Card[]>>();
    for (const board of boards) index.set(board.id, new Map(board.lists.map(list => [list.id, []])));
    for (const card of props.cards) {
      if (!card.archived) index.get(card.boardId)?.get(card.listId)?.push(card);
    }
    for (const lists of index.values()) for (const cards of lists.values()) cards.sort(compareCardsByOrder);
    return index;
  }, [boards, props.cards]);
  const cardCount = [...cardsByBoard.values()].reduce((total, lists) =>
    total + [...lists.values()].reduce((sum, cards) => sum + cards.length, 0), 0);

  function toggle(id: string) {
    setCollapsedIds(current => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function renderBoard(board: Board) {
    const foldId = `board:${board.id}`;
    const collapsed = collapsedIds.has(foldId);
    const contentId = `${idPrefix}-board-${board.id}`;
    const listCards = cardsByBoard.get(board.id)!;
    const count = [...listCards.values()].reduce((sum, cards) => sum + cards.length, 0);
    return (
      <article className="overview-board" key={board.id} data-testid={`overview-board-${board.id}`}>
        <h3 className="overview-board-heading">
          <button type="button" className="overview-fold overview-board-toggle"
            aria-expanded={!collapsed} aria-controls={contentId}
            data-testid={`overview-board-toggle-${board.id}`} onClick={() => toggle(foldId)}>
            <Icon name={collapsed ? "chevron-right" : "chevron-down"} />
            <span className="overview-name">{board.name}</span>
            <span className="overview-count">{countLabel(board.lists.length, "list")} · {countLabel(count, "card")}</span>
          </button>
        </h3>
        <div id={contentId} hidden={collapsed}>
          {!collapsed && (board.lists.length === 0 ? <p className="muted">No lists in this board.</p> : (
            <div className="columns overview-columns">
              {board.lists.map(list => (
                <section className="column overview-column" key={list.id} aria-label={`${board.name}: ${list.name}`}>
                  <header className="overview-list-heading"><h4>{list.name}</h4><span>{listCards.get(list.id)!.length}</span></header>
                  <div className="card-stack overview-card-stack">
                    {listCards.get(list.id)!.length === 0 && <p className="overview-empty-list">No cards</p>}
                    {listCards.get(list.id)!.map(card => (
                      <article key={card.id} aria-label={`${card.title}${card.completed ? " (completed)" : ""}`}
                        className={`task-card${card.completed ? " completed" : ""}${props.dropTargetCardId === card.id ? " drop-target" : ""}`}
                        data-card-id={card.id} data-testid={`card-${card.id}`} onClick={() => props.onOpenCard(card)}>
                        <TaskCardBody card={card} members={props.members} workspacePath={props.workspacePath}
                          onOpen={() => props.onOpenCard(card)} onToggleSubtask={props.onToggleSubtask}
                          onOpenAttachment={props.onOpenAttachment} onRevealAttachment={props.onRevealAttachment}
                          onOpenContextMenu={props.onOpenContextMenu} onCopyText={props.onCopyText} />
                      </article>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          ))}
        </div>
      </article>
    );
  }

  const categories = props.sections.grouped.map(({ group, boards }) => ({ id: group.id, name: group.name, boards }));
  if (categories.length > 0 && props.sections.ungrouped.length > 0) {
    categories.push({ id: "ungrouped", name: "Ungrouped", boards: props.sections.ungrouped });
  }

  return (
    <section className="overview-view" data-testid="overview-view">
      <header className="content-header"><div>
        <p className="eyebrow">Workspace</p><h1>Overview</h1>
        <p className="meta-line">{props.sections.grouped.length} {props.sections.grouped.length === 1 ? "category" : "categories"} · {countLabel(boards.length, "board")} · {countLabel(cardCount, "card")}</p>
      </div></header>
      {boards.length === 0 && categories.length === 0 && (
        <EmptyState title="No boards yet" body="Create a board to start adding lists and cards." action="Create board" onAction={props.onCreateBoard} />
      )}
      {categories.length === 0 ? props.sections.ungrouped.map(renderBoard) : categories.map(category => {
        const foldId = `category:${category.id}`;
        const collapsed = collapsedIds.has(foldId);
        const contentId = `${idPrefix}-category-${category.id}`;
        return (
          <section className="overview-category" key={category.id} data-testid={`overview-category-${category.id}`}>
            <h2 className="overview-category-heading">
              <button type="button" className="overview-fold overview-category-toggle"
                aria-expanded={!collapsed} aria-controls={contentId}
                data-testid={`overview-category-toggle-${category.id}`} onClick={() => toggle(foldId)}>
                <Icon name={collapsed ? "chevron-right" : "chevron-down"} />
                <span className="overview-name">{category.name}</span><span className="overview-count">{countLabel(category.boards.length, "board")}</span>
              </button>
            </h2>
            <div id={contentId} hidden={collapsed}>
              {!collapsed && (category.boards.length > 0 ? category.boards.map(renderBoard) : <p className="muted">No boards in this category.</p>)}
            </div>
          </section>
        );
      })}
    </section>
  );
}
