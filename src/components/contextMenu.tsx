import type { MouseEvent as ReactMouseEvent } from "react";
import { Icon, type IconName } from "./icons";

export type ContextMenuItem =
  | {
      type?: "item";
      label: string;
      icon?: IconName;
      danger?: boolean;
      disabled?: boolean;
      onSelect: () => void | Promise<void>;
    }
  | { type: "separator" };
export interface ContextMenuState {
  x: number;
  y: number;
  label?: string;
  items: ContextMenuItem[];
}
export type OpenContextMenu = (event: ReactMouseEvent<HTMLElement>, items: ContextMenuItem[], label?: string) => void;
export function ContextMenu({
  menu,
  onClose,
  onPick
}: {
  menu: ContextMenuState;
  onClose: () => void;
  onPick: (item: ContextMenuItem) => void;
}) {
  return (
    <div
      aria-label={menu.label ? `${menu.label} options` : "Context menu"}
      className="context-menu"
      data-testid="context-menu"
      role="menu"
      style={{ left: menu.x, top: menu.y }}
      onContextMenu={(event) => event.preventDefault()}
      onMouseDown={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {menu.label && <div className="context-menu-label">{menu.label}</div>}
      {menu.items.map((item, index) => {
        if (item.type === "separator") {
          return <div className="context-menu-separator" key={`separator-${index}`} role="separator" />;
        }

        return (
          <button
            className={item.danger ? "danger" : ""}
            disabled={item.disabled}
            key={`${item.label}-${index}`}
            role="menuitem"
            type="button"
            onClick={() => onPick(item)}
          >
            {item.icon && <Icon name={item.icon} />}
            <span>{item.label}</span>
          </button>
        );
      })}
      <button className="sr-only" type="button" onClick={onClose}>
        Close menu
      </button>
    </div>
  );
}

export function isEditableTextControl(value: EventTarget | null): value is HTMLInputElement | HTMLTextAreaElement {
  if (!(value instanceof HTMLInputElement || value instanceof HTMLTextAreaElement)) {
    return false;
  }

  if (value instanceof HTMLTextAreaElement) {
    return true;
  }

  return ["", "email", "password", "search", "tel", "text", "url"].includes(value.type);
}

export function textControlContextItems(control: HTMLInputElement | HTMLTextAreaElement): ContextMenuItem[] {
  const selection = getTextSelection(control);
  const hasSelection = selection.start !== selection.end;
  const editable = !control.readOnly && !control.disabled;

  return [
    {
      label: "Cut",
      icon: "clipboard",
      disabled: !editable || !hasSelection,
      onSelect: async () => {
        await writeClipboard(control.value.slice(selection.start, selection.end));
        replaceTextControlSelection(control, "");
      }
    },
    {
      label: "Copy",
      icon: "copy",
      disabled: !hasSelection,
      onSelect: () => writeClipboard(control.value.slice(selection.start, selection.end))
    },
    {
      label: "Paste",
      icon: "clipboard",
      disabled: !editable || !navigator.clipboard?.readText,
      onSelect: async () => {
        const text = await navigator.clipboard.readText();
        replaceTextControlSelection(control, text);
      }
    },
    {
      label: "Select all",
      icon: "check",
      disabled: control.value.length === 0,
      onSelect: () => {
        control.focus();
        control.select();
      }
    }
  ];
}

export function getTextSelection(control: HTMLInputElement | HTMLTextAreaElement): { start: number; end: number } {
  return {
    start: control.selectionStart ?? 0,
    end: control.selectionEnd ?? 0
  };
}

export function replaceTextControlSelection(control: HTMLInputElement | HTMLTextAreaElement, text: string) {
  const selection = getTextSelection(control);
  const nextValue = `${control.value.slice(0, selection.start)}${text}${control.value.slice(selection.end)}`;
  const nextCursor = selection.start + text.length;
  setNativeControlValue(control, nextValue);
  control.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: text ? "insertText" : "deleteContentBackward", data: text }));
  window.requestAnimationFrame(() => {
    control.focus();
    control.setSelectionRange(nextCursor, nextCursor);
  });
}

export function setNativeControlValue(control: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const prototype = Object.getPrototypeOf(control) as HTMLInputElement | HTMLTextAreaElement;
  const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
  if (descriptor?.set) {
    descriptor.set.call(control, value);
    return;
  }
  control.value = value;
}

export async function writeClipboard(text: string) {
  if (!navigator.clipboard?.writeText) {
    return;
  }
  await navigator.clipboard.writeText(text);
}
