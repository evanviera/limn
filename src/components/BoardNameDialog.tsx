import { useEffect, useRef, useState } from "react";
import type { Board, BoardGroup } from "../types";
import { Icon } from "./icons.js";
import { MAX_NAME_LENGTH } from "../lib/constants.js";
import { boardNameError, effectiveBoardGroupId } from "../lib/boardNames.js";
import { useModalKeys } from "../lib/useModalKeys.js";

export interface BoardNameRequest {
  boardId?: string;
  groupId?: string;
}

export function BoardNameDialog({ request, boards, groups, onCancel, onSave }: {
  request: BoardNameRequest;
  boards: Board[];
  groups: BoardGroup[];
  onCancel: () => void;
  onSave: (name: string, groupId?: string, boardId?: string) => Promise<void>;
}) {
  const board = boards.find((item) => item.id === request.boardId);
  const editing = Boolean(request.boardId);
  const [name, setName] = useState(board?.name ?? "");
  const [chosenGroupId, setChosenGroupId] = useState(request.groupId);
  const groupId = effectiveBoardGroupId(editing && board ? board : { groupId: chosenGroupId }, groups);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const close = () => { if (!savingRef.current) onCancel(); };
  useModalKeys(formRef, close);
  useEffect(() => { inputRef.current?.focus(); inputRef.current?.select(); }, []);

  async function submit() {
    if (savingRef.current) return;
    const value = name.trim();
    const problem = !value ? "Board name is required."
      : editing && !board ? "This board no longer exists."
      : boardNameError(boards, groups, value, groupId, board?.id);
    if (problem) { setError(problem); return; }
    setError("");
    savingRef.current = true;
    setSaving(true);
    try {
      await onSave(value, groupId, request.boardId);
      onCancel();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  return (
    <div className="dialog-backdrop" onMouseDown={close}>
      <form aria-labelledby="board-name-title" aria-modal="true" className="text-dialog" data-testid="board-name-dialog"
        ref={formRef} role="dialog" onMouseDown={(event) => event.stopPropagation()}
        onSubmit={(event) => { event.preventDefault(); void submit(); }}>
        <header>
          <h2 id="board-name-title">{editing ? "Rename board" : "Create board"}</h2>
          <button aria-label="Close dialog" className="icon-button" disabled={saving} type="button" onClick={close}><Icon name="x" /></button>
        </header>
        <label>Board name
          <input ref={inputRef} data-testid="text-dialog-input" maxLength={MAX_NAME_LENGTH} disabled={saving}
            aria-invalid={Boolean(error)} aria-describedby={error ? "board-name-error" : undefined}
            value={name} onChange={(event) => { setName(event.target.value); setError(""); }} />
        </label>
        {!editing && groups.length > 0 && (
          <label>Category
            <select data-testid="board-name-category" disabled={saving} value={groupId ?? ""}
              onChange={(event) => { setChosenGroupId(event.target.value || undefined); setError(""); }}>
              <option value="">Ungrouped</option>
              {groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
            </select>
          </label>
        )}
        {error && <p className="form-error" id="board-name-error" role="alert">{error}</p>}
        <footer>
          <button disabled={saving} type="button" onClick={close}>Cancel</button>
          <button className="primary" data-testid="text-dialog-submit" disabled={saving || !name.trim() || (editing && !board)} type="submit">
            {saving ? "Saving…" : editing ? "Save board" : "Create board"}
          </button>
        </footer>
      </form>
    </div>
  );
}
