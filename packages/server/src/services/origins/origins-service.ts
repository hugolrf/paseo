import { createAzureOrigin, type AzureOriginConfig } from "./azure-origin.js";
import { createGitlabOrigin, type GitlabOriginConfig } from "./gitlab-origin.js";
import { createJiraOrigin, type JiraOriginConfig } from "./jira-origin.js";
import { createLinearOrigin, type LinearOriginConfig } from "./linear-origin.js";
import {
  ORIGIN_PROVIDER_IDS,
  OriginNotConfiguredError,
  OriginRefError,
  type OriginFetch,
  type OriginIssue,
  type OriginProvider,
  type OriginProviderId,
} from "./types.js";

export interface OriginsConfig {
  jira?: JiraOriginConfig;
  azure?: AzureOriginConfig;
  gitlab?: GitlabOriginConfig;
  linear?: LinearOriginConfig;
}

export interface OriginsService {
  // ref format: "<provider>:<key>", e.g. "jira:TCE-123", "azure:12345",
  // "gitlab:group/app#42", "linear:HUG-1".
  getIssue(ref: string): Promise<OriginIssue>;
  configuredProviders(): OriginProviderId[];
  // My open issues across every configured origin (the task-sync source).
  // A failing origin contributes an error instead of sinking the whole sweep.
  listAllMyIssues(): Promise<{
    issues: OriginIssue[];
    errors: { provider: OriginProviderId; message: string }[];
  }>;
}

export interface CreateOriginsServiceOptions {
  // Read the current origins section from daemon config on every call so
  // credential edits in config.json apply without a daemon restart.
  readConfig(): OriginsConfig | undefined;
  fetchFn?: OriginFetch;
}

export function parseOriginRef(ref: string): { provider: OriginProviderId; key: string } {
  const separatorIndex = ref.indexOf(":");
  if (separatorIndex <= 0 || separatorIndex === ref.length - 1) {
    throw new OriginRefError(
      `Origin refs use "<provider>:<key>" (e.g. "jira:TCE-123"), got "${ref}"`,
    );
  }
  const provider = ref.slice(0, separatorIndex);
  const key = ref.slice(separatorIndex + 1);
  if (!ORIGIN_PROVIDER_IDS.includes(provider as OriginProviderId)) {
    throw new OriginRefError(
      `Unknown origin provider "${provider}"; expected one of: ${ORIGIN_PROVIDER_IDS.join(", ")}`,
    );
  }
  return { provider: provider as OriginProviderId, key };
}

export function createOriginsService(options: CreateOriginsServiceOptions): OriginsService {
  const fetchFn: OriginFetch = options.fetchFn ?? ((url, init) => fetch(url, init));

  function buildProvider(providerId: OriginProviderId): OriginProvider {
    const config = options.readConfig();
    switch (providerId) {
      case "jira": {
        if (!config?.jira) throw new OriginNotConfiguredError("jira");
        return createJiraOrigin(config.jira, fetchFn);
      }
      case "azure": {
        if (!config?.azure) throw new OriginNotConfiguredError("azure");
        return createAzureOrigin(config.azure, fetchFn);
      }
      case "gitlab": {
        if (!config?.gitlab) throw new OriginNotConfiguredError("gitlab");
        return createGitlabOrigin(config.gitlab, fetchFn);
      }
      case "linear": {
        if (!config?.linear) throw new OriginNotConfiguredError("linear");
        return createLinearOrigin(config.linear, fetchFn);
      }
    }
  }

  return {
    async getIssue(ref: string): Promise<OriginIssue> {
      const { provider, key } = parseOriginRef(ref);
      return buildProvider(provider).fetchIssue(key);
    },

    configuredProviders(): OriginProviderId[] {
      const config = options.readConfig();
      if (!config) return [];
      return ORIGIN_PROVIDER_IDS.filter((id) => config[id] !== undefined);
    },

    async listAllMyIssues() {
      const config = options.readConfig();
      const providers = ORIGIN_PROVIDER_IDS.filter((id) => config?.[id] !== undefined);
      const issues: OriginIssue[] = [];
      const errors: { provider: OriginProviderId; message: string }[] = [];

      await Promise.all(
        providers.map(async (providerId) => {
          try {
            const providerIssues = await buildProvider(providerId).listMyIssues();
            issues.push(...providerIssues);
          } catch (error) {
            errors.push({
              provider: providerId,
              message: error instanceof Error ? error.message : String(error),
            });
          }
        }),
      );

      return { issues, errors };
    },
  };
}
