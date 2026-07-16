import { z } from "zod";
import {
  OriginRequestError,
  type NormalizedOriginStatus,
  type OriginFetch,
  type OriginIssue,
  type OriginProvider,
} from "./types.js";

export interface LinearOriginConfig {
  apiKey: string;
}

const LINEAR_GRAPHQL_ENDPOINT = "https://api.linear.app/graphql";

const LinearIssueResponseSchema = z.object({
  data: z
    .object({
      issue: z
        .object({
          identifier: z.string(),
          title: z.string(),
          url: z.string().nullish(),
          updatedAt: z.string().nullish(),
          state: z
            .object({
              name: z.string().nullish(),
              type: z.string().nullish(),
            })
            .nullish(),
        })
        .nullish(),
    })
    .nullish(),
  errors: z.array(z.object({ message: z.string().nullish() })).optional(),
});

// Linear workflow-state types: triage | backlog | unstarted | started | completed | canceled.
function normalizeLinearStatus(stateType: string | null, rawStatus: string) {
  const raw = rawStatus.toLowerCase();
  if (/review|qa|test/.test(raw)) return "in_review" as NormalizedOriginStatus;
  switch (stateType) {
    case "completed":
      return "done" as NormalizedOriginStatus;
    case "canceled":
      return "canceled" as NormalizedOriginStatus;
    case "started":
      return "in_progress" as NormalizedOriginStatus;
    case "triage":
    case "backlog":
    case "unstarted":
      return "todo" as NormalizedOriginStatus;
    default:
      return "unknown" as NormalizedOriginStatus;
  }
}

export function createLinearOrigin(
  config: LinearOriginConfig,
  fetchFn: OriginFetch,
): OriginProvider {
  return {
    id: "linear",

    async fetchIssue(key: string): Promise<OriginIssue> {
      const response = await fetchFn(LINEAR_GRAPHQL_ENDPOINT, {
        method: "POST",
        headers: {
          // Linear personal API keys go bare in Authorization (no "Bearer").
          Authorization: config.apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query:
            "query IssueByKey($id: String!) { issue(id: $id) { identifier title url updatedAt state { name type } } }",
          variables: { id: key },
        }),
      });
      if (!response.ok) {
        throw new OriginRequestError({ provider: "linear", status: response.status });
      }

      const parsed = LinearIssueResponseSchema.parse(await response.json());
      const issue = parsed.data?.issue;
      if (!issue) {
        const detail = parsed.errors?.[0]?.message ?? `issue "${key}" not found`;
        throw new OriginRequestError({ provider: "linear", status: response.status, detail });
      }

      const rawStatus = issue.state?.name ?? "";
      return {
        provider: "linear",
        key: issue.identifier,
        title: issue.title,
        status: normalizeLinearStatus(issue.state?.type ?? null, rawStatus),
        rawStatus,
        url: issue.url ?? null,
        updatedAt: issue.updatedAt ?? null,
      };
    },
  };
}
