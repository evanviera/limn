---
name: card-deep-links
description: How Limn's limn:// card deep links work and the dev-mode testing caveat
metadata:
  type: project
---

Limn supports shareable card links: `limn://card/<cardId>`. Right-click a card (or open it) → "Copy card link". Clicking such a link elsewhere opens the card in the recipient's running Limn.

Design (chosen 2026-07-07): the link carries **only the card id** — no card data travels in the URL. On open, `handleDeepLink` in `App.tsx` resolves it by searching the workspaces the user currently has open: the active one in memory first, then the rest via the `find_card_workspace` Rust command (a plain `cards/<id>.md` file-existence check, since cards are keyed by id). Not found → a banner tells them to open the containing workspace and click again. Pure helpers live in `src/lib/deepLink.ts`.

Wiring: `tauri-plugin-deep-link` + `tauri-plugin-single-instance` (registered first) in `lib.rs`; scheme declared in `tauri.conf.json` (`plugins.deep-link.desktop.schemes`) and `deep-link:default` capability. Backend emits a `"deep-link"` event the frontend listens for.

**Caveat — can't test via `npm run dev` on macOS:** the OS only associates the `limn://` scheme with the app from a bundled/installed build, so a real link click won't route in dev. Exercise the handler instead through the E2E harness (`emitDeepLink` control command → emits the `deep-link` event); see the deep-link tests in `tests/e2e/integrations.spec.ts`. To test the real OS handoff, build/install the app first.
