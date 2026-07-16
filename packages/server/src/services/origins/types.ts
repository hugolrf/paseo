export type OriginProviderId = "jira" | "azure" | "gitlab" | "linear";

export const ORIGIN_PROVIDER_IDS: readonly OriginProviderId[] = [
  "jira",
  "azure",
  "gitlab",
  "linear",
];

// Cross-provider status buckets. rawStatus keeps the provider's own wording.
export type NormalizedOriginStatus =
  | "todo"
  | "in_progress"
  | "in_review"
  | "done"
  | "canceled"
  | "unknown";

export interface OriginIssue {
  provider: OriginProviderId;
  key: string; // provider-native ref: "TCE-123", "12345", "group/proj#42", "HUG-1"
  title: string;
  status: NormalizedOriginStatus;
  rawStatus: string;
  url: string | null;
  updatedAt: string | null;
}

export interface OriginProvider {
  readonly id: OriginProviderId;
  fetchIssue(key: string): Promise<OriginIssue>;
}

// Injectable fetch so adapters are testable without network access.
export type OriginFetch = (url: string, init?: RequestInit) => Promise<Response>;

export class OriginNotConfiguredError extends Error {
  readonly kind = "origin-not-configured";

  constructor(public readonly provider: string) {
    super(`Origin provider "${provider}" is not configured in $PASEO_HOME/config.json (origins.*)`);
    this.name = "OriginNotConfiguredError";
  }
}

export class OriginRefError extends Error {
  readonly kind = "origin-ref-error";

  constructor(message: string) {
    super(message);
    this.name = "OriginRefError";
  }
}

export class OriginRequestError extends Error {
  readonly kind = "origin-request-error";

  constructor(params: { provider: OriginProviderId; status: number; detail?: string }) {
    super(
      `Origin "${params.provider}" request failed with HTTP ${params.status}${
        params.detail ? `: ${params.detail}` : ""
      }`,
    );
    this.name = "OriginRequestError";
  }
}
