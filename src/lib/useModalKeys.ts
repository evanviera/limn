import { useLayoutEffect, useRef } from "react";

// Tracks the order in which modals open so that only the topmost one responds
// to Escape/Tab. Without this, stacked dialogs (e.g. the card editor with a
// delete confirm on top) each register a document listener and Escape fires
// every handler at once, dismissing the wrong layer.
export const modalStack: symbol[] = [];

export function useModalKeys(containerRef: { readonly current: HTMLElement | null }, onClose: () => void) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useLayoutEffect(() => {
    const id = Symbol("modal");
    modalStack.push(id);
    // Capture before passive autofocus effects move focus into the modal.
    const previousActive = document.activeElement as HTMLElement | null;

    function isTopmost() {
      return modalStack[modalStack.length - 1] === id;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (!isTopmost()) {
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") {
        return;
      }
      const node = containerRef.current;
      if (!node) {
        return;
      }
      const focusable = Array.from(
        node.querySelectorAll<HTMLElement>(
          'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])'
        )
      ).filter((element) => !element.matches(':disabled, [hidden], [aria-hidden="true"]') && element.tabIndex !== -1 && element.getClientRects().length > 0);
      if (focusable.length === 0) {
        event.preventDefault();
        node.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !node.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !node.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      const wasTopmost = isTopmost();
      const index = modalStack.lastIndexOf(id);
      if (index !== -1) {
        modalStack.splice(index, 1);
      }
      // Return focus to the opener so keyboard/screen-reader users keep their place.
      if (wasTopmost && previousActive && document.contains(previousActive)) {
        previousActive.focus();
      }
    };
    // Mount/unmount only: onClose is read through a ref so re-renders don't
    // churn the modal stack or capture a fresh "previously focused" element.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containerRef]);
}
