import type { Board, Card } from "../types";
import { compareCardsByDueDate } from "./dueDate.js";

// Spacing between adjacent card orders. Large enough that many cards can be
// dropped between two neighbours (via repeated midpoints) before the list needs
// to be renormalized.
export const ORDER_STEP = 1000;

// Sort comparator for cards inside a list. Manual `order` wins; cards that share
// an order (notably legacy cards that all default to 0) fall back to due-date
// sorting so an un-curated list still reads in due-date priority.
export function compareCardsByOrder(left: Card, right: Card): number {
  const leftOrder = Number.isFinite(left.order) ? left.order : 0;
  const rightOrder = Number.isFinite(right.order) ? right.order : 0;
  if (leftOrder !== rightOrder) {
    return leftOrder - rightOrder;
  }
  return compareCardsByDueDate(left, right);
}

// Sort comparator for boards within a category (or the flat list). Manual
// `order` wins; boards that share an order — notably legacy boards that all
// default to 0 — fall back to creation order so an un-curated sidebar keeps its
// familiar sequence until a board is dragged.
export function compareBoardsByOrder(left: Board, right: Board): number {
  const leftOrder = Number.isFinite(left.order) ? left.order : 0;
  const rightOrder = Number.isFinite(right.order) ? right.order : 0;
  if (leftOrder !== rightOrder) {
    return leftOrder - rightOrder;
  }
  return left.createdAt.localeCompare(right.createdAt);
}

// The order to give a card appended to the bottom of a list. When every card in
// the list is still unordered (order 0) the list stays in due-date mode, so a
// new card keeps order 0 and simply sorts by its due date. Once a list has been
// manually curated (some card has a positive order) new cards go to the bottom.
export function nextOrderForList(listCards: Array<{ order: number }>): number {
  const maxOrder = listCards.reduce((max, card) => (card.order > max ? card.order : max), 0);
  return maxOrder > 0 ? maxOrder + ORDER_STEP : 0;
}

export interface OrderPlacement {
  // The order value to assign to the moved card.
  order: number;
  // Other cards in the list whose order must change to keep the sequence
  // distinct. Empty in the common case (a single midpoint write).
  rebalance: Array<{ id: string; order: number }>;
}

// Compute the order for a card inserted at `index` among `siblings` (the other
// cards already in the target list, sorted ascending by order). The common path
// returns a midpoint/append value touching only the moved card. When the
// insertion point sits between two cards that share an order — e.g. an
// un-curated list of legacy zeros — the whole list is renormalized to spaced,
// distinct values so the new position actually sticks.
export function placeInList(siblings: Array<{ id: string; order: number }>, index: number): OrderPlacement {
  const clamped = Math.max(0, Math.min(index, siblings.length));
  const prev = clamped > 0 ? siblings[clamped - 1].order : null;
  const next = clamped < siblings.length ? siblings[clamped].order : null;

  if (prev !== null && next !== null && prev >= next) {
    return renormalize(siblings, clamped);
  }

  if (prev === null && next === null) {
    return { order: ORDER_STEP, rebalance: [] };
  }
  if (prev === null) {
    return { order: (next as number) - ORDER_STEP, rebalance: [] };
  }
  if (next === null) {
    return { order: prev + ORDER_STEP, rebalance: [] };
  }
  return { order: (prev + next) / 2, rebalance: [] };
}

// Reassign spaced orders to the whole list, leaving a slot for the moved card at
// `index`. Only cards whose order actually changes are returned in `rebalance`.
function renormalize(siblings: Array<{ id: string; order: number }>, index: number): OrderPlacement {
  const rebalance: Array<{ id: string; order: number }> = [];
  let movedOrder = ORDER_STEP;
  let slot = 1;
  for (let position = 0; position <= siblings.length; position += 1) {
    if (position === index) {
      movedOrder = slot * ORDER_STEP;
      slot += 1;
    }
    if (position < siblings.length) {
      const desired = slot * ORDER_STEP;
      if (siblings[position].order !== desired) {
        rebalance.push({ id: siblings[position].id, order: desired });
      }
      slot += 1;
    }
  }
  return { order: movedOrder, rebalance };
}
