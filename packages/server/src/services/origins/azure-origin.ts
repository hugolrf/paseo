import { z } from "zod";
import {
  OriginRefError,
  OriginRequestError,
  type NormalizedOriginStatus,
  type OriginFetch,
  type OriginIssue,
  type OriginProvider,
} from "./types.js";

export interface AzureOriginConfig {
  organization: string;
  project: string;
  pat: string;
  // WIQL used by task sync; defaults to the caller's open assigned work items.
  wiql?: string;
}

const DEFAULT_AZURE_SYNC_WIQL =
  "SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project" +
  " AND [System.State] NOT IN ('Closed','Done','Completed','Removed','Cancel')" +
  " AND [System.AssignedTo] = @Me ORDER BY [System.ChangedDate] DESC";

// The work items endpoint accepts at most 200 ids per request.
const AZURE_MAX_IDS_PER_REQUEST = 200;

const AZURE_API_VERSION = "7.1";

const AzureWorkItemSchema = z.object({
  id: z.number(),
  fields: z.record(z.string(), z.unknown()),
});

const AzureWiqlResponseSchema = z.object({
  workItems: z.array(z.object({ id: z.number() })).optional(),
});

const AzureWorkItemsResponseSchema = z.object({
  value: z.array(AzureWorkItemSchema).optional(),
});

// Azure Boards state names are workflow-specific; bucket them by substring the
// same way common process templates (Agile/Scrum/CMMI) name their states.
function normalizeAzureStatus(rawStatus: string): NormalizedOriginStatus {
  const raw = rawStatus.toLowerCase();
  if (/review|homolog|qa|test/.test(raw)) return "in_review";
  if (/done|closed|resolved|completed|conclu|final/.test(raw)) return "done";
  if (/removed|cancel/.test(raw)) return "canceled";
  if (/progress|doing|active|committed|fazendo/.test(raw)) return "in_progress";
  if (/new|to do|todo|proposed|approved|backlog/.test(raw)) return "todo";
  return "unknown";
}

function stringField(fields: Record<string, unknown>, name: string): string | null {
  const value = fields[name];
  return typeof value === "string" ? value : null;
}

export function createAzureOrigin(config: AzureOriginConfig, fetchFn: OriginFetch): OriginProvider {
  // Azure DevOps PATs authenticate as Basic with an empty username.
  const basicAuth = Buffer.from(`:${config.pat}`).toString("base64");
  const apiBase = `https://dev.azure.com/${encodeURIComponent(config.organization)}/${encodeURIComponent(config.project)}`;

  return {
    id: "azure",

    async fetchIssue(key: string): Promise<OriginIssue> {
      if (!/^\d+$/.test(key)) {
        throw new OriginRefError(`Azure work item keys are numeric ids, got "${key}"`);
      }

      const response = await fetchFn(
        `${apiBase}/_apis/wit/workitems/${key}?api-version=${AZURE_API_VERSION}`,
        {
          headers: {
            Authorization: `Basic ${basicAuth}`,
            Accept: "application/json",
          },
        },
      );
      if (!response.ok) {
        throw new OriginRequestError({ provider: "azure", status: response.status });
      }

      const workItem = AzureWorkItemSchema.parse(await response.json());
      return toOriginIssue(apiBase, workItem);
    },

    async listMyIssues(): Promise<OriginIssue[]> {
      const wiqlResponse = await fetchFn(
        `${apiBase}/_apis/wit/wiql?api-version=${AZURE_API_VERSION}&$top=${AZURE_MAX_IDS_PER_REQUEST}`,
        {
          method: "POST",
          headers: {
            Authorization: `Basic ${basicAuth}`,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({ query: config.wiql ?? DEFAULT_AZURE_SYNC_WIQL }),
        },
      );
      if (!wiqlResponse.ok) {
        throw new OriginRequestError({ provider: "azure", status: wiqlResponse.status });
      }

      const wiql = AzureWiqlResponseSchema.parse(await wiqlResponse.json());
      const ids = (wiql.workItems ?? []).map((item) => item.id);
      if (ids.length === 0) {
        return [];
      }

      // Do not combine `fields` with `$expand` here — the API rejects it with 400.
      const itemsResponse = await fetchFn(
        `${apiBase}/_apis/wit/workitems?ids=${ids.join(",")}&api-version=${AZURE_API_VERSION}`,
        {
          headers: {
            Authorization: `Basic ${basicAuth}`,
            Accept: "application/json",
          },
        },
      );
      if (!itemsResponse.ok) {
        throw new OriginRequestError({ provider: "azure", status: itemsResponse.status });
      }

      const items = AzureWorkItemsResponseSchema.parse(await itemsResponse.json());
      return (items.value ?? []).map((workItem) => toOriginIssue(apiBase, workItem));
    },
  };
}

function toOriginIssue(
  apiBase: string,
  workItem: z.infer<typeof AzureWorkItemSchema>,
): OriginIssue {
  const rawStatus = stringField(workItem.fields, "System.State") ?? "";
  return {
    provider: "azure",
    key: String(workItem.id),
    title: stringField(workItem.fields, "System.Title") ?? "",
    status: normalizeAzureStatus(rawStatus),
    rawStatus,
    url: `${apiBase}/_workitems/edit/${workItem.id}`,
    updatedAt: stringField(workItem.fields, "System.ChangedDate"),
  };
}
