import { useEffect, useRef, useState } from "react";
import { MAX_NAME_LENGTH } from "../lib/constants";
import { useModalKeys } from "../lib/useModalKeys";

export interface TextDialogState {
  title: string;
  label: string;
  value: string;
  confirmLabel: string;
  onSubmit: (value: string) => Promise<void>;
  // Optional extra validation run on submit (e.g. duplicate-name checks).
  // Return an error message to block submission, or null to allow it.
  validate?: (value: string) => string | null;
}
export interface ConfirmDialogState {
  title: string;
  message: string;
  confirmLabel: string;
  destructive?: boolean;
  onConfirm: () => Promise<void>;
}
export function EmptyState({ title, body, action, onAction }: { title: string; body: string; action: string; onAction: () => void | Promise<void> }) {
  return (
    <div className="empty-state">
      <h2>{title}</h2>
      <p>{body}</p>
      <button className="primary" onClick={() => void onAction()}>
        {action}
      </button>
    </div>
  );
}
export function TextDialog({
  dialog,
  onCancel,
  onChange,
  onSubmit
}: {
  dialog: TextDialogState;
  onCancel: () => void;
  onChange: (value: string) => void;
  onSubmit: (value: string) => Promise<void>;
}) {
  const [validation, setValidation] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [dialog.title]);
  useModalKeys(formRef, onCancel);

  return (
    <div className="dialog-backdrop" onMouseDown={onCancel}>
      <form
        aria-labelledby="text-dialog-title"
        aria-modal="true"
        className="text-dialog"
        noValidate
        ref={formRef}
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          const value = dialog.value.trim();
          if (!value) {
            setValidation(`${dialog.label} is required.`);
            return;
          }
          const problem = dialog.validate?.(value);
          if (problem) {
            setValidation(problem);
            return;
          }
          setValidation("");
          void onSubmit(value);
        }}
        role="dialog"
      >
        <header>
          <h2 id="text-dialog-title">{dialog.title}</h2>
          <button type="button" onClick={onCancel}>Cancel</button>
        </header>
        <label>
          {dialog.label}
          <input
            aria-describedby={validation ? "text-dialog-error" : undefined}
            aria-invalid={validation ? true : undefined}
            data-testid="text-dialog-input"
            maxLength={MAX_NAME_LENGTH}
            ref={inputRef}
            value={dialog.value}
            onChange={(event) => {
              onChange(event.target.value);
              if (validation) {
                setValidation("");
              }
            }}
          />
        </label>
        {validation && <p className="form-error" id="text-dialog-error">{validation}</p>}
        <footer>
          <button type="button" onClick={onCancel}>Cancel</button>
          <button className="primary" data-testid="text-dialog-submit" disabled={!dialog.value.trim()} type="submit">
            {dialog.confirmLabel}
          </button>
        </footer>
      </form>
    </div>
  );
}
export function ConfirmDialog({
  dialog,
  onCancel,
  onConfirm
}: {
  dialog: ConfirmDialogState;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
}) {
  const confirmRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // For destructive actions, default focus to Cancel so a reflexive Enter
    // doesn't immediately confirm; otherwise focus the confirm button.
    if (dialog.destructive) {
      cancelRef.current?.focus();
    } else {
      confirmRef.current?.focus();
    }
  }, [dialog.title, dialog.destructive]);
  useModalKeys(dialogRef, onCancel);

  return (
    <div className="dialog-backdrop" onMouseDown={onCancel}>
      <div
        aria-describedby="confirm-dialog-message"
        aria-labelledby="confirm-dialog-title"
        aria-modal="true"
        className="text-dialog"
        ref={dialogRef}
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        <header>
          <h2 id="confirm-dialog-title">{dialog.title}</h2>
          <button type="button" onClick={onCancel}>Cancel</button>
        </header>
        <p id="confirm-dialog-message">{dialog.message}</p>
        <footer>
          <button ref={cancelRef} type="button" onClick={onCancel}>Cancel</button>
          <button
            className={dialog.destructive ? "danger" : "primary"}
            data-testid="confirm-dialog-submit"
            ref={confirmRef}
            type="button"
            onClick={() => void onConfirm()}
          >
            {dialog.confirmLabel}
          </button>
        </footer>
      </div>
    </div>
  );
}
