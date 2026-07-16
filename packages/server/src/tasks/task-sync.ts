import type { NormalizedOriginStatus, OriginIssue } from "../services/origins/types.js";
import type { Task, TaskStatus, TaskStore } from "./types.js";

export interface TaskSyncResult {
  created: number;
  updated: number;
  closed: number;
  unchanged: number;
}

// Origin buckets map onto the task lifecycle; "failed" is reserved for local
// execution failures and never comes from an origin.
function toTaskStatus(status: NormalizedOriginStatus): TaskStatus {
  switch (status) {
    case "done":
    case "canceled":
      return "done";
    case "in_progress":
    case "in_review":
      return "in_progress";
    case "todo":
    case "unknown":
      return "open";
  }
}

function originRef(issue: OriginIssue): string {
  return `${issue.provider}:${issue.key}`;
}

/**
 * Mirror the configured origins into the task store (the Kepler model: tasks
 * are synced from the tracker, not authored locally).
 *
 * - New origin issues become tasks keyed by their `origin` ref.
 * - Known tasks track the origin's title and normalized status.
 * - Tasks whose origin no longer appears in the sweep are closed (the issue
 *   was finished, unassigned, or filtered out upstream).
 * - Locally authored tasks (no `origin`) are never touched.
 *
 * `syncedProviders` limits the auto-close pass to origins that actually
 * answered, so a provider outage never mass-closes its mirrored tasks.
 */
export async function syncTasksFromOrigins(input: {
  store: TaskStore;
  issues: OriginIssue[];
  syncedProviders: readonly string[];
}): Promise<TaskSyncResult> {
  const { store, issues, syncedProviders } = input;
  const result: TaskSyncResult = { created: 0, updated: 0, closed: 0, unchanged: 0 };

  const existing = await store.list();
  const byOrigin = new Map<string, Task>();
  for (const task of existing) {
    if (task.origin) {
      byOrigin.set(task.origin, task);
    }
  }

  const seenRefs = new Set<string>();
  for (const issue of issues) {
    const ref = originRef(issue);
    seenRefs.add(ref);
    const status = toTaskStatus(issue.status);
    const known = byOrigin.get(ref);

    if (!known) {
      await store.create(issue.title, {
        origin: ref,
        status,
        body: issue.url ?? "",
      });
      result.created += 1;
      continue;
    }

    const changes: Partial<Omit<Task, "id" | "created">> = {};
    if (known.title !== issue.title) changes.title = issue.title;
    if (known.status !== status) changes.status = status;
    if (Object.keys(changes).length > 0) {
      await store.update(known.id, changes);
      result.updated += 1;
    } else {
      result.unchanged += 1;
    }
  }

  for (const [ref, task] of byOrigin) {
    if (seenRefs.has(ref)) continue;
    const provider = ref.slice(0, ref.indexOf(":"));
    if (!syncedProviders.includes(provider)) continue;
    if (task.status === "done") continue;
    await store.update(task.id, { status: "done" });
    result.closed += 1;
  }

  return result;
}
