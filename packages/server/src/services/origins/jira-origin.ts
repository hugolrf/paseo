import { z } from "zod";
import {
  OriginRequestError,
  type NormalizedOriginStatus,
  type OriginFetch,
  type OriginIssue,
  type OriginProvider,
} from "./types.js";

export interface JiraOriginConfig {
  baseUrl: string; // e.g. https://yourorg.atlassian.net
  email: string;
  apiToken: string;
}

const JiraIssueSchema = z.object({
  key: z.string(),
  fields: z.object({
    summary: z.string().nullish(),
    updated: z.string().nullish(),
    status: z
      .object({
        name: z.string().nullish(),
        statusCategory: z
          .object({
            key: z.string().nullish(),
          })
          .nullish(),
      })
      .nullish(),
  }),
});

// Jira's statusCategory.key is one of "new" | "indeterminate" | "done".
function normalizeJiraStatus(categoryKey: string | null, rawStatus: string) {
  const raw = rawStatus.toLowerCase();
  if (/review|homolog|qa|test/.test(raw)) return "in_review" as NormalizedOriginStatus;
  if (categoryKey === "done") return "done" as NormalizedOriginStatus;
  if (categoryKey === "indeterminate") return "in_progress" as NormalizedOriginStatus;
  if (categoryKey === "new") return "todo" as NormalizedOriginStatus;
  return "unknown" as NormalizedOriginStatus;
}

export function createJiraOrigin(config: JiraOriginConfig, fetchFn: OriginFetch): OriginProvider {
  const baseUrl = config.baseUrl.replace(/\/+$/, "");
  const basicAuth = Buffer.from(`${config.email}:${config.apiToken}`).toString("base64");

  return {
    id: "jira",

    async fetchIssue(key: string): Promise<OriginIssue> {
      const response = await fetchFn(
        `${baseUrl}/rest/api/3/issue/${encodeURIComponent(key)}?fields=summary,status,updated`,
        {
          headers: {
            Authorization: `Basic ${basicAuth}`,
            Accept: "application/json",
          },
        },
      );
      if (!response.ok) {
        throw new OriginRequestError({ provider: "jira", status: response.status });
      }

      const issue = JiraIssueSchema.parse(await response.json());
      const rawStatus = issue.fields.status?.name ?? "";
      return {
        provider: "jira",
        key: issue.key,
        title: issue.fields.summary ?? "",
        status: normalizeJiraStatus(issue.fields.status?.statusCategory?.key ?? null, rawStatus),
        rawStatus,
        url: `${baseUrl}/browse/${issue.key}`,
        updatedAt: issue.fields.updated ?? null,
      };
    },
  };
}
