# lib/

Shared infrastructure consumed by every domain: config-derived constants, CLI wrappers (`gh`, `gog`), the gateway client, worker dispatch and job-side Slack I/O, and the entity store. Configuration itself (schema, loader, getters, refs, silos, IMAP secrets) is in [config.md](./config.md). Every module is importable as `@karmaniverous/jeeves-scripts-core/lib/<module>`.

## Modules

### constants.ts

Fixed values plus the template's config-derived names, now read from `jeeves-scripts.json` (Decision 3). Nothing here is edited per instance: set the value in the config file.

- **Fixed exports** (plain constants): `TOKEN_METRICS_NAMESPACE`, `TOKEN_METRICS_CURSOR_KEY`, `TOKEN_METRICS_DB_CURSOR_KEY`, `TOKEN_METRICS_CC_CURSOR_KEY`, `SESSION_REFRESH_CACHE_READ_THRESHOLD` (150,000), `SESSION_REFRESH_IDLE_MINUTES` (60), `OPENCLAW_UPGRADE_CUTOFF_ENV`, and `ENTITY_TYPES` (`subdir`, `rejectionKeys`, `maxAgeDays` per entity type in the meta lifecycle).
- **`constants()`** returns every config-derived value under its template name, computed from the loaded config on first call and cached until the config is reset. Importing the module reads nothing.
  - Paths (from `paths()`): `JEEVES_BASE_DIR`, `CONFIG_DIR`, `CONTENT_DIR`, `SCRIPTS_DIR`, `CREDENTIALS_DIR`, `IMAP_SECRETS_DIR`, `GOG_CONFIG_DIR` (`paths().gogHome`), `TOKEN_METRICS_DIR`. `PIPELINE_CONFIG_PATH` and `SILO_ROUTING_CONFIG_PATH` both name the loaded `jeeves-scripts.json`.
  - Derived from the content dir: `GITHUB_DIR`, `GITHUB_REGISTRY_PATH`, `DEFAULT_MEETINGS_DIR`, `SLACK_DOMAIN_DIR`; from the state dir: `EMAIL_EVENTS_DIR`; from the config dir: `SLACK_WORKSPACE_CACHE_PATH`; from the credentials dir: `NOTION_API_KEY_PATH`, `X_OAUTH_DIR`; from the gog home: `GOG_CLIENT_PATH`.
  - Integrations (from `integrations()`): `INSTANCE_NAME`, `QDRANT_API_URL`, `QDRANT_SERVICE_NAME`, `GATEWAY_HOST`, `GATEWAY_PORT`, `GH_BIN`, `GH_CONFIG_DIR`, `GH_ACCOUNT`, `GH_BOT_USER`, `GOG_BIN`, `PRIMARY_WORKSPACE`, `NOTION_VERSION`, `JIRA_SITE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN_PATH`, `JIRA_FIELDS_FILENAME`, `JIRA_MAX_HISTORY`, `LINEAR_CONFIG_PATH`, `LINEAR_MAX_HISTORY`.
  - `X_ACCOUNTS`: handle → content directory, each resolved through the account's silo (`integrations.x.accounts.<handle>.silo`, default silo) and `relativePath` (default `x/<handle>`).
  - Token metrics: `TOKEN_RATES_PATH`, `TOKEN_RATES_PENDING_PATH`, `SLACK_DM_NAMES_CACHE_PATH` (under `TOKEN_METRICS_DIR`), `TOKEN_RATES_SEED_PATH` (the seed core ships, `config/token-rates.seed.json` in the package), `SLACK_USERS_PATH` (`{scriptsDir}/src/slack/lib/users.json`, instance data).
  - OpenClaw: `SESSIONS_DIR`, `OPENCLAW_AGENT_DB_PATH`, `CLAUDE_CODE_PROJECTS_DIR` (under the OS home dir), `OPENCLAW_UPGRADE_CUTOFF` (env), `SPAWN_WORKER_PATH` (core's own `spawn-worker` module).

Content written outside the configured content dir and silos is invisible to the watcher and jeeves-server, so every content path goes through `paths()` / `siloPath()` (Decision 28).

### dates.ts

Thin wrappers around date-fns. No config dependencies.

- `dayOfWeek(dateStr)` — full weekday name (e.g., "Monday"). Important because LLMs cannot do day-of-week arithmetic reliably.
- `formatDate(dateStr, fmt)` — format a date using date-fns pattern
- `relativeDays(dateStr, referenceStr?)` — human-friendly relative description ("3 days ago", "today")
- `requireTimeZone(value, source)` — validates a time zone read from instance config; throws (naming `source`) when it is empty or not a valid IANA zone. No default zone
- `withDateContext(task, now, timeZone)` — prepends `> **Today is <weekday>, <YYYY-MM-DD> (<zone>).** …` to a worker task (used by `dispatchers/daily-digest.ts`)
- Re-exports `format` and `parseISO` from date-fns

From a shell in an instance repo:

```bash
node --input-type=module -e "import { dayOfWeek } from '@karmaniverous/jeeves-scripts-core/lib/dates'; console.log(dayOfWeek('2026-06-01'));"
```

### email.ts

Gmail parsing utilities for raw Gmail API payloads. No config dependencies.

- `headerValue(headers, name)` — extract header value (case-insensitive)
- `extractTextFromPayload(payload)` — recursively extract text and HTML from MIME parts, decoding base64
- `extractAttachments(payload)` — recursively extract attachment metadata (filename, mimeType, size, attachmentId)

### gh.ts

GitHub CLI wrappers with typed invocation. Depends on `GH_BIN`, `GH_CONFIG_DIR`.

- `setupGhConfig()` — sets `GH_CONFIG_DIR` env var so `gh` finds correct auth tokens
- `gh(args, options?)` — run `gh` CLI command, return structured `GhResult` (`ok`, `status`, `out`, `err`)
- `ghJson(args)` — run `gh` and parse stdout as JSON
- `ghApi(endpoint)` — call GitHub REST API via `gh api`

### gog.ts

Google Workspace CLI wrapper with retry. Depends on `GOG_BIN`, `GOG_CONFIG_DIR`.

- `gogWithRetry(args, opts?)` — run `gog` command with retry logic for transient network errors (context deadline exceeded, timeouts). Defaults `GOG_HOME` to `GOG_CONFIG_DIR` (an existing `GOG_HOME` is kept), so gog and the scripts use the same home.

### gog-credentials.ts

Single source of truth for which gog credentials exist. Depends on `GOG_CLIENT_PATH`, `GOG_CONFIG_DIR`.

- `gogServiceAccountDirs(configDir?)` — directories searched for service-account mailboxes, in order: `<configDir>/data` (current gog), then `<configDir>` (older gog without `data/`); `gogServiceAccountDir(configDir?)` is the first
- `serviceAccountFileName(email)` / `serviceAccountKeyPath(email, configDir?)` — `sa-<base64(email), padding stripped>.json`, and its path under `data/`
- `findServiceAccountFile(email, configDir?)` — that mailbox's registration in the first directory that has it, or `null`
- `detectGogCredentials(configDir?)` — `{ oauthClient, serviceAccount, any }`: OAuth client file present, any `sa-*.json` present
- `requireGogCredentials(job, accountCount, creds?)` — `false` when `accountCount` is 0 (caller skips), `true` when any credential exists, otherwise throws so the run fails

### gateway-client.ts

Gateway HTTP client for OpenClaw tool invocation. Depends on `GATEWAY_HOST`, `GATEWAY_PORT`.

- `loadGatewayToken()` — the bearer token from `CLAWDBOT_GATEWAY_TOKEN` or the OpenClaw config (`gatewayToken()`, below)
- `gatewayInvoke(tool, args, options?)` — invoke an OpenClaw gateway HTTP API tool
- `unwrapResult(r)` — unwrap result from gateway response

### gateway-rpc.ts

Gateway RPC caller for methods that are not HTTP tools, or whose tool wrapper limits what the RPC allows. Depends on the global openclaw install (`admin/lib/resolve-openclaw-dist.ts`).

- `gatewayRpc(method, params, cliPath?)`: run `openclaw gateway call <method> --json --params <json>` under the current Node binary (no shell) and resolve the result; gateway errors, CLI failures and non-JSON output reject

### openclaw-config.ts

Reads credentials from the local OpenClaw config, `~/.openclaw/openclaw.json`, then the legacy `~/.clawdbot/clawdbot.json` (home: `USERPROFILE`, else the OS home dir). Only the fields read here are validated (`openclawConfigSchema`, Zod 4); missing, unreadable or invalid files are skipped. Never logs a token. Exported from the package root.

- `gatewayToken(files?)` — a non-empty `CLAWDBOT_GATEWAY_TOKEN`, else `gateway.auth.token`; `null` when neither exists
- `slackBotTokens(files?)` — every Slack bot token by gateway account id (`channels.slack.accounts.<id>.botToken`, else the flat `channels.slack.botToken` as `default`), from the first file that has any; throws when none does
- `slackBotToken(accountId = 'default', files?)` — one account's token; throws when it has none
- `findInOpenclawConfig(pick, files?)` / `openclawConfigPaths(home?)` — the search primitives

Used by `gateway-client` (and so `spawn-worker`), `slack/poll` and instance code.

### worker-output.ts

Recovers an LLM worker's full final reply after `dispatchSession`: it takes the session key from spawn-worker's `WORKER_RESULT` line and reads the last assistant message via the gateway `chat.history` RPC with `maxChars: 500000` (the `sessions_history` tool caps text at 4000 characters, which cut long replies). A reply the gateway still marks as truncated fails with `worker reply truncated by gateway`. Job scripts use it to verify structured worker results instead of trusting the exit code.

### worker-slack/

Job-side Slack I/O for LLM workers. On OpenClaw 2026.9, sub-agent sessions have no `message` tool, so the job script does all Slack work:

- `worker-slack-config.ts`: Zod 4 schema for the job's `{ accountId?, reads?, posts? }` config (each post target carries `editTs?`, the exact message ids the worker may edit, and `pin?`); types are derived with `z.infer`.
- `run.ts`: `dispatchWithSlack(task, dispatchOptions, { reads, posts })` is the production entry point. It validates the config before any gateway call and supports `--dry-run` (print the posts instead of posting) and `--print-task` (print the TASK, no dispatch).
- `worker-slack-job.ts`: orchestration with injected deps (read → TASK → dispatch → validate → post/pin/edit).
- `worker-posts.ts`: the `slack-posts` output contract (a fenced JSON array, never a bare object, of `{channel, text, thread_ts?, pin?, edit_ts?}`; `edit_ts` replaces the text of an existing message and can't be combined with `thread_ts`/`pin`; edits and pins are allowed only where the target's `editTs` / `pin` permit), the worker instructions, and the Slack context formatting (fenced as untrusted data the worker must never follow as instructions).
- `slack-io.ts`: `read` / `send` / `pin` / `edit` through the gateway `message` tool (`/tools/invoke`). A read response without a valid `messages` array throws (only `messages: []` means an empty channel).
- `slack-target.ts`: normalizes Slack IDs to `channel:…` / `user:…` targets (the prefix must match the ID family: `channel:` C/G/D, `user:` U/W).

### spawn-worker.ts

Gateway session spawner: the executable `runDispatcher()` / `dispatchSession()` run (`constants().SPAWN_WORKER_PATH`, core's built `dist/lib/spawn-worker.js`). It uses `gateway-client`, so it reads the gateway host and port from `integrations.gateway` and the token from the OpenClaw config.

Usage: `echo "task" | node <core>/dist/lib/spawn-worker.js --job-id=<id> [--label=<label>] [--thinking=<level>]`

- Spawns a session via OpenClaw gateway HTTP API
- Polls indefinitely for completion (runner job `timeout_seconds` handles process kill)
- Waits for transcript to flush
- Outputs `WORKER_RESULT:{"sessionKey":"...","tokens":12345,"durationMs":123000}` on last stdout line
- Implements retry with exponential backoff (3 retries, 30s base)

### entity-store.ts

Shared entity persistence — upsert, backfill, and delete entity files with reverse-diff history using `fast-json-patch`. Used by any domain that persists structured entities (Jira, Linear, etc.).

- `upsertEntity(domainDir, type, key, current, now, maxHistory)` — create or update entity file with reverse-diff history; returns file path
- `backfillEntity(domainDir, type, key, current, now)` — write entity file only if it doesn't exist (historical import); returns path or null
- `deleteEntity(domainDir, type, key)` — delete entity file; returns boolean
- `writeUnmatched(domainDir, label, body)` — write unrecognised webhook payload to `_unmatched/` subdirectory
- `readStdinJson()` — read stdin to completion and parse as JSON; used by Event Gateway drain scripts

Entity file structure:

```json
{
  "entityType": "issue",
  "entityKey": "CRE-1",
  "current": { ... },
  "history": [{ "ts": "...", "patch": [...] }],
  "meta": { "firstSeen": "...", "lastWebhook": "...", "lastBackfill": null, "version": 7 }
}
```

History entries are reverse-diff patches (JSON Patch format) — apply newest-to-oldest to reconstruct prior states.

## Configuration

`jeeves-scripts.json` (pipeline accounts, buckets, refs, email and Drive settings, silo routing) is documented in [config.md](./config.md), including [the `pipeline` block](./config.md#the-pipeline-block) and [silos](./config.md#silos).
