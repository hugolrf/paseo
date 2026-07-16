import { useCallback, useMemo, useState, type ReactElement } from "react";
import { ScrollView, Text, View } from "react-native";
import { useIsFocused } from "@react-navigation/native";
import { GitPullRequest, RefreshCw } from "lucide-react-native";
import { StyleSheet } from "react-native-unistyles";
import { MenuHeader } from "@/components/headers/menu-header";
import { Button } from "@/components/ui/button";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { SelectField, type SelectFieldOption } from "@/components/ui/select-field";
import { useFetchQuery } from "@/data/query";
import { useHostFeatureMap } from "@/runtime/host-features";
import { getHostRuntimeStore, useHosts } from "@/runtime/host-runtime";
import { useWorkspaceStructure } from "@/stores/session-store-hooks";
import { toErrorMessage } from "@/utils/error-messages";
import type { SessionOutboundMessage } from "@getpaseo/protocol/messages";

type PullRequestSummary = Extract<
  SessionOutboundMessage,
  { type: "checkout.github.list_pull_requests.response" }
>["payload"]["pullRequests"][number];

interface RepoTarget {
  serverId: string;
  cwd: string;
  label: string;
}

type DiffState =
  | { kind: "loading" }
  | { kind: "loaded"; diff: string; truncated: boolean }
  | { kind: "error"; message: string };

type ReviewEvent = "approve" | "request_changes" | "comment";

type ReviewState =
  | { kind: "sending"; event: ReviewEvent }
  | { kind: "sent"; event: ReviewEvent }
  | { kind: "error"; message: string };

const REVIEW_SENT_LABELS: Record<ReviewEvent, string> = {
  approve: "Approved",
  request_changes: "Changes requested",
  comment: "Comment posted",
};

export function PrsScreen(): ReactElement {
  const isFocused = useIsFocused();

  if (!isFocused) {
    return <View style={styles.container} />;
  }

  return <PrsScreenContent />;
}

function PrsScreenContent(): ReactElement {
  const hosts = useHosts();
  const runtime = getHostRuntimeStore();
  const allServerIds = useMemo(() => hosts.map((host) => host.serverId), [hosts]);
  // COMPAT(checkoutGithubPrReview): added in v0.1.110 (hugolrf fork), drop the gate when floor >= v0.1.110.
  const featureMap = useHostFeatureMap(allServerIds, "checkoutGithubPrReview");
  const supportedServerIds = useMemo(
    () => allServerIds.filter((serverId) => featureMap.get(serverId) === true),
    [allServerIds, featureMap],
  );
  const structure = useWorkspaceStructure(supportedServerIds);

  const targets = useMemo<RepoTarget[]>(() => {
    const result: RepoTarget[] = [];
    const seen = new Set<string>();
    for (const project of structure.projects) {
      if (project.projectKind !== "git") continue;
      for (const host of project.hosts) {
        const key = `${host.serverId}|${host.iconWorkingDir}`;
        if (seen.has(key)) continue;
        seen.add(key);
        result.push({
          serverId: host.serverId,
          cwd: host.iconWorkingDir,
          label: project.projectName,
        });
      }
    }
    return result.sort((a, b) => a.label.localeCompare(b.label));
  }, [structure]);

  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const selected = useMemo<RepoTarget | null>(() => {
    if (targets.length === 0) return null;
    const found = selectedKey
      ? targets.find((target) => `${target.serverId}|${target.cwd}` === selectedKey)
      : undefined;
    return found ?? targets[0];
  }, [targets, selectedKey]);

  const options = useMemo<SelectFieldOption<string>[]>(
    () =>
      targets.map((target) => ({
        id: `${target.serverId}|${target.cwd}`,
        value: `${target.serverId}|${target.cwd}`,
        label: target.label,
        description: target.cwd,
      })),
    [targets],
  );

  const selectedDisplay = useMemo(
    () => (selected ? { label: selected.label, description: selected.cwd } : null),
    [selected],
  );

  const handleSelect = useCallback((value: string) => {
    setSelectedKey(value);
  }, []);

  const query = useFetchQuery({
    queryKey: ["github-prs", selected?.serverId ?? "", selected?.cwd ?? ""],
    queryFn: async () => {
      if (!selected) return { pullRequests: [] as PullRequestSummary[] };
      const client = runtime.getClient(selected.serverId);
      if (!client) throw new Error("Host is not connected");
      const payload = await client.checkoutGithubListPullRequests({
        cwd: selected.cwd,
        limit: 30,
      });
      if (payload.error) {
        throw new Error(payload.error.message);
      }
      return { pullRequests: payload.pullRequests };
    },
    dataShape: "list",
    staleTimeMs: 15_000,
    enabled: selected !== null,
  });

  const handleRefetch = useCallback(() => {
    void query.refetch();
  }, [query]);

  const pullRequests = query.data?.pullRequests ?? [];

  if (supportedServerIds.length === 0) {
    return (
      <View style={styles.container}>
        <MenuHeader title="Pull Requests" />
        <View style={styles.centered}>
          <GitPullRequest size={styles.emptyIcon.width} color={styles.emptyIcon.color} />
          <Text style={styles.message}>Update your host to review pull requests</Text>
        </View>
      </View>
    );
  }

  let listBody: ReactElement;
  if (query.isLoading && selected) {
    listBody = (
      <View style={styles.centered}>
        <LoadingSpinner size="large" color={styles.spinner.color} />
      </View>
    );
  } else if (query.isError) {
    listBody = (
      <View style={styles.centered}>
        <Text style={styles.message}>{toErrorMessage(query.error)}</Text>
        <Button variant="ghost" onPress={handleRefetch} testID="prs-retry">
          Try again
        </Button>
      </View>
    );
  } else {
    listBody = (
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        testID="prs-list"
      >
        {pullRequests.length === 0 ? (
          <View style={styles.centeredGrow}>
            <GitPullRequest size={styles.emptyIcon.width} color={styles.emptyIcon.color} />
            <Text style={styles.emptyTitle}>
              {selected ? "No open pull requests" : "No repository selected"}
            </Text>
          </View>
        ) : (
          pullRequests.map((pullRequest) =>
            selected ? (
              <PullRequestCard
                key={pullRequest.number}
                target={selected}
                pullRequest={pullRequest}
              />
            ) : null,
          )
        )}
      </ScrollView>
    );
  }

  return (
    <View style={styles.container}>
      <MenuHeader title="Pull Requests" />
      <View style={styles.body}>
        <View style={styles.toolbar}>
          <View style={styles.toolbarSelect}>
            <SelectField<string>
              label="Repository"
              value={selected ? `${selected.serverId}|${selected.cwd}` : null}
              selectedDisplay={selectedDisplay}
              options={options}
              onChange={handleSelect}
              placeholder="Pick a repository"
              emptyText="No git projects on supported hosts"
              size="sm"
            />
          </View>
          <Button
            variant="outline"
            size="sm"
            leftIcon={RefreshCw}
            loading={query.isRefetching}
            onPress={handleRefetch}
            testID="prs-refresh"
          >
            Refresh
          </Button>
        </View>
        {listBody}
      </View>
    </View>
  );
}

function PullRequestCard({
  target,
  pullRequest,
}: {
  target: RepoTarget;
  pullRequest: PullRequestSummary;
}): ReactElement {
  const runtime = getHostRuntimeStore();
  const [expanded, setExpanded] = useState(false);
  const [diffState, setDiffState] = useState<DiffState | null>(null);
  const [reviewBody, setReviewBody] = useState("");
  const [reviewState, setReviewState] = useState<ReviewState | null>(null);

  const loadDiff = useCallback(async () => {
    const client = runtime.getClient(target.serverId);
    if (!client) return;
    setDiffState({ kind: "loading" });
    try {
      const payload = await client.checkoutGithubGetPrDiff({
        cwd: target.cwd,
        prNumber: pullRequest.number,
      });
      if (payload.error || payload.diff === null) {
        throw new Error(payload.error ? payload.error.message : "Failed to load diff");
      }
      setDiffState({ kind: "loaded", diff: payload.diff, truncated: payload.truncated });
    } catch (error) {
      setDiffState({ kind: "error", message: toErrorMessage(error) });
    }
  }, [runtime, target, pullRequest.number]);

  const toggleExpanded = useCallback(() => {
    setExpanded((current) => {
      const next = !current;
      if (next && diffState === null) {
        void loadDiff();
      }
      return next;
    });
  }, [diffState, loadDiff]);

  const sendReview = useCallback(
    async (event: ReviewEvent) => {
      const client = runtime.getClient(target.serverId);
      if (!client) return;
      setReviewState({ kind: "sending", event });
      try {
        const payload = await client.checkoutGithubReviewPr({
          cwd: target.cwd,
          prNumber: pullRequest.number,
          event,
          ...(reviewBody.trim() ? { body: reviewBody.trim() } : {}),
        });
        if (payload.error || !payload.success) {
          throw new Error(payload.error ? payload.error.message : "Review failed");
        }
        setReviewState({ kind: "sent", event });
        setReviewBody("");
      } catch (error) {
        setReviewState({ kind: "error", message: toErrorMessage(error) });
      }
    },
    [runtime, target, pullRequest.number, reviewBody],
  );

  const handleComment = useCallback(() => sendReview("comment"), [sendReview]);
  const handleRequestChanges = useCallback(() => sendReview("request_changes"), [sendReview]);
  const handleApprove = useCallback(() => sendReview("approve"), [sendReview]);

  const sending = reviewState?.kind === "sending";

  let diffBody: ReactElement | null = null;
  if (diffState?.kind === "loading") {
    diffBody = <LoadingSpinner size="small" color={styles.spinner.color} />;
  } else if (diffState?.kind === "error") {
    diffBody = <Text style={styles.errorText}>{diffState.message}</Text>;
  } else if (diffState?.kind === "loaded") {
    diffBody = (
      <View style={styles.diffBox}>
        <ScrollView style={styles.diffScroll} nestedScrollEnabled>
          <ScrollView horizontal showsHorizontalScrollIndicator>
            <Text style={styles.diffText} testID={`pr-diff-${pullRequest.number}`}>
              {diffState.diff}
            </Text>
          </ScrollView>
        </ScrollView>
        {diffState.truncated ? (
          <Text style={styles.metaText}>Diff truncated at 256 KiB</Text>
        ) : null}
      </View>
    );
  }

  return (
    <View style={styles.card} testID={`pr-card-${pullRequest.number}`}>
      <View style={styles.cardHeader}>
        <Text style={styles.cardTitle} numberOfLines={2}>
          {`#${pullRequest.number} ${pullRequest.title}`}
        </Text>
        <Text style={styles.statusBadge}>{pullRequest.state}</Text>
      </View>
      <Text style={styles.metaText} numberOfLines={1}>
        {`${pullRequest.headRefName} → ${pullRequest.baseRefName}`}
      </Text>
      <View style={styles.cardActions}>
        <Button variant="outline" size="sm" onPress={toggleExpanded}>
          {expanded ? "Hide details" : "Review"}
        </Button>
      </View>
      {expanded ? (
        <View style={styles.detail}>
          {diffBody}
          <Field label="Review comment" hint="Required for Request changes and Comment">
            <FormTextInput
              value={reviewBody}
              onChangeText={setReviewBody}
              placeholder="What should change?"
              multiline
              testID={`pr-review-body-${pullRequest.number}`}
            />
          </Field>
          <View style={styles.cardActions}>
            <Button variant="ghost" size="sm" disabled={sending} onPress={handleComment}>
              Comment
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={sending}
              onPress={handleRequestChanges}
              testID={`pr-request-changes-${pullRequest.number}`}
            >
              Request changes
            </Button>
            <Button variant="default" size="sm" disabled={sending} onPress={handleApprove}>
              Approve
            </Button>
          </View>
          {reviewState?.kind === "sent" ? (
            <Text style={styles.successText}>{REVIEW_SENT_LABELS[reviewState.event]}</Text>
          ) : null}
          {reviewState?.kind === "error" ? (
            <Text style={styles.errorText}>{reviewState.message}</Text>
          ) : null}
        </View>
      ) : null}
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
    gap: theme.spacing[3],
    padding: theme.spacing[6],
  },
  toolbar: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    gap: theme.spacing[3],
    paddingHorizontal: { xs: theme.spacing[3], md: theme.spacing[6] },
    paddingTop: theme.spacing[4],
    zIndex: 10,
  },
  toolbarSelect: {
    flex: 1,
    maxWidth: 420,
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
  cardActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: theme.spacing[2],
  },
  detail: {
    gap: theme.spacing[3],
  },
  diffBox: {
    gap: theme.spacing[1],
  },
  diffScroll: {
    maxHeight: 360,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface0,
  },
  diffText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.xs,
    fontFamily: "monospace",
    padding: theme.spacing[3],
  },
  metaText: {
    color: theme.colors.foregroundMuted,
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
  successText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  emptyTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    textAlign: "center",
  },
  spinner: {
    color: theme.colors.foregroundMuted,
  },
  emptyIcon: {
    color: theme.colors.foregroundMuted,
    width: theme.iconSize.lg,
  },
}));
