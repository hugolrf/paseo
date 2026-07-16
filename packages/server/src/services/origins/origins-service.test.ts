import { describe, it, expect } from "vitest";
import { createOriginsService, parseOriginRef, type OriginsConfig } from "./origins-service.js";
import type { OriginFetch } from "./types.js";

interface RecordedRequest {
  url: string;
  init?: RequestInit;
}

function jsonFetch(body: unknown, requests: RecordedRequest[] = [], status = 200): OriginFetch {
  return async (url, init) => {
    requests.push({ url, init });
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  };
}

const FULL_CONFIG: OriginsConfig = {
  jira: { baseUrl: "https://acme.atlassian.net", email: "dev@acme.com", apiToken: "jira-token" },
  azure: { organization: "acme-org", project: "acme-proj", pat: "azure-pat" },
  gitlab: { token: "gitlab-token" },
  linear: { apiKey: "lin_api_key" },
};

function serviceWith(fetchFn: OriginFetch, config: OriginsConfig | undefined = FULL_CONFIG) {
  return createOriginsService({ readConfig: () => config, fetchFn });
}

describe("parseOriginRef", () => {
  it("splits provider and key on the first colon", () => {
    expect(parseOriginRef("jira:TCE-123")).toEqual({ provider: "jira", key: "TCE-123" });
    expect(parseOriginRef("gitlab:group/app#42")).toEqual({
      provider: "gitlab",
      key: "group/app#42",
    });
  });

  it("rejects refs without a provider prefix", () => {
    expect(() => parseOriginRef("TCE-123")).toThrow('"<provider>:<key>"');
  });

  it("rejects unknown providers", () => {
    expect(() => parseOriginRef("trello:CARD-1")).toThrow('Unknown origin provider "trello"');
  });
});

describe("configuredProviders", () => {
  it("lists only providers present in config", () => {
    const service = createOriginsService({
      readConfig: () => ({ jira: FULL_CONFIG.jira, linear: FULL_CONFIG.linear }),
      fetchFn: jsonFetch({}),
    });
    expect(service.configuredProviders()).toEqual(["jira", "linear"]);
  });

  it("returns empty when origins config is absent", () => {
    const service = createOriginsService({
      readConfig: () => undefined,
      fetchFn: jsonFetch({}),
    });
    expect(service.configuredProviders()).toEqual([]);
  });
});

describe("jira origin", () => {
  it("fetches and normalizes an issue", async () => {
    const requests: RecordedRequest[] = [];
    const service = serviceWith(
      jsonFetch(
        {
          key: "TCE-123",
          fields: {
            summary: "Fix the report",
            updated: "2026-07-01T10:00:00.000-0300",
            status: { name: "Em andamento", statusCategory: { key: "indeterminate" } },
          },
        },
        requests,
      ),
    );

    const issue = await service.getIssue("jira:TCE-123");

    expect(issue).toEqual({
      provider: "jira",
      key: "TCE-123",
      title: "Fix the report",
      status: "in_progress",
      rawStatus: "Em andamento",
      url: "https://acme.atlassian.net/browse/TCE-123",
      updatedAt: "2026-07-01T10:00:00.000-0300",
    });
    expect(requests[0].url).toBe(
      "https://acme.atlassian.net/rest/api/3/issue/TCE-123?fields=summary,status,updated",
    );
    const headers = requests[0].init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe(
      `Basic ${Buffer.from("dev@acme.com:jira-token").toString("base64")}`,
    );
  });

  it("maps done statusCategory to done", async () => {
    const service = serviceWith(
      jsonFetch({
        key: "TCE-9",
        fields: { summary: "x", status: { name: "Concluído", statusCategory: { key: "done" } } },
      }),
    );
    const issue = await service.getIssue("jira:TCE-9");
    expect(issue.status).toBe("done");
  });

  it("surfaces HTTP failures as typed errors", async () => {
    const service = serviceWith(jsonFetch({}, [], 401));
    await expect(service.getIssue("jira:TCE-1")).rejects.toThrow(
      'Origin "jira" request failed with HTTP 401',
    );
  });
});

describe("azure origin", () => {
  it("fetches a work item and normalizes System.State", async () => {
    const requests: RecordedRequest[] = [];
    const service = serviceWith(
      jsonFetch(
        {
          id: 12345,
          fields: {
            "System.Title": "Implement API",
            "System.State": "Active",
            "System.ChangedDate": "2026-07-02T12:00:00Z",
          },
        },
        requests,
      ),
    );

    const issue = await service.getIssue("azure:12345");

    expect(issue.provider).toBe("azure");
    expect(issue.key).toBe("12345");
    expect(issue.title).toBe("Implement API");
    expect(issue.status).toBe("in_progress");
    expect(issue.rawStatus).toBe("Active");
    expect(issue.url).toBe("https://dev.azure.com/acme-org/acme-proj/_workitems/edit/12345");
    expect(requests[0].url).toBe(
      "https://dev.azure.com/acme-org/acme-proj/_apis/wit/workitems/12345?api-version=7.1",
    );
    // Azure PATs authenticate as Basic with an empty username.
    const headers = requests[0].init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Basic ${Buffer.from(":azure-pat").toString("base64")}`);
  });

  it("rejects non-numeric work item keys", async () => {
    const service = serviceWith(jsonFetch({}));
    await expect(service.getIssue("azure:TCE-1")).rejects.toThrow("numeric ids");
  });
});

describe("gitlab origin", () => {
  it("fetches an issue by project path and iid", async () => {
    const requests: RecordedRequest[] = [];
    const service = serviceWith(
      jsonFetch(
        {
          iid: 42,
          title: "Fix pipeline",
          state: "opened",
          web_url: "https://gitlab.com/group/app/-/issues/42",
          updated_at: "2026-07-03T08:00:00Z",
          labels: ["Doing"],
        },
        requests,
      ),
    );

    const issue = await service.getIssue("gitlab:group/app#42");

    expect(issue.key).toBe("group/app#42");
    expect(issue.status).toBe("in_progress");
    expect(issue.rawStatus).toBe("opened");
    expect(requests[0].url).toBe("https://gitlab.com/api/v4/projects/group%2Fapp/issues/42");
    const headers = requests[0].init?.headers as Record<string, string>;
    expect(headers["PRIVATE-TOKEN"]).toBe("gitlab-token");
  });

  it("maps closed state to done", async () => {
    const service = serviceWith(jsonFetch({ iid: 7, title: "x", state: "closed" }));
    const issue = await service.getIssue("gitlab:group/app#7");
    expect(issue.status).toBe("done");
  });

  it("rejects keys without project path and iid", async () => {
    const service = serviceWith(jsonFetch({}));
    await expect(service.getIssue("gitlab:42")).rejects.toThrow('"<project-path>#<iid>"');
  });
});

describe("linear origin", () => {
  it("fetches an issue through GraphQL", async () => {
    const requests: RecordedRequest[] = [];
    const service = serviceWith(
      jsonFetch(
        {
          data: {
            issue: {
              identifier: "HUG-1",
              title: "Ship the board",
              url: "https://linear.app/acme/issue/HUG-1",
              updatedAt: "2026-07-04T09:00:00.000Z",
              state: { name: "In Progress", type: "started" },
            },
          },
        },
        requests,
      ),
    );

    const issue = await service.getIssue("linear:HUG-1");

    expect(issue.status).toBe("in_progress");
    expect(issue.rawStatus).toBe("In Progress");
    expect(requests[0].url).toBe("https://api.linear.app/graphql");
    const headers = requests[0].init?.headers as Record<string, string>;
    // Linear personal API keys go bare in Authorization (no "Bearer").
    expect(headers.Authorization).toBe("lin_api_key");
    const body = JSON.parse(String(requests[0].init?.body));
    expect(body.variables).toEqual({ id: "HUG-1" });
  });

  it("treats a null issue as an error with the GraphQL message", async () => {
    const service = serviceWith(
      jsonFetch({ data: { issue: null }, errors: [{ message: "Entity not found" }] }),
    );
    await expect(service.getIssue("linear:HUG-404")).rejects.toThrow("Entity not found");
  });

  it("maps completed state type to done", async () => {
    const service = serviceWith(
      jsonFetch({
        data: {
          issue: { identifier: "HUG-2", title: "x", state: { name: "Done", type: "completed" } },
        },
      }),
    );
    const issue = await service.getIssue("linear:HUG-2");
    expect(issue.status).toBe("done");
  });
});

describe("unconfigured providers", () => {
  it("throws OriginNotConfiguredError with guidance", async () => {
    const service = serviceWith(jsonFetch({}), { jira: FULL_CONFIG.jira });
    await expect(service.getIssue("linear:HUG-1")).rejects.toThrow(
      'Origin provider "linear" is not configured',
    );
  });
});
