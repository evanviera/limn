import { normalizeUrl } from "../storage";

export const NOTE_INLINE_PATTERN = /\[([^\]\n]+)\]\(([^)\s]+)\)|\*\*([^*\n]+)\*\*|\*([^*\n]+)\*|((?:https?:\/\/|www\.)[^\s<]+)/gi;

export function buildNoteLink(rawUrl: string): { url: string; href: string; trailing: string } | null {
  let url = rawUrl.trim();
  let trailing = "";

  while (/[)\].,!?;:}]$/.test(url)) {
    trailing = `${url.slice(-1)}${trailing}`;
    url = url.slice(0, -1);
  }

  const isWebUrl = /^(https?:\/\/|www\.)/i.test(url) || /^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}(?:[/:?#][^\s<]*)?$/i.test(url);
  if (!url || !isWebUrl) {
    return null;
  }

  const href = normalizeUrl(url);
  return /^https?:\/\//i.test(href) ? { url, href, trailing } : null;
}

export function renderNoteEditorHtml(text: string): string {
  let html = "";
  let index = 0;

  NOTE_INLINE_PATTERN.lastIndex = 0;
  for (const match of text.matchAll(NOTE_INLINE_PATTERN)) {
    const matchStart = match.index ?? 0;
    const rawMatch = match[0];
    if (matchStart > index) {
      html += escapeNoteHtml(text.slice(index, matchStart));
    }

    const markdownLabel = match[1];
    const markdownUrl = match[2];
    const boldText = match[3];
    const italicText = match[4];
    const bareUrl = match[5];
    const link = buildNoteLink(markdownUrl || bareUrl || "");

    if (link) {
      html += noteAnchorHtml(markdownLabel || link.url, link, Boolean(bareUrl));
      if (link.trailing) {
        html += escapeNoteHtml(link.trailing);
      }
    } else if (boldText) {
      html += `<strong>${escapeNoteHtml(boldText)}</strong>`;
    } else if (italicText) {
      html += `<em>${escapeNoteHtml(italicText)}</em>`;
    } else {
      html += escapeNoteHtml(rawMatch);
    }

    index = matchStart + rawMatch.length;
  }

  if (index < text.length) {
    html += escapeNoteHtml(text.slice(index));
  }

  return html;
}

export function noteAnchorHtml(label: string, link: { url: string; href: string }, bare: boolean): string {
  return `<a href="${escapeNoteAttribute(link.href)}" data-note-link="true" data-note-url="${escapeNoteAttribute(link.url)}" data-note-original-text="${escapeNoteAttribute(label)}" data-note-bare="${bare ? "true" : "false"}" contenteditable="false" tabindex="0">${escapeNoteHtml(label)}</a>`;
}

export function escapeNoteHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br>");
}

export function escapeNoteAttribute(value: string): string {
  return escapeNoteHtml(value).replace(/"/g, "&quot;");
}

export function serializeNoteEditor(root: HTMLElement): string {
  const output = Array.from(root.childNodes).map(serializeNoteNode).join("");
  return output.endsWith("\n") ? output.slice(0, -1) : output;
}

export function noteEditorHtmlMatches(root: HTMLElement, html: string): boolean {
  const template = document.createElement("template");
  template.innerHTML = html;
  const currentNodes = Array.from(root.childNodes);
  const nextNodes = Array.from(template.content.childNodes);
  return currentNodes.length === nextNodes.length && currentNodes.every((node, index) => node.isEqualNode(nextNodes[index]));
}

export function serializeNoteNode(node: ChildNode): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent?.replace(/\u00a0/g, " ") ?? "";
  }

  if (!(node instanceof HTMLElement)) {
    return "";
  }

  const tagName = node.tagName.toLowerCase();
  if (tagName === "br") {
    return "\n";
  }

  if (tagName === "a" && node.dataset.noteLink === "true") {
    const label = serializeNoteChildren(node) || node.dataset.noteOriginalText || node.dataset.noteUrl || node.getAttribute("href") || "";
    const url = node.dataset.noteUrl || node.getAttribute("href") || "";
    if (node.dataset.noteBare === "true" && label === node.dataset.noteOriginalText) {
      return label;
    }
    return `[${escapeMarkdownLinkLabel(label)}](${normalizeUrl(url)})`;
  }

  if (tagName === "strong" || tagName === "b") {
    return `**${serializeNoteChildren(node)}**`;
  }

  if (tagName === "em" || tagName === "i") {
    return `*${serializeNoteChildren(node)}*`;
  }

  if (tagName === "div" || tagName === "p") {
    return `${serializeNoteChildren(node)}\n`;
  }

  return serializeNoteChildren(node);
}

export function serializeNoteChildren(node: HTMLElement): string {
  return Array.from(node.childNodes).map(serializeNoteNode).join("");
}

export function escapeMarkdownLinkLabel(label: string): string {
  return label.replace(/\]/g, "\\]");
}

export function clampNumber(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function noteEditorRange(editor: HTMLElement): Range | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) {
    return null;
  }

  const range = selection.getRangeAt(0);
  if (!editor.contains(range.commonAncestorContainer)) {
    return null;
  }

  return range;
}

export function endOfNoteEditorRange(editor: HTMLElement): Range {
  const range = document.createRange();
  range.selectNodeContents(editor);
  range.collapse(false);
  return range;
}

export function selectNoteNodeContents(node: Node) {
  const selection = window.getSelection();
  if (!selection) {
    return;
  }

  const range = document.createRange();
  range.selectNodeContents(node);
  selection.removeAllRanges();
  selection.addRange(range);
}
