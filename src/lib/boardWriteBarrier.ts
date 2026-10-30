// Board changes appear optimistically. A disk snapshot captured before (or
// during) a save must never overwrite them, even if the read finishes later.
export class BoardWriteBarrier {
  private workspaces = new Map<string, { revision: number; pending: Set<Promise<unknown>> }>();

  private workspace(path: string) {
    let state = this.workspaces.get(path);
    if (!state) {
      state = { revision: 0, pending: new Set() };
      this.workspaces.set(path, state);
    }
    return state;
  }

  async save<T>(path: string, write: () => Promise<T>): Promise<T> {
    const state = this.workspace(path);
    state.revision += 1;
    const pending = write();
    state.pending.add(pending);
    try {
      return await pending;
    } finally {
      state.pending.delete(pending);
    }
  }

  async read<T>(path: string, read: () => Promise<T>, isCurrent: () => boolean): Promise<T | undefined> {
    const state = this.workspace(path);
    while (isCurrent()) {
      // A failed save must not strand refreshes. Its caller reports the error;
      // a fresh disk read restores the actual persisted state.
      await Promise.allSettled([...state.pending]);
      if (!isCurrent()) return;
      if (state.pending.size > 0) continue;
      const revision = state.revision;
      const data = await read();
      if (!isCurrent()) return;
      if (revision === state.revision && state.pending.size === 0) return data;
      // An edit overtook this snapshot. Read again after its save settles so
      // external changes are still reconciled, rather than ignored.
    }
  }
}
