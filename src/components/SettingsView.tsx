import { useEffect, useState } from "react";
import type { WorkspaceSettings } from "../types";
import type { AppUpdate, DownloadProgress } from "../updater";
import { settingsUpdateMessage, type UpdateStatus } from "../lib/updateMessages";
import type { SlackNotificationKey } from "../lib/constants";
import { Icon, Spinner } from "./icons";
import { isEditableTextControl, textControlContextItems, type OpenContextMenu } from "./contextMenu";

export function SettingsView({
  settings,
  workspacePath,
  onSave,
  onReload,
  updaterAvailable,
  updateInfo,
  updateMessage,
  updateProgress,
  updateStatus,
  onCheckForUpdates,
  onInstallUpdate,
  onRestartAfterUpdate,
  onOpenContextMenu,
  onCopyText
}: {
  settings: WorkspaceSettings;
  workspacePath: string;
  onSave: (settings: WorkspaceSettings) => Promise<void>;
  onReload: () => Promise<void>;
  updaterAvailable: boolean;
  updateInfo: AppUpdate | null;
  updateMessage: string;
  updateProgress: DownloadProgress | null;
  updateStatus: UpdateStatus;
  onCheckForUpdates: (showNoUpdate?: boolean) => Promise<AppUpdate | null>;
  onInstallUpdate: () => Promise<void>;
  onRestartAfterUpdate: () => Promise<void>;
  onOpenContextMenu: OpenContextMenu;
  onCopyText: (text: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState(settings);
  const [reloading, setReloading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => setDraft(settings), [settings]);

  function setSlackNotification(key: SlackNotificationKey, enabled: boolean) {
    setDraft((current) => ({
      ...current,
      slackNotifications: {
        ...current.slackNotifications,
        [key]: enabled
      }
    }));
  }

  return (
    <section
      className="settings-page"
      onContextMenu={(event) => {
        if (isEditableTextControl(event.target)) {
          onOpenContextMenu(event, textControlContextItems(event.target));
          return;
        }
        onOpenContextMenu(event, [
          { label: "Save settings", icon: "save", disabled: saving, onSelect: () => void onSave(draft) },
          { label: "Reload workspace", icon: "refresh", disabled: reloading, onSelect: () => void onReload() },
          { label: "Copy workspace path", icon: "copy", onSelect: () => void onCopyText(workspacePath) },
          { type: "separator" },
          { label: "Check for updates", icon: "refresh", disabled: !updaterAvailable || updateStatus === "checking" || updateStatus === "downloading", onSelect: () => void onCheckForUpdates(true) }
        ], "Settings");
      }}
    >
      <header className="content-header settings-page-header">
        <div>
          <p className="eyebrow">Workspace</p>
          <h1>Settings</h1>
        </div>
        <div className="settings-header-actions">
          <button
            data-testid="reload-workspace"
            disabled={reloading}
            onClick={() => {
              setReloading(true);
              void onReload().finally(() => setReloading(false));
            }}
          >
            {reloading ? (
              <>
                <Spinner /> Reloading…
              </>
            ) : (
              <>
                <Icon name="refresh" /> Reload
              </>
            )}
          </button>
          <button
            className="primary"
            data-testid="save-settings"
            disabled={saving}
            onClick={() => {
              setSaving(true);
              void onSave(draft).finally(() => setSaving(false));
            }}
          >
            {saving ? (
              <>
                <Spinner /> Saving…
              </>
            ) : (
              "Save settings"
            )}
          </button>
        </div>
      </header>

      <section
        className="settings-section"
        aria-labelledby="workspace-settings-heading"
        onContextMenu={(event) => {
          if (isEditableTextControl(event.target)) {
            onOpenContextMenu(event, textControlContextItems(event.target));
            return;
          }
          onOpenContextMenu(event, [
            { label: "Save settings", icon: "save", disabled: saving, onSelect: () => void onSave(draft) },
            { label: "Copy workspace path", icon: "copy", onSelect: () => void onCopyText(workspacePath) },
            { label: "Reload workspace", icon: "refresh", disabled: reloading, onSelect: () => void onReload() }
          ], "Workspace");
        }}
      >
        <div className="settings-section-header">
          <p className="eyebrow">Workspace</p>
          <h2 id="workspace-settings-heading">General</h2>
        </div>
        <div className="settings-fields">
          <label>
            Workspace name
            <input value={draft.workspaceName} onChange={(event) => setDraft({ ...draft, workspaceName: event.target.value })} />
          </label>
          <label>
            Workspace folder
            <input className="settings-readonly-path" title={workspacePath} value={workspacePath} readOnly />
          </label>
        </div>
      </section>

      <section
        className="settings-section"
        aria-labelledby="slack-settings-heading"
        onContextMenu={(event) => {
          if (isEditableTextControl(event.target)) {
            onOpenContextMenu(event, textControlContextItems(event.target));
            return;
          }
          onOpenContextMenu(event, [
            { label: "Save settings", icon: "save", disabled: saving, onSelect: () => void onSave(draft) },
            {
              label: "Copy webhook URL",
              icon: "copy",
              disabled: !draft.slackWebhookUrl.trim(),
              onSelect: () => void onCopyText(draft.slackWebhookUrl)
            }
          ], "Slack");
        }}
      >
        <div className="settings-section-header">
          <p className="eyebrow">Slack</p>
          <h2 id="slack-settings-heading">Notifications</h2>
        </div>
        <div className="settings-fields">
          <label>
            Incoming webhook URL
            <input
              data-testid="slack-webhook-input"
              value={draft.slackWebhookUrl}
              onChange={(event) => setDraft({ ...draft, slackWebhookUrl: event.target.value })}
              placeholder="https://hooks.slack.com/services/..."
            />
          </label>
          <div className="settings-toggle-grid" aria-label="Slack notification events">
            <label className="settings-toggle">
              <input
                checked={draft.slackNotifications.cardMovedToDone}
                data-testid="slack-notify-card-moved"
                type="checkbox"
                onChange={(event) => setSlackNotification("cardMovedToDone", event.target.checked)}
              />
              Card moved to Done
            </label>
            <label className="settings-toggle">
              <input
                checked={draft.slackNotifications.cardCompleted}
                data-testid="slack-notify-card-completed"
                type="checkbox"
                onChange={(event) => setSlackNotification("cardCompleted", event.target.checked)}
              />
              Card marked complete
            </label>
            <label className="settings-toggle">
              <input
                checked={draft.slackNotifications.cardAssigned}
                data-testid="slack-notify-card-assigned"
                type="checkbox"
                onChange={(event) => setSlackNotification("cardAssigned", event.target.checked)}
              />
              Card assignment changed
            </label>
            <label className="settings-toggle">
              <input
                checked={draft.slackNotifications.subtaskCompleted}
                data-testid="slack-notify-subtask-completed"
                type="checkbox"
                onChange={(event) => setSlackNotification("subtaskCompleted", event.target.checked)}
              />
              Step marked complete
            </label>
          </div>
        </div>
      </section>

      <section
        className="settings-section settings-section-row"
        aria-labelledby="updates-heading"
        onContextMenu={(event) => onOpenContextMenu(event, [
          { label: "Check for updates", icon: "refresh", disabled: !updaterAvailable || updateStatus === "checking" || updateStatus === "downloading", onSelect: () => void onCheckForUpdates(true) },
          { label: "Install update", icon: "save", disabled: updateStatus !== "available", onSelect: () => void onInstallUpdate() },
          { label: "Restart Limn", icon: "refresh", disabled: updateStatus !== "restart-ready", onSelect: () => void onRestartAfterUpdate() }
        ], "Updates")}
      >
        <div className="settings-section-header">
          <p className="eyebrow">Application</p>
          <h2 id="updates-heading">Updates</h2>
          <p className={updateStatus === "error" ? "error" : "muted"} data-testid="update-status">
            {settingsUpdateMessage(updateStatus, updaterAvailable, updateInfo, updateMessage, updateProgress)}
          </p>
        </div>
        <div className="settings-actions">
          <button
            data-testid="check-updates"
            disabled={!updaterAvailable || updateStatus === "checking" || updateStatus === "downloading"}
            onClick={() => void onCheckForUpdates(true)}
          >
            {updateStatus === "checking" ? (
              <>
                <Spinner /> Checking…
              </>
            ) : (
              <>
                <Icon name="refresh" /> Check updates
              </>
            )}
          </button>
          {updateStatus === "available" && (
            <button className="primary" data-testid="settings-install-update" onClick={() => void onInstallUpdate()}>
              Install update
            </button>
          )}
          {updateStatus === "restart-ready" && (
            <button className="primary" data-testid="settings-restart-update" onClick={() => void onRestartAfterUpdate()}>
              Restart Limn
            </button>
          )}
        </div>
      </section>
    </section>
  );
}
