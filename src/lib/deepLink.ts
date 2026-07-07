// Deep links let a card be shared as clickable text (Slack, email, …) that opens
// the card in the recipient's Limn app. The link only carries the card id — the
// app resolves it by searching the workspaces the recipient already has open, so
// no card data ever travels in the URL. Format: `limn://card/<cardId>`.

export const CARD_LINK_PREFIX = "limn://card/";

// Build the shareable link for a card.
export function cardDeepLink(cardId: string): string {
  return `${CARD_LINK_PREFIX}${encodeURIComponent(cardId)}`;
}

// Parse a `limn://card/<cardId>` link back to its card id, or null when the
// string isn't a card link (wrong scheme/host, empty or unsafe id). Ids never
// contain path separators — a card is stored as `cards/<id>.md` — so we reject
// anything that could escape that directory before it reaches the filesystem.
export function parseCardDeepLink(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed.toLowerCase().startsWith(CARD_LINK_PREFIX)) {
    return null;
  }
  const raw = trimmed.slice(CARD_LINK_PREFIX.length);
  let cardId: string;
  try {
    cardId = decodeURIComponent(raw);
  } catch {
    return null;
  }
  if (!cardId || cardId.includes("/") || cardId.includes("\\") || cardId.includes("..")) {
    return null;
  }
  return cardId;
}
