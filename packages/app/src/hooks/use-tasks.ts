import { useMemo } from "react";
import { useFetchQuery } from "@/data/query";
import {
  getHostRuntimeStore,
  useHostRuntimeConnectionStatuses,
  useHosts,
} from "@/runtime/host-runtime";
import { useHostFeatureMap } from "@/runtime/host-features";
import {
  fetchAggregatedTasks,
  tasksQueryBaseKey,
  type AggregateLoadState,
  type AggregatedTask,
  type TaskHostError,
  type TaskHostInput,
} from "@/tasks/aggregated-tasks";

export type { AggregateLoadState, AggregatedTask, TaskHostError } from "@/tasks/aggregated-tasks";

export function tasksQueryKey(serverIds: readonly string[]) {
  return [...tasksQueryBaseKey, [...serverIds].sort().join("|")] as const;
}

export interface UseTasksResult {
  loadState: AggregateLoadState<AggregatedTask>;
  hostErrors: TaskHostError[];
  // True when at least one connected host advertises the tasksCore capability.
  anyHostSupported: boolean;
  isError: boolean;
  error: Error | null;
  refetch: () => void;
  isRefetching: boolean;
}

export function useTasks(): UseTasksResult {
  const hosts = useHosts();
  const runtime = getHostRuntimeStore();
  const allServerIds = useMemo(() => hosts.map((host) => host.serverId), [hosts]);
  // COMPAT(tasksCore): added in v0.1.110 (hugolrf fork), drop the gate when floor >= v0.1.110.
  const featureMap = useHostFeatureMap(allServerIds, "tasksCore");
  const hostInputs = useMemo<TaskHostInput[]>(
    () =>
      hosts
        .filter((host) => featureMap.get(host.serverId) === true)
        .map((host) => ({ serverId: host.serverId, serverName: host.label })),
    [hosts, featureMap],
  );
  const serverIds = useMemo(() => hostInputs.map((host) => host.serverId), [hostInputs]);
  const connectionStatuses = useHostRuntimeConnectionStatuses(serverIds);
  const connectionStatusKey = useMemo(
    () => serverIds.map((serverId) => connectionStatuses.get(serverId) ?? "connecting").join("|"),
    [connectionStatuses, serverIds],
  );

  const query = useFetchQuery({
    queryKey: [...tasksQueryKey(serverIds), connectionStatusKey],
    queryFn: () => fetchAggregatedTasks({ hosts: hostInputs, runtime }),
    dataShape: "list",
    staleTimeMs: 5_000,
  });

  let loadState: AggregateLoadState<AggregatedTask>;
  if (query.data?.status === "connecting") {
    loadState = { status: "connecting" };
  } else if (query.data?.status === "loaded") {
    loadState = { status: "loaded", data: query.data.data };
  } else {
    loadState = { status: "loading" };
  }

  return {
    loadState,
    hostErrors: query.data?.status === "loaded" ? query.data.hostErrors : [],
    anyHostSupported: hostInputs.length > 0,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
    isRefetching: query.isRefetching,
  };
}
