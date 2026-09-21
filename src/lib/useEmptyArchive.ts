import { useRef, useState } from "react";
import type { Card } from "../types";
import type { ConfirmDialogState } from "../components/dialogs";
import { deleteCard } from "../storage.js";
import { countLabel, errorText } from "./format.js";

interface EmptyArchiveOptions {
  workspacePath: string;
  cards: Card[];
  onConfirm: (dialog: ConfirmDialogState) => void;
  onStart: () => void;
  onDeleted: (ids: Set<string>) => void;
  onFinished: (message: string, warning: boolean) => Promise<void>;
  onError: (message: string) => void;
}

export function useEmptyArchive(options: EmptyArchiveOptions) {
  const latest = useRef(options);
  latest.current = options;
  const running = useRef(false);
  const [progress, setProgress] = useState<{ path: string; done: number; total: number } | null>(null);

  function requestEmptyArchive() {
    const { workspacePath, cards, onConfirm } = latest.current;
    // Capture exactly the versions and scope the user is about to confirm.
    const targets = cards.filter((card) => card.archived);
    if (!workspacePath || !targets.length || running.current) return;
    onConfirm({
      title: "Empty archive?",
      message: `Permanently delete all ${countLabel(targets.length, "archived card")} across every board in this workspace? This removes their card files and attachments from disk, including cards hidden by search or board filters. This cannot be undone. Active cards will be kept.`,
      confirmLabel: `Delete ${countLabel(targets.length, "card")} forever`,
      destructive: true,
      onConfirm: async () => {
        if (running.current || latest.current.workspacePath !== workspacePath) return;
        running.current = true;
        latest.current.onStart();
        setProgress({ path: workspacePath, done: 0, total: targets.length });
        let deleted = 0;
        let changed = 0;
        let failed = 0;
        let firstError = "";
        try {
          // Bound concurrent IPC/filesystem work for archives with thousands of cards.
          // Settle every delete so one failure never hides other successful deletions.
          for (let offset = 0; offset < targets.length; offset += 20) {
            const batch = targets.slice(offset, offset + 20);
            const results = await Promise.allSettled(batch.map((card) => deleteCard(workspacePath, card)));
            const ids = new Set<string>();
            results.forEach((result, index) => {
              if (result.status === "rejected") {
                failed++;
                firstError ||= errorText(result.reason);
              } else if (result.value.status !== "written") {
                changed++;
              } else {
                deleted++;
                ids.add(batch[index].id);
              }
            });
            if (latest.current.workspacePath === workspacePath) latest.current.onDeleted(ids);
            setProgress({ path: workspacePath, done: offset + batch.length, total: targets.length });
          }
          if (latest.current.workspacePath === workspacePath) {
            const message = [
              `Permanently deleted ${countLabel(deleted, "archived card")}.`,
              changed ? `${countLabel(changed, "card")} changed on disk and ${changed === 1 ? "was" : "were"} kept. Review under Conflicts.` : "",
              failed ? `${countLabel(failed, "card")} could not be deleted. Try again. ${firstError}` : ""
            ].filter(Boolean).join(" ");
            await latest.current.onFinished(message, changed > 0 || failed > 0);
          }
        } catch (reason) {
          if (latest.current.workspacePath === workspacePath) latest.current.onError(errorText(reason));
        } finally {
          running.current = false;
          setProgress(null);
        }
      }
    });
  }

  return {
    running,
    requestEmptyArchive,
    emptying: progress !== null,
    progress: progress?.path === options.workspacePath ? progress : null
  };
}
