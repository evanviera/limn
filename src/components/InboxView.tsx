import type { Board, Card } from "../types";
import type { InboxItem } from "../lib/inbox";
import { isInboxItemUnread } from "../lib/inbox.js";

interface InboxViewProps {
  activeMemberId: string;
  boards: Board[];
  items: InboxItem[];
  seenAt: string;
  onChooseIdentity: () => void;
  onMarkAllRead: () => void;
  onOpenCard: (card: Card) => void;
}

type InboxGroup = "Today" | "Yesterday" | "Earlier";

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function groupFor(iso: string, now = new Date()): InboxGroup {
  const age = startOfDay(now) - startOfDay(new Date(iso));
  if (age <= 0) return "Today";
  if (age < 2 * 86_400_000) return "Yesterday";
  return "Earlier";
}

function relativeTime(iso: string, now = new Date()): string {
  const seconds = Math.max(0, Math.floor((now.getTime() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function InboxView(props: InboxViewProps) {
  if (!props.activeMemberId) {
    return (
      <section className="inbox-view inbox-empty" data-testid="inbox-no-identity">
        <p>Choose who you are to see your mentions and assignments</p>
        <button className="primary" onClick={props.onChooseIdentity}>Choose who you are</button>
      </section>
    );
  }

  const groups = new Map<InboxGroup, InboxItem[]>();
  for (const item of props.items) {
    const group = groupFor(item.createdAt);
    groups.set(group, [...(groups.get(group) ?? []), item]);
  }

  return (
    <section className="inbox-view" data-testid="inbox-view">
      <header className="inbox-header">
        <div><p className="eyebrow">Awareness</p><h1>Inbox</h1></div>
        <button data-testid="inbox-mark-all-read" disabled={!props.items.some((item) => isInboxItemUnread(item, props.seenAt))} onClick={props.onMarkAllRead}>Mark all read</button>
      </header>
      {props.items.length === 0 ? <p className="inbox-empty">You're all caught up.</p> : (
        <div className="inbox-groups">
          {(["Today", "Yesterday", "Earlier"] as InboxGroup[]).map((group) => groups.has(group) && (
            <section className="inbox-group" key={group}>
              <h2>{group}</h2>
              <div className="inbox-list">
                {groups.get(group)!.map((item) => (
                  <button className="inbox-row" data-testid={`inbox-item-${item.id}`} key={item.id} onClick={() => props.onOpenCard(item.card)}>
                    <span className={`inbox-unread-dot${isInboxItemUnread(item, props.seenAt) ? " unread" : ""}`} aria-label={isInboxItemUnread(item, props.seenAt) ? "Unread" : undefined} />
                    <span className="inbox-row-copy">
                      <span className="inbox-event-label">{item.label}</span>
                      <span className="inbox-card-context"><strong>{item.card.title}</strong> · {props.boards.find((board) => board.id === item.card.boardId)?.name ?? "Unknown board"}</span>
                      {item.snippet && <span className="inbox-snippet">{item.snippet}</span>}
                    </span>
                    <time dateTime={item.createdAt}>{relativeTime(item.createdAt)}</time>
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </section>
  );
}
