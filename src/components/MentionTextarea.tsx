import { useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import type { Member } from "../types";
import { initials } from "../lib/format";
import { applyMention, findMentionQuery, suggestMembers } from "../lib/mentions";
import type { MentionQuery } from "../lib/mentions";

// A textarea that offers an @mention picker: typing "@" opens a list of members,
// filtered as you type, that can be navigated with the arrow keys and inserted
// with Enter/Tab. When the picker is closed the component behaves like a plain
// textarea and forwards key events to `onKeyDown` (so the host form keeps its own
// ⌘/Ctrl+Enter and Escape handling).
export function MentionTextarea({
  value,
  onChange,
  members,
  className,
  placeholder,
  ariaLabel,
  testId,
  autoFocus,
  onKeyDown
}: {
  value: string;
  onChange: (value: string) => void;
  members: Member[];
  className?: string;
  placeholder?: string;
  ariaLabel?: string;
  testId?: string;
  autoFocus?: boolean;
  onKeyDown?: (event: ReactKeyboardEvent<HTMLTextAreaElement>) => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [active, setActive] = useState<MentionQuery | null>(null);
  const [highlight, setHighlight] = useState(0);

  const suggestions = active ? suggestMembers(active.query, members) : [];
  const open = suggestions.length > 0;
  const activeIndex = Math.min(highlight, suggestions.length - 1);
  const listId = testId ? `${testId}-mention-list` : undefined;

  function refreshQuery(text: string, caret: number | null) {
    setActive(caret === null ? null : findMentionQuery(text, caret));
    setHighlight(0);
  }

  function choose(member: Member) {
    if (!active) {
      return;
    }
    const result = applyMention(value, active, member);
    onChange(result.text);
    setActive(null);
    setHighlight(0);
    // The value change re-renders the textarea; restore focus and caret after paint.
    requestAnimationFrame(() => {
      const el = ref.current;
      if (el) {
        el.focus();
        el.setSelectionRange(result.caret, result.caret);
      }
    });
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>) {
    if (open) {
      switch (event.key) {
        case "ArrowDown":
          event.preventDefault();
          setHighlight((current) => (Math.min(current, suggestions.length - 1) + 1) % suggestions.length);
          return;
        case "ArrowUp":
          event.preventDefault();
          setHighlight(
            (current) => (Math.min(current, suggestions.length - 1) + suggestions.length - 1) % suggestions.length
          );
          return;
        case "Enter":
        case "Tab":
          event.preventDefault();
          choose(suggestions[activeIndex]!);
          return;
        case "Escape":
          event.preventDefault();
          event.stopPropagation();
          setActive(null);
          return;
        default:
          break;
      }
    }
    onKeyDown?.(event);
  }

  return (
    <div className="mention-field">
      <textarea
        ref={ref}
        className={className}
        data-testid={testId}
        value={value}
        placeholder={placeholder}
        aria-label={ariaLabel}
        autoFocus={autoFocus}
        role="combobox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-autocomplete="list"
        onChange={(event) => {
          onChange(event.target.value);
          refreshQuery(event.target.value, event.target.selectionStart);
        }}
        onSelect={(event) => refreshQuery(event.currentTarget.value, event.currentTarget.selectionStart)}
        onKeyDown={handleKeyDown}
        onBlur={() => setActive(null)}
      />
      {open && (
        <ul className="mention-suggestions" id={listId} role="listbox" data-testid={testId ? `${testId}-mentions` : undefined}>
          {suggestions.map((member, index) => (
            <li key={member.id} role="presentation">
              <button
                type="button"
                className={`mention-suggestion${index === activeIndex ? " is-active" : ""}`}
                role="option"
                aria-selected={index === activeIndex}
                data-testid={testId ? `${testId}-mention-${member.id}` : undefined}
                // Keep the textarea focused so choosing doesn't fire onBlur first.
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setHighlight(index)}
                onClick={() => choose(member)}
              >
                <span className="avatar small" style={{ background: member.color }}>
                  {initials(member.name)}
                </span>
                <span className="mention-suggestion-name">{member.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
