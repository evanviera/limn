import { useEffect, useRef } from "react";

// Tracks the order in which modals open so that only the topmost one responds
// to Escape/Tab. Without this, stacked dialogs (e.g. the card editor with a
// delete confirm on top) each register a document listener and Escape fires
// every handler at once, dismissing the wrong layer.
export const modalStack: symbol[] = [];

export function useModalKeys(containerRef: { readonly current: HTMLElement | null }, onClose: () => void) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const id = Symbol("modal");
    modalStack.push(id);
    // Remember what was focused before the modal opened so we can restore it.
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
      ).filter((element) => !element.hasAttribute("disabled") && element.tabIndex !== -1);
      if (focusable.length === 0) {
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !node.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      const index = modalStack.lastIndexOf(id);
      if (index !== -1) {
        modalStack.splice(index, 1);
      }
      // Return focus to the opener so keyboard/screen-reader users keep their place.
      if (previousActive && document.contains(previousActive)) {
        previousActive.focus();
      }
    };
    // Mount/unmount only: onClose is read through a ref so re-renders don't
    // churn the modal stack or capture a fresh "previously focused" element.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containerRef]);
}
