import type { AppUpdate, DownloadProgress } from "../updater";

export type UpdateStatus = "idle" | "checking" | "available" | "downloading" | "restart-ready" | "not-available" | "error";
export function updateBannerMessage(status: UpdateStatus, update: AppUpdate | null, message: string, progress: DownloadProgress | null): string {
  if (status === "available" && update) {
    return `Limn ${update.version} is available. ${message}`;
  }
  if (status === "downloading" && update) {
    return `Installing Limn ${update.version}... ${formatDownloadProgress(progress)}`;
  }
  if (status === "restart-ready") {
    return message || "Update installed. Restart Limn to finish.";
  }
  if (status === "error") {
    return message || "Update failed.";
  }
  return message;
}

export function settingsUpdateMessage(
  status: UpdateStatus,
  updaterAvailable: boolean,
  update: AppUpdate | null,
  message: string,
  progress: DownloadProgress | null
): string {
  if (!updaterAvailable) {
    return "Update checks are available in the desktop app.";
  }
  if (status === "checking") {
    return "Checking GitHub Releases for a newer version.";
  }
  if (status === "available" && update) {
    return `Limn ${update.version} is available. ${message}`;
  }
  if (status === "downloading" && update) {
    return `Installing Limn ${update.version}. ${formatDownloadProgress(progress)}`;
  }
  if (status === "restart-ready") {
    return message || "Update installed. Restart Limn to finish.";
  }
  if (status === "not-available") {
    return message || "Limn is up to date.";
  }
  if (status === "error") {
    return message || "Update failed.";
  }
  return "Limn checks GitHub Releases for signed updates.";
}

export function formatDownloadProgress(progress: DownloadProgress | null): string {
  if (!progress) {
    return "";
  }
  if (!progress.total) {
    return `${formatBytes(progress.downloaded)} downloaded.`;
  }
  const percent = Math.min(100, Math.round((progress.downloaded / progress.total) * 100));
  return `${percent}% (${formatBytes(progress.downloaded)} of ${formatBytes(progress.total)}).`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const kib = bytes / 1024;
  if (kib < 1024) {
    return `${kib.toFixed(1)} KB`;
  }
  return `${(kib / 1024).toFixed(1)} MB`;
}
