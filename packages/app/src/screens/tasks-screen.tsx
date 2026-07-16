import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useIsFocused } from "@react-navigation/native";
import { ClipboardList, RefreshCw, Rocket } from "lucide-react-native";
import { StyleSheet } from "react-native-unistyles";
import { MenuHeader } from "@/components/headers/menu-header";
import {
  ORIGIN_PROVIDER_LABELS,
  OriginIcon,
  originKey,
  parseOriginProvider,
  type OriginProviderId,
} from "@/components/tasks/origin-icon";
import { Button } from "@/components/ui/button";
import { FormTextInput } from "@/components/ui/form-field";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { SelectField, type SelectFieldOption } from "@/components/ui/select-field";
import { useProvidersSnapshot } from "@/hooks/use-providers-snapshot";
import { useTasks, type AggregatedTask, type TaskHostError } from "@/hooks/use-tasks";
import { useHostFeatureMap } from "@/runtime/host-features";
import { getHostRuntimeStore, useHosts } from "@/runtime/host-runtime";
import { useWorkspaceStructure } from "@/stores/session-store-hooks";
import { toErrorMessage } from "@/utils/error-messages";
import { navigateToAgent } from "@/utils/navigate-to-agent";
import type { AgentProvider } from "@getpaseo/protocol/agent-types";

const EMPTY_TASKS: AggregatedTask[] = [];
const ORIGIN_FILTERS: OriginProviderId[] = ["jira", "azure", "gitlab", "linear"];

type SyncState =
  | { kind: "idle" }
  | { kind: "running" }
  | { kind: "done"; summary: string; originErrors: string[] }
  | { kind: "error"; message: string };

function taskKey(task: AggregatedTask): string {
  return `${task.serverId}:${task.id}`;
}

export function TasksScreen(): ReactElement {
  const isFocused = useIsFocused();

  if (!isFocused) {
    return <View style={styles.container} />;
  }

  return <TasksScreenContent />;
}

function TasksScreenContent(): ReactElement {
  const { loadState, hostErrors, anyHostSupported, isError, refetch } = useTasks();
  const tasks = loadState.status === "loaded" ? loadState.data : EMPTY_TASKS;
  const hosts = useHosts();
  const runtime = getHostRuntimeStore();
  const allServerIds = useMemo(() => hosts.map((host) => host.serverId), [hosts]);
  // COMPAT(tasksSync): added in v0.1.110 (hugolrf fork), drop the gate when floor >= v0.1.110.
  const syncFeatureMap = useHostFeatureMap(allServerIds, "tasksSync");
  const syncHosts = useMemo(
    () => hosts.filter((host) => syncFeatureMap.get(host.serverId) === true),
    [hosts, syncFeatureMap],
  );

  const [syncState, setSyncState] = useState<SyncState>({ kind: "idle" });
  const [search, setSearch] = useState("");
  const [providerFilter, setProviderFilter] = useState<OriginProviderId | null>(null);
  const [hideTasked, setHideTasked] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const syncNow = useCallback(async () => {
    if (syncHosts.length === 0) return;
    setSyncState({ kind: "running" });
    try {
      let created = 0;
      let updated = 0;
      let closed = 0;
      const originErrors: string[] = [];
      for (const host of syncHosts) {
        const client = runtime.getClient(host.serverId);
        if (!client) continue;
        const payload = await client.tasksSyncRun();
        if (payload.error) {
          throw new Error(payload.error);
        }
        created += payload.created;
        updated += payload.updated;
        closed += payload.closed;
        for (const originError of payload.originErrors) {
          originErrors.push(`${originError.provider}: ${originError.message}`);
        }
      }
      setSyncState({
        kind: "done",
        summary: `Synced — ${created} new, ${updated} updated, ${closed} closed`,
        originErrors,
      });
      refetch();
    } catch (error) {
      setSyncState({ kind: "error", message: toErrorMessage(error) });
      refetch();
    }
  }, [syncHosts, runtime, refetch]);

  // Sync once per screen visit as soon as a sync-capable host is connected.
  const hasAutoSyncedRef = useRef(false);
  const syncHostsReady = syncHosts.length > 0;
  useEffect(() => {
    if (!syncHostsReady || hasAutoSyncedRef.current) return;
    hasAutoSyncedRef.current = true;
    void syncNow();
  }, [syncHostsReady, syncNow]);

  const toggleHideTasked = useCallback(() => setHideTasked((current) => !current), []);
  const hideTaskedChipStyle = useMemo(
    () => (hideTasked ? [styles.filterChip, styles.filterChipActive] : [styles.filterChip]),
    [hideTasked],
  );

  const openTasks = useMemo(() => tasks.filter((task) => task.status !== "done"), [tasks]);

  const visibleTasks = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return openTasks.filter((task) => {
      const provider = parseOriginProvider(task.origin);
      if (providerFilter && provider !== providerFilter) return false;
      if (hideTasked && task.agentIds.length > 0) return false;
      if (needle) {
        const haystack = `${task.title} ${task.origin ?? ""}`.toLowerCase();
        if (!haystack.includes(needle)) return false;
      }
      return true;
    });
  }, [openTasks, search, providerFilter, hideTasked]);

  const selectedTask = useMemo(
    () => visibleTasks.find((task) => taskKey(task) === selectedKey) ?? null,
    [visibleTasks, selectedKey],
  );

  const handleSelect = useCallback((task: AggregatedTask) => {
    setSelectedKey((current) => (current === taskKey(task) ? null : taskKey(task)));
  }, []);

  const singleHost = hosts.length <= 1;
  const showLoadError = isError && loadState.status !== "loaded";
  const syncing = syncState.kind === "running";

  let body: ReactElement;
  if (!anyHostSupported) {
    body = (
      <View style={styles.centered}>
        <ClipboardList size={styles.emptyIcon.width} color={styles.emptyIcon.color} />
        <Text style={styles.message}>Update your host to use tasks</Text>
      </View>
    );
  } else if (showLoadError) {
    body = (
      <View style={styles.centered}>
        <Text style={styles.message}>Unable to load tasks</Text>
        <Button variant="ghost" onPress={refetch} testID="tasks-retry">
          Try again
        </Button>
      </View>
    );
  } else if (loadState.status !== "loaded") {
    body = (
      <View style={styles.centered}>
        <LoadingSpinner size="large" color={styles.spinner.color} />
      </View>
    );
  } else {
    body = (
      <View style={styles.body}>
        <View style={styles.toolbar}>
          <View style={styles.searchBox}>
            <FormTextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Search issues"
              autoCapitalize="none"
              size="sm"
              testID="tasks-search"
            />
          </View>
          <Button
            variant="outline"
            leftIcon={RefreshCw}
            size="sm"
            loading={syncing}
            onPress={syncNow}
            testID="tasks-sync-now"
          >
            Sync
          </Button>
        </View>
        <View style={styles.filterRow}>
          <Text style={styles.filterLabel}>Filter</Text>
          {ORIGIN_FILTERS.map((provider) => (
            <OriginFilterChip
              key={provider}
              provider={provider}
              active={providerFilter === provider}
              onToggle={setProviderFilter}
            />
          ))}
          <Pressable
            onPress={toggleHideTasked}
            style={hideTaskedChipStyle}
            testID="tasks-filter-hide-tasked"
          >
            <Text style={styles.filterChipText}>Hide tasked</Text>
          </Pressable>
          {syncState.kind === "done" ? (
            <Text style={styles.syncSummary}>{syncState.summary}</Text>
          ) : null}
          {syncState.kind === "error" ? (
            <Text style={styles.errorText}>{syncState.message}</Text>
          ) : null}
        </View>
        {syncState.kind === "done" && syncState.originErrors.length > 0 ? (
          <View style={styles.errorsBannerWrap}>
            <View style={styles.errorsBanner}>
              {syncState.originErrors.map((message) => (
                <Text key={message} style={styles.errorsBannerText}>
                  {message}
                </Text>
              ))}
            </View>
          </View>
        ) : null}
        {hostErrors.length > 0 ? <TasksHostErrorsBanner errors={hostErrors} /> : null}
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          testID="tasks-list"
        >
          {visibleTasks.length === 0 ? (
            <View style={styles.centeredGrow}>
              <ClipboardList size={styles.emptyIcon.width} color={styles.emptyIcon.color} />
              <View style={styles.emptyTextStack}>
                <Text style={styles.emptyTitle}>
                  {openTasks.length === 0 ? "No issues synced yet" : "No issues match the filters"}
                </Text>
                <Text style={styles.emptyDescription}>
                  Issues mirror your assignments from Jira, Azure Boards, GitLab, and Linear.
                  Configure credentials under origins in the daemon config, then sync.
                </Text>
              </View>
              <Button variant="outline" leftIcon={RefreshCw} loading={syncing} onPress={syncNow}>
                Sync now
              </Button>
            </View>
          ) : (
            visibleTasks.map((task) => (
              <TaskRow
                key={taskKey(task)}
                task={task}
                singleHost={singleHost}
                selected={taskKey(task) === selectedKey}
                onSelect={handleSelect}
              />
            ))
          )}
        </ScrollView>
        {selectedTask ? <LaunchBar key={taskKey(selectedTask)} task={selectedTask} /> : null}
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <MenuHeader title="Tasks" />
      {body}
    </View>
  );
}

function OriginFilterChip({
  provider,
  active,
  onToggle,
}: {
  provider: OriginProviderId;
  active: boolean;
  onToggle: (provider: OriginProviderId | null) => void;
}): ReactElement {
  const handlePress = useCallback(
    () => onToggle(active ? null : provider),
    [onToggle, active, provider],
  );
  const chipStyle = useMemo(
    () => (active ? [styles.filterChip, styles.filterChipActive] : [styles.filterChip]),
    [active],
  );
  return (
    <Pressable onPress={handlePress} style={chipStyle} testID={`tasks-filter-${provider}`}>
      <OriginIcon provider={provider} size={14} />
      <Text style={styles.filterChipText}>{ORIGIN_PROVIDER_LABELS[provider]}</Text>
    </Pressable>
  );
}

function TaskRow({
  task,
  singleHost,
  selected,
  onSelect,
}: {
  task: AggregatedTask;
  singleHost: boolean;
  selected: boolean;
  onSelect: (task: AggregatedTask) => void;
}): ReactElement {
  const provider = parseOriginProvider(task.origin);
  const handlePress = useCallback(() => onSelect(task), [onSelect, task]);
  const rowStyle = useMemo(
    () => (selected ? [styles.row, styles.rowSelected] : [styles.row]),
    [selected],
  );

  return (
    <Pressable onPress={handlePress} style={rowStyle} testID={`task-row-${task.id}`}>
      <OriginIcon provider={provider} />
      <Text style={styles.rowKey}>{originKey(task.origin) || "local"}</Text>
      <Text style={styles.rowTitle} numberOfLines={1}>
        {task.title}
      </Text>
      {task.agentIds.length > 0 ? <Text style={styles.rowTaskedBadge}>tasked</Text> : null}
      {!singleHost ? <Text style={styles.rowMeta}>{task.serverName}</Text> : null}
      <Text style={styles.statusBadge}>{task.status}</Text>
    </Pressable>
  );
}

function LaunchBar({ task }: { task: AggregatedTask }): ReactElement {
  const runtime = getHostRuntimeStore();
  const structure = useWorkspaceStructure(useMemo(() => [task.serverId], [task.serverId]));

  const repoOptions = useMemo<SelectFieldOption<string>[]>(() => {
    const options: SelectFieldOption<string>[] = [];
    const seen = new Set<string>();
    for (const repo of task.repos) {
      if (repo.startsWith("/") && !seen.has(repo)) {
        seen.add(repo);
        options.push({
          id: repo,
          value: repo,
          label: repo.split("/").pop() ?? repo,
          description: repo,
        });
      }
    }
    for (const project of structure.projects) {
      for (const host of project.hosts) {
        if (host.serverId !== task.serverId) continue;
        if (seen.has(host.iconWorkingDir)) continue;
        seen.add(host.iconWorkingDir);
        options.push({
          id: host.iconWorkingDir,
          value: host.iconWorkingDir,
          label: project.projectName,
          description: host.iconWorkingDir,
        });
      }
    }
    return options;
  }, [task.repos, task.serverId, structure]);

  const [cwd, setCwd] = useState<string | null>(null);
  const effectiveCwd = cwd ?? repoOptions[0]?.value ?? null;

  const snapshot = useProvidersSnapshot(task.serverId, {
    cwd: effectiveCwd ?? undefined,
    enabled: effectiveCwd !== null,
  });
  const providerEntries = useMemo(
    () => (snapshot.entries ?? []).filter((entry) => entry.enabled && entry.status === "ready"),
    [snapshot.entries],
  );

  const [provider, setProvider] = useState<AgentProvider | null>(null);
  const effectiveProvider = provider ?? providerEntries[0]?.provider ?? null;
  const providerOptions = useMemo<SelectFieldOption<AgentProvider>[]>(
    () =>
      providerEntries.map((entry) => ({
        id: entry.provider,
        value: entry.provider,
        label: entry.label ?? entry.provider,
      })),
    [providerEntries],
  );

  const modelOptions = useMemo<SelectFieldOption<string>[]>(() => {
    const entry = providerEntries.find((candidate) => candidate.provider === effectiveProvider);
    return (entry?.models ?? []).map((model) => ({
      id: model.id,
      value: model.id,
      label: model.label ?? model.id,
    }));
  }, [providerEntries, effectiveProvider]);

  const [model, setModel] = useState<string | null>(null);
  const effectiveModel = useMemo(() => {
    if (model && modelOptions.some((option) => option.value === model)) return model;
    const entry = providerEntries.find((candidate) => candidate.provider === effectiveProvider);
    const defaultModel = entry?.models?.find((candidate) => candidate.isDefault);
    return defaultModel?.id ?? null;
  }, [model, modelOptions, providerEntries, effectiveProvider]);

  const handleSelectProvider = useCallback((value: AgentProvider) => {
    setProvider(value);
    setModel(null);
  }, []);

  const [launchState, setLaunchState] = useState<
    { kind: "idle" } | { kind: "launching" } | { kind: "error"; message: string }
  >({ kind: "idle" });

  const launch = useCallback(async () => {
    const client = runtime.getClient(task.serverId);
    if (!client || !effectiveCwd || !effectiveProvider) return;
    setLaunchState({ kind: "launching" });
    try {
      const promptLines = [
        `Work on this issue: ${task.title}`,
        task.origin ? `Origin: ${task.origin}` : null,
        task.body ? `Link: ${task.body}` : null,
      ].filter(Boolean);
      const agent = await client.createAgent({
        provider: effectiveProvider,
        cwd: effectiveCwd,
        ...(effectiveModel ? { model: effectiveModel } : {}),
        title: task.title,
        initialPrompt: promptLines.join("\n"),
      });
      await client.tasksCoreUpdate({
        id: task.id,
        agentIds: [...task.agentIds, agent.id],
      });
      navigateToAgent({
        serverId: task.serverId,
        agentId: agent.id,
        workspaceId: agent.workspaceId,
      });
    } catch (error) {
      setLaunchState({ kind: "error", message: toErrorMessage(error) });
      return;
    }
    setLaunchState({ kind: "idle" });
  }, [runtime, task, effectiveCwd, effectiveProvider, effectiveModel]);

  const repoDisplay = useMemo(() => {
    const option = repoOptions.find((candidate) => candidate.value === effectiveCwd);
    return option ? { label: option.label, description: option.description } : null;
  }, [repoOptions, effectiveCwd]);
  const providerDisplay = useMemo(() => {
    const option = providerOptions.find((candidate) => candidate.value === effectiveProvider);
    return option ? { label: option.label } : null;
  }, [providerOptions, effectiveProvider]);
  const modelDisplay = useMemo(() => {
    const option = modelOptions.find((candidate) => candidate.value === effectiveModel);
    return option ? { label: option.label } : null;
  }, [modelOptions, effectiveModel]);

  return (
    <View style={styles.launchBar} testID="tasks-launch-bar">
      <View style={styles.launchFields}>
        <View style={styles.launchField}>
          <SelectField<string>
            label="Repository"
            value={effectiveCwd}
            selectedDisplay={repoDisplay}
            options={repoOptions}
            onChange={setCwd}
            placeholder="Pick a repository"
            emptyText="No git projects on this host"
            size="sm"
          />
        </View>
        <View style={styles.launchField}>
          <SelectField<AgentProvider>
            label="Agent"
            value={effectiveProvider}
            selectedDisplay={providerDisplay}
            options={providerOptions}
            onChange={handleSelectProvider}
            placeholder="Agent"
            emptyText="No agents available"
            loading={snapshot.isLoading}
            size="sm"
          />
        </View>
        <View style={styles.launchField}>
          <SelectField<string>
            label="Model"
            value={effectiveModel}
            selectedDisplay={modelDisplay}
            options={modelOptions}
            onChange={setModel}
            placeholder="Default"
            emptyText="Provider default"
            size="sm"
          />
        </View>
      </View>
      <View style={styles.launchActions}>
        {launchState.kind === "error" ? (
          <Text style={styles.errorText} numberOfLines={1}>
            {launchState.message}
          </Text>
        ) : null}
        <Button
          variant="default"
          size="sm"
          leftIcon={Rocket}
          loading={launchState.kind === "launching"}
          disabled={!effectiveCwd || !effectiveProvider}
          onPress={launch}
          testID="tasks-launch"
        >
          Launch task
        </Button>
      </View>
    </View>
  );
}

function TasksHostErrorsBanner({ errors }: { errors: TaskHostError[] }): ReactElement {
  return (
    <View style={styles.errorsBannerWrap}>
      <View style={styles.errorsBanner} testID="tasks-host-errors">
        {errors.map((error) => (
          <Text key={error.serverId} style={styles.errorsBannerText}>
            {`${error.serverName}: ${error.message}`}
          </Text>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    backgroundColor: theme.colors.surface0,
  },
  body: {
    flex: 1,
    minHeight: 0,
  },
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: theme.spacing[4],
    padding: theme.spacing[6],
  },
  centeredGrow: {
    flexGrow: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: theme.spacing[4],
    padding: theme.spacing[6],
  },
  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    paddingHorizontal: { xs: theme.spacing[3], md: theme.spacing[6] },
    paddingTop: theme.spacing[4],
  },
  searchBox: {
    flex: 1,
    maxWidth: 520,
  },
  filterRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: theme.spacing[2],
    paddingHorizontal: { xs: theme.spacing[3], md: theme.spacing[6] },
    paddingTop: theme.spacing[3],
  },
  filterLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    textTransform: "uppercase",
  },
  filterChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
  },
  filterChipActive: {
    backgroundColor: theme.colors.surface2,
    borderColor: theme.colors.foregroundMuted,
  },
  filterChipText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.xs,
  },
  syncSummary: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  scroll: {
    flex: 1,
    minHeight: 0,
  },
  scrollContent: {
    flexGrow: 1,
    gap: theme.spacing[1],
    paddingTop: theme.spacing[3],
    paddingBottom: theme.spacing[6],
    paddingHorizontal: { xs: theme.spacing[3], md: theme.spacing[6] },
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    borderRadius: theme.borderRadius.md,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
  },
  rowSelected: {
    backgroundColor: theme.colors.surface2,
  },
  rowKey: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    minWidth: 84,
  },
  rowTitle: {
    flex: 1,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  rowTaskedBadge: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: 1,
  },
  rowMeta: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  statusBadge: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    overflow: "hidden",
  },
  launchBar: {
    flexDirection: { xs: "column", md: "row" },
    alignItems: { xs: "stretch", md: "flex-end" },
    gap: theme.spacing[3],
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    paddingHorizontal: { xs: theme.spacing[3], md: theme.spacing[6] },
    paddingVertical: theme.spacing[3],
    backgroundColor: theme.colors.surface1,
    zIndex: 10,
  },
  launchFields: {
    flex: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[3],
  },
  launchField: {
    minWidth: 180,
    flexGrow: 1,
    maxWidth: 320,
  },
  launchActions: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: theme.spacing[3],
  },
  errorsBannerWrap: {
    paddingHorizontal: { xs: theme.spacing[3], md: theme.spacing[6] },
    paddingTop: theme.spacing[3],
  },
  errorsBanner: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.lg,
    padding: theme.spacing[3],
    gap: theme.spacing[1],
  },
  errorsBannerText: {
    color: theme.colors.palette.red[300],
    fontSize: theme.fontSize.xs,
  },
  message: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.lg,
    textAlign: "center",
  },
  errorText: {
    color: theme.colors.palette.red[300],
    fontSize: theme.fontSize.sm,
    flexShrink: 1,
  },
  spinner: {
    color: theme.colors.foregroundMuted,
  },
  emptyIcon: {
    color: theme.colors.foregroundMuted,
    width: theme.iconSize.lg,
  },
  emptyTextStack: {
    alignItems: "center",
    gap: theme.spacing[2],
  },
  emptyTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    textAlign: "center",
  },
  emptyDescription: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    textAlign: "center",
    maxWidth: 460,
  },
}));
