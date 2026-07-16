import { z } from "zod";
import {
  OriginRefError,
  OriginRequestError,
  type NormalizedOriginStatus,
  type OriginFetch,
  type OriginIssue,
  type OriginProvider,
} from "./types.js";

export interface GitlabOriginConfig {
  baseUrl?: string; // defaults to gitlab.com
  token: string;
}

const GitlabIssueSchema = z.object({
  iid: z.number(),
  title: z.string(),
  state: z.string(), // "opened" | "closed"
  web_url: z.string().nullish(),
  updated_at: z.string().nullish(),
  labels: z.array(z.string()).optional(),
});

// GitLab issues only expose opened/closed; refine "opened" with the
// conventional workflow labels (Doing, In Review, ...), when present.
function normalizeGitlabStatus(state: string, labels: string[]): NormalizedOriginStatus {
  if (state === "closed") return "done";
  const joined = labels.join(" ").toLowerCase();
  if (/review|qa|test/.test(joined)) return "in_review";
  if (/doing|progress|wip/.test(joined)) return "in_progress";
  if (state === "opened") return "todo";
  return "unknown";
}

export function createGitlabOrigin(
  config: GitlabOriginConfig,
  fetchFn: OriginFetch,
): OriginProvider {
  const baseUrl = (config.baseUrl ?? "https://gitlab.com").replace(/\/+$/, "");

  return {
    id: "gitlab",

    async fetchIssue(key: string): Promise<OriginIssue> {
      // Key format: "<project path>#<issue iid>", e.g. "group/app#42".
      const match = key.match(/^(.+)#(\d+)$/);
      if (!match) {
        throw new OriginRefError(`GitLab keys use "<project-path>#<iid>", got "${key}"`);
      }
      const [, projectPath, iid] = match;

      const response = await fetchFn(
        `${baseUrl}/api/v4/projects/${encodeURIComponent(projectPath)}/issues/${iid}`,
        {
          headers: {
            "PRIVATE-TOKEN": config.token,
            Accept: "application/json",
          },
        },
      );
      if (!response.ok) {
        throw new OriginRequestError({ provider: "gitlab", status: response.status });
      }

      const issue = GitlabIssueSchema.parse(await response.json());
      return {
        provider: "gitlab",
        key: `${projectPath}#${issue.iid}`,
        title: issue.title,
        status: normalizeGitlabStatus(issue.state, issue.labels ?? []),
        rawStatus: issue.state,
        url: issue.web_url ?? null,
        updatedAt: issue.updated_at ?? null,
      };
    },
  };
}
