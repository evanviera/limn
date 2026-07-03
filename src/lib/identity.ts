import type { Member } from "../types";

// The "active member" is who *you* are among the project's members. It drives
// comment attribution. Because a workspace folder is synced across people and
// devices, this choice is intentionally device-local (localStorage), not part of
// the synced workspace files — otherwise everyone sharing the folder would appear
// as the same person. Keyed by workspace path so each open workspace remembers
// its own identity.
const ACTIVE_MEMBER_KEY_PREFIX = "limn-active-member:";

function activeMemberStorageKey(workspacePath: string): string {
  return `${ACTIVE_MEMBER_KEY_PREFIX}${workspacePath}`;
}

export function readActiveMemberId(workspacePath: string): string {
  if (!workspacePath) {
    return "";
  }
  try {
    return localStorage.getItem(activeMemberStorageKey(workspacePath)) ?? "";
  } catch {
    return "";
  }
}

export function writeActiveMemberId(workspacePath: string, memberId: string): void {
  if (!workspacePath) {
    return;
  }
  try {
    if (memberId) {
      localStorage.setItem(activeMemberStorageKey(workspacePath), memberId);
    } else {
      localStorage.removeItem(activeMemberStorageKey(workspacePath));
    }
  } catch {
    // Ignore storage failures (e.g. private mode); identity simply won't persist.
  }
}

// Resolve the stored identity against the current member list. Returns null when
// nothing is selected or the selected member no longer exists (e.g. removed on
// another device); callers treat that as "identity not set".
export function resolveActiveMember(members: Member[], activeMemberId: string): Member | null {
  if (!activeMemberId) {
    return null;
  }
  return members.find((member) => member.id === activeMemberId) ?? null;
}
