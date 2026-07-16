import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { ScrollView, Text, View } from "react-native";
import { useIsFocused } from "@react-navigation/native";
import { ClipboardList, FolderGit2, RefreshCw } from "lucide-react-native";
import { StyleSheet } from "react-native-unistyles";
import { MenuHeader } from "@/components/headers/menu-header";
import { Button } from "@/components/ui/button";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { useTasks, type AggregatedTask, type TaskHostError } from "@/hooks/use-tasks";
import { useHostFeatureMap } from "@/runtime/host-features";
import { getHostRuntimeStore, useHosts } from "@/runtime/host-runtime";
import { toErrorMessage } from "@/utils/error-messages";

const EMPTY_TASKS: AggregatedTask[] = [];

type SyncState =
  | { kind: "idle" }
  | { kind: "running" }
  | { kind: "done"; summary: string; originErrors: string[] }
  | { kind: "error"; message: string };

type OriginLookupState =
  | { kind: "loading" }
  | { kind: "loaded"; status: string; rawStatus: string; title: string }
  | { kind: "error"; message: string };

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
  const [originLookups, setOriginLookups] = useState<Map<string, OriginLookupState>>(new Map());

  const setOriginLookup = useCallback((key: string, state: OriginLookupState) => {
    setOriginLookups((current) => {
      const next = new Map(current);
      next.set(key, state);
      return next;
    });
  }, []);

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

  const handleSaveRepos = useCallback(
    async (task: AggregatedTask, repos: string[]) => {
      const client = runtime.getClient(task.serverId);
      if (!client) return;
      const payload = await client.tasksCoreUpdate({ id: task.id, repos });
      if (payload.error) {
        throw new Error(payload.error);
      }
      refetch();
    },
    [runtime, refetch],
  );

  const handleCheckOrigin = useCallback(
    async (task: AggregatedTask) => {
      if (!task.origin) return;
      const key = `${task.serverId}:${task.id}`;
      const client = runtime.getClient(task.serverId);
      if (!client) return;
      setOriginLookup(key, { kind: "loading" });
      try {
        const payload = await client.tasksOriginsGetIssue(task.origin);
        if (payload.error || !payload.issue) {
          throw new Error(payload.error ?? "Issue not found");
        }
        setOriginLookup(key, {
          kind: "loaded",
          status: payload.issue.status,
          rawStatus: payload.issue.rawStatus,
          title: payload.issue.title,
        });
      } catch (error) {
        setOriginLookup(key, { kind: "error", message: toErrorMessage(error) });
      }
    },
    [runtime, setOriginLookup],
  );

  const openTasks = useMemo(() => tasks.filter((task) => task.status !== "done"), [tasks]);
  const doneTasks = useMemo(() => tasks.filter((task) => task.status === "done"), [tasks]);
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
          <View style={styles.toolbarStatus}>
            <Text style={styles.toolbarHint}>
              {openTasks.length === 1 ? "1 open task" : `${openTasks.length} open tasks`}
            </Text>
            {syncState.kind === "done" ? (
              <Text style={styles.toolbarHint}>{syncState.summary}</Text>
            ) : null}
            {syncState.kind === "error" ? (
              <Text style={styles.errorText}>{syncState.message}</Text>
            ) : null}
          </View>
          <Button
            variant="outline"
            leftIcon={RefreshCw}
            size="sm"
            loading={syncing}
            onPress={syncNow}
            testID="tasks-sync-now"
          >
            Sync now
          </Button>
        </View>
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          testID="tasks-list"
        >
          {syncState.kind === "done" && syncState.originErrors.length > 0 ? (
            <View style={styles.errorsBanner}>
              {syncState.originErrors.map((message) => (
                <Text key={message} style={styles.errorsBannerText}>
                  {message}
                </Text>
              ))}
            </View>
          ) : null}
          {hostErrors.length > 0 ? <TasksHostErrorsBanner errors={hostErrors} /> : null}
          {tasks.length === 0 ? (
            <View style={styles.centeredGrow}>
              <ClipboardList size={styles.emptyIcon.width} color={styles.emptyIcon.color} />
              <View style={styles.emptyTextStack}>
                <Text style={styles.emptyTitle}>No tasks synced yet</Text>
                <Text style={styles.emptyDescription}>
                  Tasks mirror your assigned issues from Jira, Azure Boards, GitLab, and Linear.
                  Configure credentials under origins in the daemon config, then sync.
                </Text>
              </View>
              <Button variant="outline" leftIcon={RefreshCw} loading={syncing} onPress={syncNow}>
                Sync now
              </Button>
            </View>
          ) : (
            <>
              {openTasks.map((task) => (
                <TaskCard
                  key={`${task.serverId}:${task.id}`}
                  task={task}
                  singleHost={singleHost}
                  originLookup={originLookups.get(`${task.serverId}:${task.id}`)}
                  onSaveRepos={handleSaveRepos}
                  onCheckOrigin={handleCheckOrigin}
                />
              ))}
              {doneTasks.length > 0 ? (
                <Text style={styles.sectionLabel}>{`Done (${doneTasks.length})`}</Text>
              ) : null}
              {doneTasks.map((task) => (
                <TaskCard
                  key={`${task.serverId}:${task.id}`}
                  task={task}
                  singleHost={singleHost}
                  originLookup={originLookups.get(`${task.serverId}:${task.id}`)}
                  onSaveRepos={handleSaveRepos}
                  onCheckOrigin={handleCheckOrigin}
                />
              ))}
            </>
          )}
        </ScrollView>
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

function TaskCard({
  task,
  singleHost,
  originLookup,
  onSaveRepos,
  onCheckOrigin,
}: {
  task: AggregatedTask;
  singleHost: boolean;
  originLookup: OriginLookupState | undefined;
  onSaveRepos: (task: AggregatedTask, repos: string[]) => Promise<void>;
  onCheckOrigin: (task: AggregatedTask) => void;
}): ReactElement {
  const isDone = task.status === "done";
  const [editingRepos, setEditingRepos] = useState(false);
  const [reposDraft, setReposDraft] = useState("");
  const [savingRepos, setSavingRepos] = useState(false);
  const [repoError, setRepoError] = useState<string | null>(null);

  const titleStyle = useMemo(
    () => (isDone ? [styles.cardTitle, styles.cardTitleDone] : [styles.cardTitle]),
    [isDone],
  );

  const startEditRepos = useCallback(() => {
    setReposDraft(task.repos.join(", "));
    setRepoError(null);
    setEditingRepos(true);
  }, [task.repos]);

  const cancelEditRepos = useCallback(() => {
    setEditingRepos(false);
    setRepoError(null);
  }, []);

  const saveRepos = useCallback(async () => {
    setSavingRepos(true);
    setRepoError(null);
    try {
      const repos = reposDraft
        .split(",")
        .map((repo) => repo.trim())
        .filter(Boolean);
      await onSaveRepos(task, repos);
      setEditingRepos(false);
    } catch (error) {
      setRepoError(toErrorMessage(error));
    } finally {
      setSavingRepos(false);
    }
  }, [reposDraft, onSaveRepos, task]);

  const handleCheckOriginPress = useCallback(() => onCheckOrigin(task), [onCheckOrigin, task]);

  return (
    <View style={styles.card} testID={`task-card-${task.id}`}>
      <View style={styles.cardHeader}>
        <Text style={titleStyle} numberOfLines={2}>
          {task.title}
        </Text>
        <Text style={styles.statusBadge}>{task.status}</Text>
      </View>
      <View style={styles.metaRow}>
        {task.origin ? <Text style={styles.metaText}>{task.origin}</Text> : null}
        {!singleHost ? <Text style={styles.metaText}>{task.serverName}</Text> : null}
      </View>
      {editingRepos ? (
        <View style={styles.repoEditor}>
          <Field label="Linked repositories" error={repoError} hint="Comma-separated">
            <FormTextInput
              value={reposDraft}
              onChangeText={setReposDraft}
              placeholder="acme/backend, /path/to/checkout"
              autoCapitalize="none"
              testID={`task-repos-input-${task.id}`}
            />
          </Field>
          <View style={styles.cardActions}>
            <Button variant="ghost" size="sm" onPress={cancelEditRepos}>
              Cancel
            </Button>
            <Button
              variant="default"
              size="sm"
              loading={savingRepos}
              onPress={saveRepos}
              testID={`task-repos-save-${task.id}`}
            >
              Save
            </Button>
          </View>
        </View>
      ) : (
        <View style={styles.chipsRow}>
          {task.repos.map((repo) => (
            <View key={repo} style={styles.chip}>
              <Text style={styles.chipText} numberOfLines={1}>
                {repo}
              </Text>
            </View>
          ))}
          <Button
            variant="ghost"
            size="sm"
            leftIcon={FolderGit2}
            onPress={startEditRepos}
            testID={`task-repos-edit-${task.id}`}
          >
            {task.repos.length > 0 ? "Edit repos" : "Link repos"}
          </Button>
        </View>
      )}
      {originLookup?.kind === "loaded" ? (
        <Text style={styles.originResult}>
          {`Origin now: [${originLookup.status}] ${originLookup.rawStatus}`}
        </Text>
      ) : null}
      {originLookup?.kind === "error" ? (
        <Text style={styles.errorText}>{originLookup.message}</Text>
      ) : null}
      {task.origin ? (
        <View style={styles.cardActions}>
          <Button
            variant="ghost"
            size="sm"
            leftIcon={RefreshCw}
            loading={originLookup?.kind === "loading"}
            onPress={handleCheckOriginPress}
            testID={`task-origin-check-${task.id}`}
          >
            Check origin
          </Button>
        </View>
      ) : null}
    </View>
  );
}

function TasksHostErrorsBanner({ errors }: { errors: TaskHostError[] }): ReactElement {
  return (
    <View style={styles.errorsBanner} testID="tasks-host-errors">
      {errors.map((error) => (
        <Text key={error.serverId} style={styles.errorsBannerText}>
          {`${error.serverName}: ${error.message}`}
        </Text>
      ))}
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
    justifyContent: "space-between",
    gap: theme.spacing[3],
    paddingHorizontal: { xs: theme.spacing[3], md: theme.spacing[6] },
    paddingTop: theme.spacing[4],
  },
  toolbarStatus: {
    flexShrink: 1,
    gap: theme.spacing[1],
  },
  toolbarHint: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  sectionLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    paddingTop: theme.spacing[3],
  },
  scroll: {
    flex: 1,
    minHeight: 0,
  },
  scrollContent: {
    flexGrow: 1,
    gap: theme.spacing[3],
    paddingTop: theme.spacing[4],
    paddingBottom: theme.spacing[6],
    paddingHorizontal: { xs: theme.spacing[3], md: theme.spacing[6] },
  },
  card: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.lg,
    padding: theme.spacing[4],
    gap: theme.spacing[3],
    backgroundColor: theme.colors.surface1,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[3],
  },
  cardTitle: {
    flex: 1,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
  },
  cardTitleDone: {
    color: theme.colors.foregroundMuted,
    textDecorationLine: "line-through",
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
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
  },
  chipsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  chip: {
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface2,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    maxWidth: 280,
  },
  chipText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.xs,
  },
  repoEditor: {
    gap: theme.spacing[2],
  },
  originResult: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  cardActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: theme.spacing[2],
  },
  metaText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
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
