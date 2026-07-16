import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type { SessionOutboundMessage } from "@getpaseo/protocol/messages";
import { toErrorMessage } from "@/utils/error-messages";

export const tasksQueryBaseKey = ["tasks"] as const;

export const ALL_TASK_HOSTS_FAILED_MESSAGE = "No connected hosts could load tasks";

export type TaskPayload = Extract<
  SessionOutboundMessage,
  { type: "tasks.core.list.response" }
>["payload"]["tasks"][number];

export interface TaskHostInput {
  serverId: string;
  serverName: string;
}

export interface TaskRuntimeSnapshot {
  connectionStatus: string;
}

export interface TaskRuntime {
  getClient(serverId: string): Pick<DaemonClient, "tasksCoreList"> | null;
  getSnapshot(serverId: string): TaskRuntimeSnapshot | null | undefined;
}

/** A task tagged with the host it came from, so the flat list can render a
 * per-row host label and scope mutations without host sections. */
export interface AggregatedTask extends TaskPayload {
  serverId: string;
  serverName: string;
}

export interface TaskHostError {
  serverId: string;
  serverName: string;
  message: string;
}

export type FetchAggregatedTasksState =
  | { status: "connecting" }
  | { status: "loaded"; data: AggregatedTask[]; hostErrors: TaskHostError[] };

export type AggregateLoadState<T> =
  | { status: "connecting" }
  | { status: "loading" }
  | { status: "loaded"; data: T[] };

export interface FetchAggregatedTasksInput {
  hosts: readonly TaskHostInput[];
  runtime: TaskRuntime;
}

function isTaskHostConnectionSettling(snapshot: TaskRuntimeSnapshot | null | undefined): boolean {
  return (
    snapshot?.connectionStatus === "connecting" || snapshot?.connectionStatus === "reconnecting"
  );
}

/**
 * Fetch tasks across connected hosts and merge them into one flat list.
 * Offline hosts are skipped; a connected host that fails contributes to
 * `hostErrors` while the rest still render. Only when every connected host
 * fails do we throw so the screen shows a full error.
 */
export async function fetchAggregatedTasks(
  input: FetchAggregatedTasksInput,
): Promise<FetchAggregatedTasksState> {
  const hasSettlingHost = input.hosts.some((host) =>
    isTaskHostConnectionSettling(input.runtime.getSnapshot(host.serverId)),
  );
  const hasAskableHost = input.hosts.some((host) => {
    const snapshot = input.runtime.getSnapshot(host.serverId);
    return snapshot?.connectionStatus === "online" && input.runtime.getClient(host.serverId);
  });

  if (!hasAskableHost && hasSettlingHost) {
    return { status: "connecting" };
  }

  const tasks: AggregatedTask[] = [];
  const hostErrors: TaskHostError[] = [];
  let connectedAttempts = 0;

  await Promise.all(
    input.hosts.map(async (host) => {
      const snapshot = input.runtime.getSnapshot(host.serverId);
      const isOnline = snapshot?.connectionStatus === "online";
      const client = input.runtime.getClient(host.serverId);
      if (!client || !isOnline) {
        return;
      }
      connectedAttempts += 1;
      try {
        const payload = await client.tasksCoreList({});
        if (payload.error) {
          throw new Error(payload.error);
        }
        for (const task of payload.tasks) {
          tasks.push({ ...task, serverId: host.serverId, serverName: host.serverName });
        }
      } catch (error) {
        hostErrors.push({
          serverId: host.serverId,
          serverName: host.serverName,
          message: toErrorMessage(error),
        });
      }
    }),
  );

  if (connectedAttempts > 0 && tasks.length === 0 && hostErrors.length === connectedAttempts) {
    throw new Error(ALL_TASK_HOSTS_FAILED_MESSAGE);
  }

  if (tasks.length === 0 && connectedAttempts === 0 && hasSettlingHost) {
    return { status: "connecting" };
  }

  tasks.sort((a, b) => b.created.localeCompare(a.created));
  return { status: "loaded", data: tasks, hostErrors };
}
