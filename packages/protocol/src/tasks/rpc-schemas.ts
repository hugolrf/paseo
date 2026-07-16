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
