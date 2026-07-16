import { join } from "node:path";
import type pino from "pino";
import { getErrorMessage } from "@getpaseo/protocol/error-utils";
import type { SessionInboundMessage, SessionOutboundMessage } from "../../messages.js";
import { loadPersistedConfig } from "../../persisted-config.js";
import {
  createOriginsService,
  type OriginsService,
} from "../../../services/origins/origins-service.js";
import { FileTaskStore } from "../../../tasks/task-store.js";
import type { Task, TaskStore } from "../../../tasks/types.js";

export interface TasksSessionHost {
  emit(msg: SessionOutboundMessage): void;
}

export interface TasksSessionOptions {
  host: TasksSessionHost;
  paseoHome: string;
  logger: pino.Logger;
  // Test seams; production uses the file store under $PASEO_HOME/tasks and
  // an origins service reading $PASEO_HOME/config.json.
  store?: TaskStore;
  originsService?: OriginsService;
}

type TaskPayload = Omit<Task, "raw">;

function toTaskPayload(task: Task): TaskPayload {
  const { raw: _raw, ...payload } = task;
  return payload;
}

/**
 * A client's task request surface: stateless request/response over the file-backed
 * task store at $PASEO_HOME/tasks. Tasks are cross-repo work items — each task can
 * reference many repository refs and many agent (work session) ids.
 */
export class TasksSession {
  private readonly host: TasksSessionHost;
  private readonly store: TaskStore;
  private readonly origins: OriginsService;
  private readonly logger: pino.Logger;

  constructor(options: TasksSessionOptions) {
    this.host = options.host;
    this.store = options.store ?? new FileTaskStore(join(options.paseoHome, "tasks"));
    this.origins =
      options.originsService ??
      createOriginsService({
        readConfig: () => loadPersistedConfig(options.paseoHome, options.logger).origins,
      });
    this.logger = options.logger;
  }

  async handleTasksOriginsGetIssueRequest(
    msg: Extract<SessionInboundMessage, { type: "tasks.origins.get_issue.request" }>,
  ): Promise<void> {
    try {
      const issue = await this.origins.getIssue(msg.ref);
      this.host.emit({
        type: "tasks.origins.get_issue.response",
        payload: { ref: msg.ref, issue, error: null, requestId: msg.requestId },
      });
    } catch (error) {
      this.logger.warn({ err: error, ref: msg.ref }, "tasks.origins.get_issue failed");
      this.host.emit({
        type: "tasks.origins.get_issue.response",
        payload: {
          ref: msg.ref,
          issue: null,
          error: getErrorMessage(error),
          requestId: msg.requestId,
        },
      });
    }
  }

  async handleTasksCoreCreateRequest(
    msg: Extract<SessionInboundMessage, { type: "tasks.core.create.request" }>,
  ): Promise<void> {
    try {
      const task = await this.store.create(msg.title, {
        status: msg.status,
        deps: msg.deps,
        parentId: msg.parentId,
        body: msg.body,
        acceptanceCriteria: msg.acceptanceCriteria,
        assignee: msg.assignee,
        priority: msg.priority,
        repos: msg.repos,
        agentIds: msg.agentIds,
        origin: msg.origin,
      });
      this.host.emit({
        type: "tasks.core.create.response",
        payload: { task: toTaskPayload(task), error: null, requestId: msg.requestId },
      });
    } catch (error) {
      this.logger.warn({ err: error }, "tasks.core.create failed");
      this.host.emit({
        type: "tasks.core.create.response",
        payload: { task: null, error: getErrorMessage(error), requestId: msg.requestId },
      });
    }
  }

  async handleTasksCoreListRequest(
    msg: Extract<SessionInboundMessage, { type: "tasks.core.list.request" }>,
  ): Promise<void> {
    try {
      const tasks = msg.repo ? await this.store.getByRepo(msg.repo) : await this.store.list();
      this.host.emit({
        type: "tasks.core.list.response",
        payload: { tasks: tasks.map(toTaskPayload), error: null, requestId: msg.requestId },
      });
    } catch (error) {
      this.logger.warn({ err: error }, "tasks.core.list failed");
      this.host.emit({
        type: "tasks.core.list.response",
        payload: { tasks: [], error: getErrorMessage(error), requestId: msg.requestId },
      });
    }
  }

  async handleTasksCoreUpdateRequest(
    msg: Extract<SessionInboundMessage, { type: "tasks.core.update.request" }>,
  ): Promise<void> {
    try {
      const changes: Partial<Omit<Task, "id" | "created">> = {};
      if (msg.title !== undefined) changes.title = msg.title;
      if (msg.status !== undefined) changes.status = msg.status;
      if (msg.body !== undefined) changes.body = msg.body;
      if (msg.acceptanceCriteria !== undefined) changes.acceptanceCriteria = msg.acceptanceCriteria;
      if (msg.assignee !== undefined) changes.assignee = msg.assignee;
      if (msg.priority !== undefined) changes.priority = msg.priority;
      if (msg.repos !== undefined) changes.repos = msg.repos;
      if (msg.agentIds !== undefined) changes.agentIds = msg.agentIds;
      if (msg.origin !== undefined) changes.origin = msg.origin;

      const task = await this.store.update(msg.id, changes);
      this.host.emit({
        type: "tasks.core.update.response",
        payload: { task: toTaskPayload(task), error: null, requestId: msg.requestId },
      });
    } catch (error) {
      this.logger.warn({ err: error }, "tasks.core.update failed");
      this.host.emit({
        type: "tasks.core.update.response",
        payload: { task: null, error: getErrorMessage(error), requestId: msg.requestId },
      });
    }
  }

  async handleTasksCoreDeleteRequest(
    msg: Extract<SessionInboundMessage, { type: "tasks.core.delete.request" }>,
  ): Promise<void> {
    try {
      await this.store.delete(msg.id);
      this.host.emit({
        type: "tasks.core.delete.response",
        payload: { id: msg.id, success: true, error: null, requestId: msg.requestId },
      });
    } catch (error) {
      this.logger.warn({ err: error }, "tasks.core.delete failed");
      this.host.emit({
        type: "tasks.core.delete.response",
        payload: {
          id: msg.id,
          success: false,
          error: getErrorMessage(error),
          requestId: msg.requestId,
        },
      });
    }
  }
}
