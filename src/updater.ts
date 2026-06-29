import { check, type DownloadEvent, type Update } from "@tauri-apps/plugin-updater";
import { invoke } from "./ipc";

export interface AppUpdate {
  version: string;
  currentVersion: string;
  date?: string;
  body?: string;
}

export interface DownloadProgress {
  downloaded: number;
  total?: number;
}

interface LimnTestUpdater {
  check(): Promise<AppUpdate | null>;
  install(onProgress?: (progress: DownloadProgress) => void): Promise<void>;
  restart(): Promise<void>;
}

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
    __LIMN_TEST_UPDATER__?: LimnTestUpdater;
  }
}

let pendingUpdate: Update | null = null;

export function canUseUpdater(): boolean {
  return Boolean(window.__LIMN_TEST_UPDATER__ || (!window.__LIMN_TEST_IPC__ && window.__TAURI_INTERNALS__));
}

export async function checkForUpdate(): Promise<AppUpdate | null> {
  if (window.__LIMN_TEST_UPDATER__) {
    return window.__LIMN_TEST_UPDATER__.check();
  }

  if (!canUseUpdater()) {
    return null;
  }

  const update = await check();
  pendingUpdate = update;
  return update ? toAppUpdate(update) : null;
}

export async function installUpdate(onProgress?: (progress: DownloadProgress) => void): Promise<void> {
  if (window.__LIMN_TEST_UPDATER__) {
    await window.__LIMN_TEST_UPDATER__.install(onProgress);
    return;
  }

  if (!pendingUpdate) {
    throw new Error("No update is ready to install.");
  }

  let downloaded = 0;
  let total: number | undefined;
  await pendingUpdate.downloadAndInstall((event: DownloadEvent) => {
    switch (event.event) {
      case "Started":
        total = event.data.contentLength;
        onProgress?.({ downloaded, total });
        break;
      case "Progress":
        downloaded += event.data.chunkLength;
        onProgress?.({ downloaded, total });
        break;
      case "Finished":
        onProgress?.({ downloaded: total ?? downloaded, total });
        break;
    }
  });
  pendingUpdate = null;
}

export async function restartApp(): Promise<void> {
  if (window.__LIMN_TEST_UPDATER__) {
    await window.__LIMN_TEST_UPDATER__.restart();
    return;
  }

  await invoke("restart_app");
}

function toAppUpdate(update: Update): AppUpdate {
  return {
    version: update.version,
    currentVersion: update.currentVersion,
    date: update.date,
    body: update.body
  };
}
