export interface TaskCheckpoint {
  id: string;
  runId: string | null;
  conversationId: string | null;
  userId: string | null;
  userText: string | null;
  primaryModelKey: string | null;
  attemptedModels: string[];
  reason: string;
  fallbackReason: string | null;
  /** Mode policy saat checkpoint dibuat — wajib read-only agar aman. */
  policyMode: "read-only" | "write";
  status: "waiting_quota";
  nextRetryAt: string | null;
  createdAt: string;
}

export class CheckpointStore {
  private items = new Map<string, TaskCheckpoint>();

  save(input: Omit<TaskCheckpoint, "id" | "createdAt" | "status"> & { id?: string }): TaskCheckpoint {
    const id = input.id ?? `ckpt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const cp: TaskCheckpoint = {
      ...input,
      id,
      status: "waiting_quota",
      createdAt: new Date().toISOString(),
      // Paksa read-only: pemulihan tidak boleh mengaktifkan write tools.
      policyMode: "read-only",
    };
    this.items.set(id, cp);
    return cp;
  }

  get(id: string): TaskCheckpoint | null {
    return this.items.get(id) ?? null;
  }

  list(): TaskCheckpoint[] {
    return [...this.items.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  remove(id: string): boolean {
    return this.items.delete(id);
  }

  clear(): void {
    this.items.clear();
  }
}

export const globalCheckpoints = new CheckpointStore();
