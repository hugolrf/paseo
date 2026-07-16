import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pino from "pino";
import type { SessionOutboundMessage } from "../../messages.js";
import { TasksSession } from "./tasks-session.js";

let tempHome: string;
let emitted: SessionOutboundMessage[];
let session: TasksSession;

beforeEach(async () => {
  tempHome = await mkdtemp(join(tmpdir(), "tasks-session-test-"));
  emitted = [];
  session = new TasksSession({
    host: { emit: (msg) => emitted.push(msg) },
    paseoHome: tempHome,
    logger: pino({ level: "silent" }),
  });
});

afterEach(async () => {
  await rm(tempHome, { recursive: true, force: true });
});

function lastEmitted<T extends SessionOutboundMessage["type"]>(
  type: T,
): Extract<SessionOutboundMessage, { type: T }> {
  const msg = emitted.at(-1);
  expect(msg?.type).toBe(type);
  return msg as Extract<SessionOutboundMessage, { type: T }>;
}

describe("tasks.core.create", () => {
  it("creates a task linked to repos and agents", async () => {
    await session.handleTasksCoreCreateRequest({
      type: "tasks.core.create.request",
      title: "Cross-repo feature",
      repos: ["acme/backend", "acme/frontend"],
      agentIds: ["agent-1"],
      requestId: "req-1",
    });

    const response = lastEmitted("tasks.core.create.response");
    expect(response.payload.error).toBeNull();
    expect(response.payload.requestId).toBe("req-1");
    expect(response.payload.task?.title).toBe("Cross-repo feature");
    expect(response.payload.task?.repos).toEqual(["acme/backend", "acme/frontend"]);
    expect(response.payload.task?.agentIds).toEqual(["agent-1"]);
  });
});

describe("tasks.core.list", () => {
  it("lists all tasks and filters by repo", async () => {
    await session.handleTasksCoreCreateRequest({
      type: "tasks.core.create.request",
      title: "Backend task",
      repos: ["acme/backend"],
      requestId: "req-1",
    });
    await session.handleTasksCoreCreateRequest({
      type: "tasks.core.create.request",
      title: "Unrelated task",
      requestId: "req-2",
    });

    await session.handleTasksCoreListRequest({
      type: "tasks.core.list.request",
      requestId: "req-3",
    });
    expect(lastEmitted("tasks.core.list.response").payload.tasks).toHaveLength(2);

    await session.handleTasksCoreListRequest({
      type: "tasks.core.list.request",
      repo: "acme/backend",
      requestId: "req-4",
    });
    const filtered = lastEmitted("tasks.core.list.response").payload.tasks;
    expect(filtered).toHaveLength(1);
    expect(filtered[0].title).toBe("Backend task");
  });
});

describe("tasks.core.update", () => {
  it("updates repos and agent links", async () => {
    await session.handleTasksCoreCreateRequest({
      type: "tasks.core.create.request",
      title: "Task",
      requestId: "req-1",
    });
    const created = lastEmitted("tasks.core.create.response").payload.task;
    expect(created).not.toBeNull();

    await session.handleTasksCoreUpdateRequest({
      type: "tasks.core.update.request",
      id: created!.id,
      status: "in_progress",
      repos: ["acme/backend"],
      agentIds: ["agent-9"],
      requestId: "req-2",
    });

    const response = lastEmitted("tasks.core.update.response");
    expect(response.payload.error).toBeNull();
    expect(response.payload.task?.status).toBe("in_progress");
    expect(response.payload.task?.repos).toEqual(["acme/backend"]);
    expect(response.payload.task?.agentIds).toEqual(["agent-9"]);
  });

  it("responds with an error for unknown task ids", async () => {
    await session.handleTasksCoreUpdateRequest({
      type: "tasks.core.update.request",
      id: "nonexistent",
      title: "New title",
      requestId: "req-1",
    });

    const response = lastEmitted("tasks.core.update.response");
    expect(response.payload.task).toBeNull();
    expect(response.payload.error).toContain("Task not found");
  });
});

describe("tasks.core.delete", () => {
  it("deletes a task", async () => {
    await session.handleTasksCoreCreateRequest({
      type: "tasks.core.create.request",
      title: "Task",
      requestId: "req-1",
    });
    const created = lastEmitted("tasks.core.create.response").payload.task;

    await session.handleTasksCoreDeleteRequest({
      type: "tasks.core.delete.request",
      id: created!.id,
      requestId: "req-2",
    });
    expect(lastEmitted("tasks.core.delete.response").payload.success).toBe(true);

    await session.handleTasksCoreListRequest({
      type: "tasks.core.list.request",
      requestId: "req-3",
    });
    expect(lastEmitted("tasks.core.list.response").payload.tasks).toHaveLength(0);
  });
});
