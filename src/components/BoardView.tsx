import { Fragment, useId } from "react";
import { useBoardInteraction } from "../lib/useBoardInteraction.js";
import type { Attachment, Board, BoardList, Card, Member } from "../types";
import { countLabel } from "../lib/format.js";
import { cardDeepLink } from "../lib/deepLink.js";
import { compareCardsByOrder } from "../lib/ordering.js";
import { Icon } from "./icons.js";
import { EmptyState } from "./dialogs.js";
import { TaskCardBody } from "./TaskCard.js";
import { DueReminder } from "./DueReminder.js";
import type { ContextMenuItem, OpenContextMenu } from "./contextMenu";

export interface CardDropTarget { boardId: string; listId: string; index: number }

export interface BoardViewProps {
  embedded?: boolean;
  dueReminders?: number;
  onReviewDue?: () => void;
  cardDropTarget?: CardDropTarget | null;
  onCardDropListChange?: (target: CardDropTarget | null) => void;
  board: Board;
  allCards: Card[];
  cards: Card[];
  members: Member[];
  workspacePath: string | null;
  // The card highlighted as the target of an in-progress OS file drag, or null.
  dropTargetCardId: string | null;
  onAddList: () => Promise<void>;
  onRenameBoard: (board: Board) => Promise<void>;
  onDeleteBoard: (board: Board) => Promise<void>;
  onRenameList: (list: BoardList) => Promise<void>;
  onDeleteList: (list: BoardList) => Promise<void>;
  onSortListCardsByDueDate: (list: BoardList) => Promise<void>;
  onArchiveListCards: (list: BoardList) => Promise<void>;
  onDeleteListCards: (list: BoardList) => Promise<void>;
  onToggleListCollapsed: (list: BoardList) => Promise<void>;
  onMoveList: (listId: string, index: number) => Promise<void>;
  onAddCard: (listId: string) => Promise<void>;
  // `index` is where the card should land among the *other* cards already in the
  // target list (0 = top, omitted = append to the bottom).
  onMoveCard: (cardId: string, listId: string, index?: number) => Promise<void>;
  onMoveCardToBoard: (cardId: string, boardId: string, listId?: string, index?: number) => Promise<boolean>;
  onRequestMoveCard: (cardId: string) => void;
  onCardDropBoardChange: (boardId: string | null) => void;
  onOpenCard: (cardId: string) => void;
  onToggleSubtask: (cardId: string, subtaskId: string, completed: boolean) => Promise<void>;
  onOpenAttachment: (cardId: string, attachment: Attachment) => Promise<void>;
  onRevealAttachment: (cardId: string, attachment: Attachment) => Promise<void>;
  onToggleCardCompleted: (card: Card) => Promise<void>;
  onArchiveCard: (card: Card) => Promise<void>;
  onDeleteCard: (card: Card) => Promise<void>;
  onOpenContextMenu: OpenContextMenu;
  onCopyText: (text: string) => Promise<void>;
}
export function BoardView(props: BoardViewProps) {
  const viewOptionsId = useId();
  const ListHeading = props.embedded ? "h4" : "h2";
  const {
    columnsRef, dragPreview, dropTarget, draggingListId, listDropTarget,
    compactCards, setCompactCards, autoCompactCompletedCards, setAutoCompactCompletedCards,
    compactSteps, setCompactSteps,
    viewMenuOpen, setViewMenuOpen, viewMenuRef, viewMenuToggleRef, openCard,
    beginPointerDrag, updatePointerDrag, finishPointerDrag, cancelPointerDrag, beginMouseDrag,
    beginListPointerDrag, updateListPointerDrag, finishListPointerDrag, cancelListPointerDrag, beginListMouseDrag
  } = useBoardInteraction(props);

  function boardContextItems(): ContextMenuItem[] {
    return [
      { label: "Add list", icon: "plus", onSelect: () => void props.onAddList() },
      ...boardMoreContextItems()
    ];
  }

  function boardMoreContextItems(): ContextMenuItem[] {
    return [
      { label: "Rename board", icon: "edit", onSelect: () => void props.onRenameBoard(props.board) },
      { label: "Copy board name", icon: "copy", onSelect: () => void props.onCopyText(props.board.name) },
      { type: "separator" },
      { label: "Delete board", icon: "trash", danger: true, onSelect: () => void props.onDeleteBoard(props.board) }
    ];
  }

  function listContextItems(list: BoardList): ContextMenuItem[] {
    const activeCardCount = props.cards.filter((card) => card.listId === list.id).length;
    const allCardCount = props.allCards.filter((card) => card.listId === list.id).length;

    return [
      { label: "Add card", icon: "plus", onSelect: () => void props.onAddCard(list.id) },
      {
        label: list.collapsed ? "Expand list" : "Collapse list",
        icon: list.collapsed ? "chevron-right" : "chevron-down",
        onSelect: () => void props.onToggleListCollapsed(list)
      },
      { label: "Rename list", icon: "edit", onSelect: () => void props.onRenameList(list) },
      { label: "Copy list name", icon: "copy", onSelect: () => void props.onCopyText(list.name) },
      { type: "separator" },
      {
        label: "Sort cards by due date",
        icon: "calendar",
        disabled: activeCardCount < 2,
        onSelect: () => void props.onSortListCardsByDueDate(list)
      },
      { type: "separator" },
      {
        label: "Archive all cards",
        icon: "archive",
        disabled: activeCardCount === 0,
        onSelect: () => void props.onArchiveListCards(list)
      },
      {
        label: "Delete all cards",
        icon: "trash",
        danger: true,
        disabled: allCardCount === 0,
        onSelect: () => void props.onDeleteListCards(list)
      },
      { type: "separator" },
      { label: "Delete list", icon: "trash", danger: true, onSelect: () => void props.onDeleteList(list) }
    ];
  }

  function cardContextItems(card: Card): ContextMenuItem[] {
    const moveItems = props.board.lists
      .filter((list) => list.id !== card.listId)
      .map<ContextMenuItem>((list) => ({
        label: `Move to ${list.name}`,
        icon: "chevron-up-right",
        onSelect: () => void props.onMoveCard(card.id, list.id)
      }));

    return [
      { label: "Open card", icon: "edit", onSelect: () => props.onOpenCard(card.id) },
      {
        label: card.completed ? "Mark incomplete" : "Mark complete",
        icon: "check",
        onSelect: () => void props.onToggleCardCompleted(card)
      },
      { label: "Copy title", icon: "copy", onSelect: () => void props.onCopyText(card.title) },
      { label: "Copy card link", icon: "copy", onSelect: () => void props.onCopyText(cardDeepLink(card.id)) },
      { type: "separator" },
      { label: "Move to board…", icon: "chevron-up-right", onSelect: () => props.onRequestMoveCard(card.id) },
      ...moveItems,
      { type: "separator" },
      { label: "Archive card", icon: "archive", onSelect: () => void props.onArchiveCard(card) },
      { label: "Delete card", icon: "trash", danger: true, onSelect: () => void props.onDeleteCard(card) }
    ];
  }

  const dragPreviewCard = dragPreview ? props.cards.find((card) => card.id === dragPreview.cardId) : null;
  const draggedListIndex = draggingListId ? props.board.lists.findIndex((list) => list.id === draggingListId) : -1;
  const listIndicatorAt =
    listDropTarget && draggedListIndex !== -1
      ? listDropTarget.index >= draggedListIndex
        ? listDropTarget.index + 1
        : listDropTarget.index
      : -1;

  function cardIsCompact(card: Card): boolean {
    return compactCards || (autoCompactCompletedCards && card.completed);
  }

  return (
    <section className={`board-view${props.embedded ? " embedded-board-view" : ""}`} onContextMenu={(event) => props.onOpenContextMenu(event, boardContextItems(), props.board.name)}>
      <header className="content-header">
        {!props.embedded && <div className="board-title-block">
          <div className="board-title-row">
            <h1>{props.board.name}</h1>
            <p className="meta-line">{countLabel(props.cards.length, "card")}</p>
          </div>
          {props.onReviewDue && <DueReminder count={props.dueReminders ?? 0} onReview={props.onReviewDue} />}
        </div>}
        <div className="header-actions">
          <div className="board-view-menu" ref={viewMenuRef}>
            <button
              ref={viewMenuToggleRef}
              aria-controls={viewOptionsId}
              aria-expanded={viewMenuOpen}
              data-testid="board-view-menu-toggle"
              onClick={() => setViewMenuOpen((current) => !current)}
            >
              <Icon name="sliders" /> View
            </button>
            {viewMenuOpen && (
              <div className="board-view-popover" id={viewOptionsId} role="group" aria-label="Card display">
                <p>Card display</p>
                <button
                  aria-pressed={compactCards}
                  className="board-view-option"
                  data-testid="compact-board-toggle"
                  onClick={() => setCompactCards((current) => !current)}
                >
                  <span className="board-view-option-copy">
                    <Icon name={compactCards ? "maximize" : "minus"} />
                    <span><strong>Compact cards</strong><small>Show titles and key metadata</small></span>
                  </span>
                  <span className="board-view-switch" aria-hidden="true" />
                </button>
                <button
                  aria-pressed={autoCompactCompletedCards}
                  className="board-view-option"
                  data-testid="compact-completed-toggle"
                  onClick={() => setAutoCompactCompletedCards((current) => !current)}
                >
                  <span className="board-view-option-copy">
                    <Icon name="check" />
                    <span><strong>Compact completed</strong><small>Reduce cards when work is done</small></span>
                  </span>
                  <span className="board-view-switch" aria-hidden="true" />
                </button>
                <button
                  aria-pressed={compactSteps}
                  className="board-view-option"
                  data-testid="compact-steps-toggle"
                  onClick={() => setCompactSteps((current) => !current)}
                >
                  <span className="board-view-option-copy">
                    <Icon name="plus" />
                    <span><strong>Compact steps</strong><small>Show one step with “+ more steps”</small></span>
                  </span>
                  <span className="board-view-switch" aria-hidden="true" />
                </button>
              </div>
            )}
          </div>
          <button
            aria-label="More board actions"
            data-testid="board-more-menu"
            onClick={(event) => props.onOpenContextMenu(event, boardMoreContextItems(), props.board.name)}
          >
            <Icon name="more-horizontal" /> More
          </button>
          <button data-testid="add-list" onClick={() => void props.onAddList()}>
            <Icon name="plus" /> Add list
          </button>
        </div>
      </header>

      <div className="columns" ref={columnsRef}>
        {props.board.lists.length === 0 && (
          <EmptyState title="No lists yet" body="Add a list to organize cards on this board." action="Add list" onAction={props.onAddList} />
        )}
        {props.board.lists.map((list, listPosition) => {
          const listCards = props.cards.filter((card) => card.listId === list.id).sort(compareCardsByOrder);
          // Map the drop index (measured over the *other* cards) onto a position
          // in the rendered list, which still includes the dimmed dragged card.
          const draggedIndex = dragPreview ? listCards.findIndex((card) => card.id === dragPreview.cardId) : -1;
          const indicatorAt =
            dropTarget?.boardId === props.board.id && dropTarget.listId === list.id
              ? draggedIndex !== -1 && dropTarget.index >= draggedIndex
                ? dropTarget.index + 1
                : dropTarget.index
              : -1;
          // A single insertion line marks where the dragged list will land.
          // Interior/leading gaps draw it before the column at that index; the
          // trailing append case (index past the last column) draws it after the
          // final column. Never draw both for one gap, or two lines appear.
          const isLastList = listPosition === props.board.lists.length - 1;
          const showDropBefore = listIndicatorAt === listPosition;
          const showDropAfter = isLastList && listIndicatorAt === listPosition + 1;
          const columnClass = `column ${list.collapsed ? "collapsed" : ""} ${draggingListId === list.id ? "list-drag-source" : ""} ${showDropBefore ? "list-drop-before" : ""} ${showDropAfter ? "list-drop-after" : ""}`;
          if (list.collapsed) {
            return (
              <section
                className={columnClass}
                data-list-id={list.id}
                data-list-board-id={props.board.id}
                data-testid={`list-${list.id}`}
                key={list.id}
                onContextMenu={(event) => props.onOpenContextMenu(event, listContextItems(list), list.name)}
              >
                <button
                  aria-label={`Drag list ${list.name}`}
                  className="list-drag-handle"
                  data-testid={`list-drag-${list.id}`}
                  title="Drag list"
                  onContextMenu={(event) => event.stopPropagation()}
                  onPointerCancel={cancelListPointerDrag}
                  onPointerDown={(event) => beginListPointerDrag(event, list.id)}
                  onPointerMove={updateListPointerDrag}
                  onPointerUp={finishListPointerDrag}
                  onMouseDown={(event) => beginListMouseDrag(event, list.id)}
                >
                  <Icon name="drag-handle" />
                </button>
                <button
                  aria-label={`Expand list ${list.name}`}
                  aria-expanded={false}
                  className="collapsed-list-body"
                  data-testid={`collapse-list-${list.id}`}
                  title="Expand list"
                  onClick={() => void props.onToggleListCollapsed(list)}
                >
                  <Icon name="chevron-right" />
                  <span className="collapsed-list-title">{list.name}</span>
                  <span className="collapsed-list-count">{listCards.length}</span>
                </button>
              </section>
            );
          }
          return (
            <section
              className={columnClass}
              data-list-id={list.id}
                data-list-board-id={props.board.id}
              data-testid={`list-${list.id}`}
              key={list.id}
              onContextMenu={(event) => props.onOpenContextMenu(event, listContextItems(list), list.name)}
            >
              <header className="column-header">
                <button
                  aria-label={`Drag list ${list.name}`}
                  className="list-drag-handle"
                  data-testid={`list-drag-${list.id}`}
                  title="Drag list"
                  onContextMenu={(event) => event.stopPropagation()}
                  onPointerCancel={cancelListPointerDrag}
                  onPointerDown={(event) => beginListPointerDrag(event, list.id)}
                  onPointerMove={updateListPointerDrag}
                  onPointerUp={finishListPointerDrag}
                  onMouseDown={(event) => beginListMouseDrag(event, list.id)}
                >
                  <Icon name="drag-handle" />
                </button>
                <button
                  aria-label={`Collapse list ${list.name}`}
                  aria-expanded={true}
                  className="list-collapse-toggle"
                  data-testid={`collapse-list-${list.id}`}
                  title="Collapse list"
                  onClick={() => void props.onToggleListCollapsed(list)}
                >
                  <Icon name="chevron-down" />
                </button>
                <ListHeading
                  className="list-title"
                  data-testid={`list-title-${list.id}`}
                  title="Drag to reorder"
                  onPointerCancel={cancelListPointerDrag}
                  onPointerDown={(event) => beginListPointerDrag(event, list.id)}
                  onPointerMove={updateListPointerDrag}
                  onPointerUp={finishListPointerDrag}
                  onMouseDown={(event) => beginListMouseDrag(event, list.id)}
                >
                  {list.name}
                </ListHeading>
                <span>{listCards.length}</span>
                <button className="list-action" aria-label={`More actions for ${list.name}`} title="List actions" data-testid={`list-more-${list.id}`}
                  onClick={(event) => props.onOpenContextMenu(event, listContextItems(list), list.name)}>
                  <Icon name="more-horizontal" />
                </button>
              </header>
              <div className="card-stack">
                {listCards.length === 0 ? (
                  // Keep the placeholder mounted for empty lists so the column height stays
                  // constant while dragging over it. Swapping it for the 2px drop-indicator
                  // collapses a content-sized empty column out from under the pointer, which
                  // flips the elementFromPoint hit test off the list and back — a flicker.
                  // Highlight the placeholder as the drop target instead.
                  <p
                    className={`empty-list ${indicatorAt === 0 ? "is-drop-target" : ""}`}
                    data-testid={indicatorAt === 0 ? `drop-indicator-${list.id}` : undefined}
                  >
                    Drop cards here.
                  </p>
                ) : (
                  indicatorAt === 0 && <div className="drop-indicator" data-testid={`drop-indicator-${list.id}`} />
                )}
                {listCards.map((card, position) => {
                  const isCompact = cardIsCompact(card);
                  return (
                    <Fragment key={card.id}>
                      <article
                        aria-label={`${card.title}${card.completed ? " (completed)" : ""}`}
                        className={`task-card ${isCompact ? "compact" : ""} ${card.completed ? "completed" : ""} ${dragPreview?.cardId === card.id ? "drag-source" : ""} ${props.dropTargetCardId === card.id ? "drop-target" : ""}`}
                        data-card-id={card.id}
                        data-testid={`card-${card.id}`}
                        onClick={() => openCard(card.id)}
                        onContextMenu={(event) => props.onOpenContextMenu(event, cardContextItems(card), card.title)}
                        onPointerCancel={cancelPointerDrag}
                        onPointerDown={(event) => beginPointerDrag(event, card.id)}
                        onPointerMove={updatePointerDrag}
                        onPointerUp={finishPointerDrag}
                        onMouseDown={(event) => beginMouseDrag(event, card.id)}
                      >
                        <TaskCardBody
                          key={compactSteps ? "compact-steps" : "full-steps"}
                          card={card}
                          compact={isCompact}
                          compactSteps={compactSteps}
                          members={props.members}
                          workspacePath={props.workspacePath}
                          onOpen={openCard}
                          onToggleSubtask={props.onToggleSubtask}
                          onOpenAttachment={(cardId, attachment) => void props.onOpenAttachment(cardId, attachment)}
                          onRevealAttachment={(cardId, attachment) => void props.onRevealAttachment(cardId, attachment)}
                          onOpenContextMenu={props.onOpenContextMenu}
                          onCopyText={props.onCopyText}
                        />
                      </article>
                      {indicatorAt === position + 1 && <div className="drop-indicator" data-testid={`drop-indicator-${list.id}`} />}
                    </Fragment>
                  );
                })}
              </div>
              <button className="add-card" data-testid={`add-card-${list.id}`} onClick={() => void props.onAddCard(list.id)}>
                <Icon name="plus" /> Add card
              </button>
            </section>
          );
        })}
      </div>
      {dragPreview && dragPreviewCard && (
        <article
          className={`task-card drag-preview ${cardIsCompact(dragPreviewCard) ? "compact" : ""} ${dragPreviewCard.completed ? "completed" : ""}`}
          data-testid="card-drag-preview"
          style={{
            height: dragPreview.height,
            transform: `translate3d(${dragPreview.left}px, ${dragPreview.top}px, 0)`,
            width: dragPreview.width
          }}
        >
          <TaskCardBody key={compactSteps ? "compact-steps" : "full-steps"} card={dragPreviewCard} compact={cardIsCompact(dragPreviewCard)} compactSteps={compactSteps} members={props.members} workspacePath={props.workspacePath} />
        </article>
      )}
    </section>
  );
}
