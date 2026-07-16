import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileTaskStore } from "./task-store.js";
import { syncTasksFromOrigins } from "./task-sync.js";
import type { OriginIssue } from "../services/origins/types.js";

let tempDir: string;
let store: FileTaskStore;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "task-sync-test-"));
  store = new FileTaskStore(tempDir);
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

function jiraIssue(key: string, overrides: Partial<OriginIssue> = {}): OriginIssue {
  return {
    provider: "jira",
    key,
    title: `Issue ${key}`,
    status: "todo",
    rawStatus: "To Do",
    url: `https://acme.atlassian.net/browse/${key}`,
    updatedAt: null,
    ...overrides,
  };
}

describe("syncTasksFromOrigins", () => {
  it("creates tasks for new origin issues", async () => {
    const result = await syncTasksFromOrigins({
      store,
      issues: [jiraIssue("TCE-1"), jiraIssue("TCE-2", { status: "in_progress" })],
      syncedProviders: ["jira"],
    });

    expect(result).toEqual({ created: 2, updated: 0, closed: 0, unchanged: 0 });
    const tasks = await store.list();
    expect(tasks).toHaveLength(2);
    const byOrigin = new Map(tasks.map((t) => [t.origin, t]));
    expect(byOrigin.get("jira:TCE-1")?.status).toBe("open");
    expect(byOrigin.get("jira:TCE-1")?.body).toContain("browse/TCE-1");
    expect(byOrigin.get("jira:TCE-2")?.status).toBe("in_progress");
  });

  it("is idempotent when nothing changed", async () => {
    const issues = [jiraIssue("TCE-1")];
    await syncTasksFromOrigins({ store, issues, syncedProviders: ["jira"] });

    const second = await syncTasksFromOrigins({ store, issues, syncedProviders: ["jira"] });

    expect(second).toEqual({ created: 0, updated: 0, closed: 0, unchanged: 1 });
    expect(await store.list()).toHaveLength(1);
  });

  it("mirrors title and status changes from the origin", async () => {
    await syncTasksFromOrigins({
      store,
      issues: [jiraIssue("TCE-1")],
      syncedProviders: ["jira"],
    });

    const result = await syncTasksFromOrigins({
      store,
      issues: [jiraIssue("TCE-1", { title: "Renamed upstream", status: "in_review" })],
      syncedProviders: ["jira"],
    });

    expect(result.updated).toBe(1);
    const [task] = await store.list();
    expect(task.title).toBe("Renamed upstream");
    expect(task.status).toBe("in_progress");
  });

  it("closes tasks whose origin left the sweep", async () => {
    await syncTasksFromOrigins({
      store,
      issues: [jiraIssue("TCE-1"), jiraIssue("TCE-2")],
      syncedProviders: ["jira"],
    });

    const result = await syncTasksFromOrigins({
      store,
      issues: [jiraIssue("TCE-1")],
      syncedProviders: ["jira"],
    });

    expect(result.closed).toBe(1);
    const tasks = await store.list();
    expect(tasks.find((t) => t.origin === "jira:TCE-2")?.status).toBe("done");
  });

  it("does not close tasks when their provider failed to answer", async () => {
    await syncTasksFromOrigins({
      store,
      issues: [jiraIssue("TCE-1")],
      syncedProviders: ["jira"],
    });

    // Jira errored this sweep: it is not in syncedProviders, so its mirrored
    // tasks must survive even though no jira issues were listed.
    const result = await syncTasksFromOrigins({
      store,
      issues: [],
      syncedProviders: ["linear"],
    });

    expect(result.closed).toBe(0);
    const [task] = await store.list();
    expect(task.status).toBe("open");
  });

  it("keeps locally authored tasks (no origin) untouched", async () => {
    await store.create("Local-only task");

    const result = await syncTasksFromOrigins({
      store,
      issues: [],
      syncedProviders: ["jira", "azure", "gitlab", "linear"],
    });

    expect(result).toEqual({ created: 0, updated: 0, closed: 0, unchanged: 0 });
    const [task] = await store.list();
    expect(task.title).toBe("Local-only task");
    expect(task.status).toBe("open");
  });

  it("preserves repo and agent links across syncs", async () => {
    await syncTasksFromOrigins({
      store,
      issues: [jiraIssue("TCE-1")],
      syncedProviders: ["jira"],
    });
    const [created] = await store.list();
    await store.addRepo(created.id, "acme/backend");
    await store.linkAgent(created.id, "agent-1");

    await syncTasksFromOrigins({
      store,
      issues: [jiraIssue("TCE-1", { status: "in_progress" })],
      syncedProviders: ["jira"],
    });

    const [task] = await store.list();
    expect(task.status).toBe("in_progress");
    expect(task.repos).toEqual(["acme/backend"]);
    expect(task.agentIds).toEqual(["agent-1"]);
  });
});
