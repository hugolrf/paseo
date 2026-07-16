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
}

const AZURE_API_VERSION = "7.1";

const AzureWorkItemSchema = z.object({
  id: z.number(),
  fields: z.record(z.string(), z.unknown()),
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
    },
  };
}
