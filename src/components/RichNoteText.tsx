import type { ReactNode } from "react";
import { openExternal } from "../storage";
import { NOTE_INLINE_PATTERN, buildNoteLink } from "../lib/noteFormat";
import type { OpenContextMenu } from "./contextMenu";

export function RichNoteText({
  text,
  testIdPrefix,
  onOpenContextMenu,
  onCopyText
}: {
  text: string;
  testIdPrefix: string;
  onOpenContextMenu?: OpenContextMenu;
  onCopyText?: (text: string) => Promise<void>;
}) {
  const nodes: ReactNode[] = [];
  let index = 0;
  let linkIndex = 0;

  NOTE_INLINE_PATTERN.lastIndex = 0;
  for (const match of text.matchAll(NOTE_INLINE_PATTERN)) {
    const matchStart = match.index ?? 0;
    const rawMatch = match[0];
    if (matchStart > index) {
      nodes.push(text.slice(index, matchStart));
    }

    const markdownLabel = match[1];
    const markdownUrl = match[2];
    const boldText = match[3];
    const italicText = match[4];
    const bareUrl = match[5];
    const link = buildNoteLink(markdownUrl || bareUrl || "");

    if (link) {
      const label = markdownLabel || link.url;
      nodes.push(
        <a
          data-testid={`${testIdPrefix}-${linkIndex}`}
          href={link.href}
          key={`${matchStart}-${linkIndex}`}
          onMouseDown={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
          onContextMenu={(event) => {
            if (!onOpenContextMenu) {
              return;
            }
            onOpenContextMenu(event, [
              { label: "Open link", icon: "chevron-up-right", onSelect: () => void openExternal(link.url) },
              { label: "Copy link", icon: "copy", onSelect: () => void onCopyText?.(link.url) },
              { label: "Copy link text", icon: "copy", onSelect: () => void onCopyText?.(label) }
            ], label);
          }}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            void openExternal(link.url);
          }}
        >
          {label}
        </a>
      );
      if (link.trailing) {
        nodes.push(link.trailing);
      }
      linkIndex += 1;
    } else if (boldText) {
      nodes.push(<strong key={`${matchStart}-bold`}>{boldText}</strong>);
    } else if (italicText) {
      nodes.push(<em key={`${matchStart}-italic`}>{italicText}</em>);
    } else {
      nodes.push(rawMatch);
    }

    index = matchStart + rawMatch.length;
  }

  if (index < text.length) {
    nodes.push(text.slice(index));
  }

  return <>{nodes}</>;
}
