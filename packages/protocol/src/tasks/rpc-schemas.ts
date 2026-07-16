import { z } from "zod";

export const TaskStatusSchema = z.enum(["draft", "open", "in_progress", "done", "failed"]);

export const TaskNoteSchema = z.object({
  timestamp: z.string(),
  content: z.string(),
});

export const TaskPayloadSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: TaskStatusSchema,
  deps: z.array(z.string()),
  parentId: z.string().optional(),
  body: z.string(),
  acceptanceCriteria: z.array(z.string()),
  notes: z.array(TaskNoteSchema),
  created: z.string(),
  assignee: z.string().optional(),
  priority: z.number().optional(),
  // Repository refs this task spans (workspace cwd, "owner/repo", or remote URL).
  // A task may target zero, one, or many repos.
  repos: z.array(z.string()),
  // Paseo agent (work session) ids attached to this task.
  agentIds: z.array(z.string()),
  // Upstream issue ref as "<provider>:<key>", e.g. "jira:TCE-123" or "linear:HUG-1".
  origin: z.string().optional(),
});

export const TasksCoreCreateRequestSchema = z.object({
  type: z.literal("tasks.core.create.request"),
  title: z.string(),
  status: TaskStatusSchema.optional(),
  deps: z.array(z.string()).optional(),
  parentId: z.string().optional(),
  body: z.string().optional(),
  acceptanceCriteria: z.array(z.string()).optional(),
  assignee: z.string().optional(),
  priority: z.number().optional(),
  repos: z.array(z.string()).optional(),
  agentIds: z.array(z.string()).optional(),
  origin: z.string().optional(),
  requestId: z.string(),
});

export const TasksCoreListRequestSchema = z.object({
  type: z.literal("tasks.core.list.request"),
  // When set, only tasks linked to this repository ref are returned.
  repo: z.string().optional(),
  requestId: z.string(),
});

export const TasksCoreUpdateRequestSchema = z.object({
  type: z.literal("tasks.core.update.request"),
  id: z.string(),
  title: z.string().optional(),
  status: TaskStatusSchema.optional(),
  body: z.string().optional(),
  acceptanceCriteria: z.array(z.string()).optional(),
  assignee: z.string().optional(),
  priority: z.number().optional(),
  repos: z.array(z.string()).optional(),
  agentIds: z.array(z.string()).optional(),
  origin: z.string().optional(),
  requestId: z.string(),
});

export const TasksCoreDeleteRequestSchema = z.object({
  type: z.literal("tasks.core.delete.request"),
  id: z.string(),
  requestId: z.string(),
});

export const TasksCoreCreateResponseSchema = z.object({
  type: z.literal("tasks.core.create.response"),
  payload: z.object({
    task: TaskPayloadSchema.nullable(),
    error: z.string().nullable(),
    requestId: z.string(),
  }),
});

export const TasksCoreListResponseSchema = z.object({
  type: z.literal("tasks.core.list.response"),
  payload: z.object({
    tasks: z.array(TaskPayloadSchema),
    error: z.string().nullable(),
    requestId: z.string(),
  }),
});

export const TasksCoreUpdateResponseSchema = z.object({
  type: z.literal("tasks.core.update.response"),
  payload: z.object({
    task: TaskPayloadSchema.nullable(),
    error: z.string().nullable(),
    requestId: z.string(),
  }),
});

export const TasksCoreDeleteResponseSchema = z.object({
  type: z.literal("tasks.core.delete.response"),
  payload: z.object({
    id: z.string(),
    success: z.boolean(),
    error: z.string().nullable(),
    requestId: z.string(),
  }),
});

export const OriginIssueStatusSchema = z.enum([
  "todo",
  "in_progress",
  "in_review",
  "done",
  "canceled",
  "unknown",
]);

export const OriginIssuePayloadSchema = z.object({
  provider: z.enum(["jira", "azure", "gitlab", "linear"]),
  key: z.string(),
  title: z.string(),
  status: OriginIssueStatusSchema,
  rawStatus: z.string(),
  url: z.string().nullable(),
  updatedAt: z.string().nullable(),
});

export const TasksOriginsGetIssueRequestSchema = z.object({
  type: z.literal("tasks.origins.get_issue.request"),
  // "<provider>:<key>", e.g. "jira:TCE-123", "azure:12345", "linear:HUG-1".
  ref: z.string(),
  requestId: z.string(),
});

export const TasksOriginsGetIssueResponseSchema = z.object({
  type: z.literal("tasks.origins.get_issue.response"),
  payload: z.object({
    ref: z.string(),
    issue: OriginIssuePayloadSchema.nullable(),
    error: z.string().nullable(),
    requestId: z.string(),
  }),
});

export const TasksSyncRunRequestSchema = z.object({
  type: z.literal("tasks.sync.run.request"),
  requestId: z.string(),
});

export const TasksSyncRunResponseSchema = z.object({
  type: z.literal("tasks.sync.run.response"),
  payload: z.object({
    created: z.number(),
    updated: z.number(),
    closed: z.number(),
    unchanged: z.number(),
    // Origins that failed during the sweep; successful origins still synced.
    originErrors: z.array(
      z.object({
        provider: z.string(),
        message: z.string(),
      }),
    ),
    error: z.string().nullable(),
    requestId: z.string(),
  }),
});
