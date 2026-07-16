import { useCallback, useMemo, useState, type ReactElement } from "react";
import { ScrollView, Text, View } from "react-native";
import { useIsFocused } from "@react-navigation/native";
import { ClipboardList, Plus, RefreshCw } from "lucide-react-native";
import { StyleSheet } from "react-native-unistyles";
import { MenuHeader } from "@/components/headers/menu-header";
import { Button } from "@/components/ui/button";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { useTasks, type AggregatedTask, type TaskHostError } from "@/hooks/use-tasks";
import { getHostRuntimeStore, useHosts } from "@/runtime/host-runtime";
import { toErrorMessage } from "@/utils/error-messages";

const EMPTY_TASKS: AggregatedTask[] = [];

type OriginLookupState =
  | { kind: "loading" }
  | { kind: "loaded"; status: string; rawStatus: string; title: string; url: string | null }
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

  const [showCreate, setShowCreate] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newRepos, setNewRepos] = useState("");
  const [newOrigin, setNewOrigin] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [mutatingTaskId, setMutatingTaskId] = useState<string | null>(null);
  const [originLookups, setOriginLookups] = useState<Map<string, OriginLookupState>>(new Map());

  const supportedHosts = useMemo(
    () => hosts.filter((host) => runtime.getClient(host.serverId)),
    [hosts, runtime],
  );

  const openCreate = useCallback(() => setShowCreate(true), []);
  const closeCreate = useCallback(() => setShowCreate(false), []);
  const toggleCreate = useCallback(() => setShowCreate((current) => !current), []);

  const setOriginLookup = useCallback((key: string, state: OriginLookupState | null) => {
    setOriginLookups((current) => {
      const next = new Map(current);
      if (state === null) {
        next.delete(key);
      } else {
        next.set(key, state);
      }
      return next;
    });
  }, []);

  const handleCreate = useCallback(async () => {
    const title = newTitle.trim();
    if (!title) {
      setCreateError("Title is required");
      return;
    }
    const target = supportedHosts[0];
    const client = target ? runtime.getClient(target.serverId) : null;
    if (!client) {
      setCreateError("No connected host supports tasks");
      return;
    }
    setCreating(true);
    setCreateError(null);
    try {
      const repos = newRepos
        .split(",")
        .map((repo) => repo.trim())
        .filter(Boolean);
      const origin = newOrigin.trim();
      const payload = await client.tasksCoreCreate({
        title,
        ...(repos.length > 0 ? { repos } : {}),
        ...(origin ? { origin } : {}),
      });
      if (payload.error) {
        throw new Error(payload.error);
      }
      setNewTitle("");
      setNewRepos("");
      setNewOrigin("");
      setShowCreate(false);
      refetch();
    } catch (error) {
      setCreateError(toErrorMessage(error));
    } finally {
      setCreating(false);
    }
  }, [newTitle, newRepos, newOrigin, supportedHosts, runtime, refetch]);

  const handleSetStatus = useCallback(
    async (task: AggregatedTask, status: "done" | "open") => {
      const client = runtime.getClient(task.serverId);
      if (!client) return;
      setMutatingTaskId(task.id);
      try {
        const payload = await client.tasksCoreUpdate({ id: task.id, status });
        if (payload.error) {
          throw new Error(payload.error);
        }
      } finally {
        setMutatingTaskId(null);
        refetch();
      }
    },
    [runtime, refetch],
  );

  const handleDelete = useCallback(
    async (task: AggregatedTask) => {
      const client = runtime.getClient(task.serverId);
      if (!client) return;
      setMutatingTaskId(task.id);
      try {
        await client.tasksCoreDelete(task.id);
      } finally {
        setMutatingTaskId(null);
        refetch();
      }
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
          url: payload.issue.url,
        });
      } catch (error) {
        setOriginLookup(key, { kind: "error", message: toErrorMessage(error) });
      }
    },
    [runtime, setOriginLookup],
  );

  const singleHost = hosts.length <= 1;
  const showLoadError = isError && loadState.status !== "loaded";

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
          <Text style={styles.toolbarHint}>
            {tasks.length === 1 ? "1 task" : `${tasks.length} tasks`}
          </Text>
          <Button
            variant="outline"
            leftIcon={Plus}
            size="sm"
            onPress={toggleCreate}
            testID="tasks-new"
          >
            New task
          </Button>
        </View>
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          testID="tasks-list"
        >
          {showCreate ? (
            <View style={styles.card}>
              <Field label="Title" error={createError}>
                <FormTextInput
                  value={newTitle}
                  onChangeText={setNewTitle}
                  placeholder="What needs to happen"
                  testID="tasks-new-title"
                />
              </Field>
              <Field label="Repositories" hint="Comma-separated: owner/repo, /path/to/checkout">
                <FormTextInput
                  value={newRepos}
                  onChangeText={setNewRepos}
                  placeholder="acme/backend, acme/frontend"
                  autoCapitalize="none"
                  testID="tasks-new-repos"
                />
              </Field>
              <Field label="Origin" hint="jira:TCE-123, azure:12345, linear:HUG-1">
                <FormTextInput
                  value={newOrigin}
                  onChangeText={setNewOrigin}
                  placeholder="provider:key (optional)"
                  autoCapitalize="none"
                  testID="tasks-new-origin"
                />
              </Field>
              <View style={styles.cardActions}>
                <Button variant="ghost" size="sm" onPress={closeCreate}>
                  Cancel
                </Button>
                <Button
                  variant="default"
                  size="sm"
                  loading={creating}
                  onPress={handleCreate}
                  testID="tasks-new-create"
                >
                  Create
                </Button>
              </View>
            </View>
          ) : null}
          {hostErrors.length > 0 ? <TasksHostErrorsBanner errors={hostErrors} /> : null}
          {tasks.length === 0 && !showCreate ? (
            <View style={styles.centeredGrow}>
              <ClipboardList size={styles.emptyIcon.width} color={styles.emptyIcon.color} />
              <View style={styles.emptyTextStack}>
                <Text style={styles.emptyTitle}>No tasks yet</Text>
                <Text style={styles.emptyDescription}>
                  Tasks can span multiple repositories and link to Jira, Azure Boards, GitLab, or
                  Linear issues.
                </Text>
              </View>
              <Button variant="outline" leftIcon={Plus} onPress={openCreate}>
                New task
              </Button>
            </View>
          ) : (
            tasks.map((task) => (
              <TaskCard
                key={`${task.serverId}:${task.id}`}
                task={task}
                singleHost={singleHost}
                mutating={mutatingTaskId === task.id}
                originLookup={originLookups.get(`${task.serverId}:${task.id}`)}
                onSetStatus={handleSetStatus}
                onDelete={handleDelete}
                onCheckOrigin={handleCheckOrigin}
              />
            ))
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
  mutating,
  originLookup,
  onSetStatus,
  onDelete,
  onCheckOrigin,
}: {
  task: AggregatedTask;
  singleHost: boolean;
  mutating: boolean;
  originLookup: OriginLookupState | undefined;
  onSetStatus: (task: AggregatedTask, status: "done" | "open") => void;
  onDelete: (task: AggregatedTask) => void;
  onCheckOrigin: (task: AggregatedTask) => void;
}): ReactElement {
  const isDone = task.status === "done";
  const titleStyle = useMemo(
    () => (isDone ? [styles.cardTitle, styles.cardTitleDone] : [styles.cardTitle]),
    [isDone],
  );
  const handleToggleStatus = useCallback(
    () => onSetStatus(task, isDone ? "open" : "done"),
    [onSetStatus, task, isDone],
  );
  const handleDeletePress = useCallback(() => onDelete(task), [onDelete, task]);
  const handleCheckOriginPress = useCallback(() => onCheckOrigin(task), [onCheckOrigin, task]);

  return (
    <View style={styles.card} testID={`task-card-${task.id}`}>
      <View style={styles.cardHeader}>
        <Text style={titleStyle} numberOfLines={2}>
          {task.title}
        </Text>
        <Text style={styles.statusBadge}>{task.status}</Text>
      </View>
      {!singleHost ? <Text style={styles.metaText}>{task.serverName}</Text> : null}
      {task.repos.length > 0 ? (
        <View style={styles.chipsRow}>
          {task.repos.map((repo) => (
            <View key={repo} style={styles.chip}>
              <Text style={styles.chipText} numberOfLines={1}>
                {repo}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
      {task.origin ? (
        <View style={styles.originRow}>
          <Text style={styles.metaText}>{task.origin}</Text>
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
      {originLookup?.kind === "loaded" ? (
        <Text style={styles.originResult}>
          {`Origin: [${originLookup.status}] ${originLookup.rawStatus} — ${originLookup.title}`}
        </Text>
      ) : null}
      {originLookup?.kind === "error" ? (
        <Text style={styles.originError}>{originLookup.message}</Text>
      ) : null}
      <View style={styles.cardActions}>
        <Button
          variant="ghost"
          size="sm"
          disabled={mutating}
          onPress={handleDeletePress}
          testID={`task-delete-${task.id}`}
        >
          Delete
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={mutating}
          onPress={handleToggleStatus}
          testID={`task-toggle-${task.id}`}
        >
          {isDone ? "Reopen" : "Mark done"}
        </Button>
      </View>
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
  toolbarHint: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
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
  chipsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
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
  originRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
  },
  originResult: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  originError: {
    color: theme.colors.palette.red[300],
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
    maxWidth: 420,
  },
}));
