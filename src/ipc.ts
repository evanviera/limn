import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { listen as tauriListen } from "@tauri-apps/api/event";
import type { Event as TauriEvent } from "@tauri-apps/api/event";

type Listener<T = unknown> = (event: TauriEvent<T>) => void;

export interface LimnTestIpc {
  invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>;
  listen<T = unknown>(event: string, handler: Listener<T>): Promise<() => void>;
}

declare global {
  interface Window {
    __LIMN_TEST_IPC__?: LimnTestIpc;
  }
}

export async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (window.__LIMN_TEST_IPC__) {
    return window.__LIMN_TEST_IPC__.invoke<T>(command, args);
  }
  return tauriInvoke<T>(command, args);
}

export async function listen<T = unknown>(event: string, handler: Listener<T>): Promise<() => void> {
  if (window.__LIMN_TEST_IPC__) {
    return window.__LIMN_TEST_IPC__.listen<T>(event, handler);
  }
  return tauriListen<T>(event, handler);
}
