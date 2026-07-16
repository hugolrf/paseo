# Task Origins

Tasks can be linked to the issue tracker that originated them via the `origin` field, using
`"<provider>:<key>"` refs:

| Provider | Ref example           | Key format                   |
| -------- | --------------------- | ---------------------------- |
| `jira`   | `jira:TCE-123`        | Issue key                    |
| `azure`  | `azure:12345`         | Work item id (numeric)       |
| `gitlab` | `gitlab:group/app#42` | `<project-path>#<issue-iid>` |
| `linear` | `linear:HUG-1`        | Issue identifier             |

The `tasks.origins.get_issue` RPC resolves a ref against the origin's API and returns the issue
title, URL, and a normalized status (`todo`, `in_progress`, `in_review`, `done`, `canceled`,
`unknown`) alongside the provider's raw status name. Everything runs in-daemon
(`packages/server/src/services/origins/`) — there is no external sync service.

## Configuration

Credentials live in `$PASEO_HOME/config.json` under `origins`. They are read from disk on each
request (edits apply without a daemon restart) and are **not** part of the mutable-config RPC, so
they never go over the WebSocket.

```json
{
  "origins": {
    "jira": {
      "baseUrl": "https://yourorg.atlassian.net",
      "email": "you@example.com",
      "apiToken": "..."
    },
    "azure": {
      "organization": "your-org",
      "project": "your-project",
      "pat": "..."
    },
    "gitlab": {
      "baseUrl": "https://gitlab.com",
      "token": "..."
    },
    "linear": {
      "apiKey": "lin_api_..."
    }
  }
}
```

All providers are optional; an RPC against an unconfigured provider returns a clear error.

## Provider notes (gotchas)

- **Jira**: Basic auth is `email:apiToken` base64. Status is normalized from
  `statusCategory.key` (`new`/`indeterminate`/`done`); review-ish states are detected by name.
- **Azure DevOps**: PATs authenticate as Basic with an **empty username** (`:pat`). State names are
  workflow-specific, so normalization is substring-based over common process-template names. Do not
  combine `fields` and `$expand=relations` in one work item request — the API rejects it with 400.
- **GitLab**: project path must be URL-encoded in the REST path. Issues only expose
  `opened`/`closed`; workflow labels (`Doing`, `In Review`) refine open issues.
- **Linear**: the personal API key goes bare in `Authorization` (no `Bearer`). Workflow-state
  `type` (`backlog`/`unstarted`/`started`/`completed`/`canceled`) drives normalization. Watch for
  HTTP 429 rate limiting if polling is ever added.
