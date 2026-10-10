# config/

One validated file, `jeeves-scripts.json`, configures every script on an instance. It holds instance settings, path overrides, integrations, the pipeline (accounts, buckets, refs, email and Drive settings), silo routing and per-job deltas. It never holds a secret value. Everything here is exported from the package root, `@karmaniverous/jeeves-scripts-core`.

## Where the file is

Resolution never depends on the working directory. The first that applies wins:

1. An explicit path: `loadConfig({ configPath })`, or `config check --config <file>`.
2. The `JEEVES_SCRIPTS_CONFIG` environment variable (`CONFIG_PATH_ENV`).
3. `{root}/jeeves-scripts.json`, where `root` is the instance repo root the launcher passes.

`jeeves-scripts run` sets `JEEVES_SCRIPTS_CONFIG` to `{root}/jeeves-scripts.json` (unless already set) before it runs a job, so every core module and instance script reads the same file.

The loader is lazy and cached: nothing touches the filesystem until the first getter call, and later calls return the cached config regardless of options. `resetConfig()` clears the cache (tests). `getLoadedConfigPath()` returns the file that was loaded.

## Shape

The JSON Schema ships at `schema/jeeves-scripts.schema.json` in the package (generated from the Zod schema at build time; `generateJsonSchema()` returns the same object). Point `$schema` at it for editor completion:

```json
{
  "$schema": "./node_modules/@karmaniverous/jeeves-scripts-core/schema/jeeves-scripts.schema.json",
  "instance": { "name": "acme", "baseDir": "/opt/jeeves" },
  "paths": { "contentDir": "/opt/jeeves/content" },
  "integrations": {
    "gh": { "account": "acme-org" },
    "slack": { "primaryWorkspace": "T0000000000" },
    "x": { "accounts": { "acme": { "relativePath": "x/acme" } } }
  },
  "pipeline": {
    "accounts": [],
    "buckets": { "domains": [], "priority": [] },
    "refs": { "digest.timezone": "America/Chicago" },
    "emailConfig": {
      "reportOnly": true,
      "receipt": { "forwardEnabled": false, "sparkReceiptsForwardTo": "" },
      "digest": { "slackChannelId": "C0000000000" }
    }
  },
  "siloRouting": {
    "silos": {
      "client": {
        "basePath": "/opt/jeeves/client",
        "emailDomains": ["client.com"]
      }
    }
  },
  "jobs": { "generate-daily-digest": { "silo": "client", "taskFile": "digest/TASK.md" } }
}
```

| Block | Schema | Contents |
| --- | --- | --- |
| `instance` | `instanceSchema` | `name`, `baseDir` (required). Every default path derives from `baseDir`. |
| `paths` | `pathsSchema` | Optional overrides: `configDir`, `contentDir`, `scriptsDir`, `credentialsDir`, `stateDir`, `gogHome`, `tokenMetricsDir`. |
| `integrations` | `integrationsSchema` | `gh` (`bin`, `configDir`, `account`, `botUser`), `qdrant` (`apiUrl`, `serviceName`), `gog` (`bin`), `slack` (`primaryWorkspace`), `notion` (`version`), `jira` (`siteUrl`, `email`, `apiTokenPath`, `boardId`, `fieldsFilename`, `maxHistory`), `linear` (`configPath`, `maxHistory`), `x` (`accounts.<handle>.silo`, `.relativePath`). |
| `pipeline` | `pipelineSchema` | Optional. `accounts[]` (mail and calendar), `buckets` (`domains[]`, `priority[]`), `refs` (dotted key → string: Slack ids, Notion ids, time zones), `emailConfig`, `googleDrive`. |
| `siloRouting` | `siloRoutingSchema` | `defaultBasePath` (default: `paths().contentDir`) and named `silos.<name>`: `basePath`, `emailDomains`, `githubOrgs`, `slackWorkspaces`, `jira`, `linear`. |
| `jobs` | `jobsSchema` | Per-job deltas by job id: `enabled`, `schedule`, `env`, `args`, `timeout_seconds`, `silo`, `taskFile`. Today `silo` and `taskFile` are read by the task-file dispatcher (see [dispatchers](./dispatchers.md)) and `silo` is checked by `config check`; the rest are validated and wait for the job registry (Decision 32). |
| `extensions` | `extensionsSchema` | Named seam → `local:<module>` (reserved for the extension-point registry). |

Every schema is exported (Zod 4), with its `z.infer` type (`Config`, `PathsConfigInput`, `IntegrationsConfig`, `PipelineConfig`, `SiloRoutingConfig`, `JobDelta`, ...).

### Other components' settings

`jeeves-scripts.json` holds this instance's settings only. A setting that belongs to another component is read from that component's own config, never copied here: the gateway port from the OpenClaw config (`gatewayPort()`), the runner's port from `{configDir}/jeeves-runner/config.json` (`runnerUrl()`), Qdrant's URL from the watcher's `vectorStore.url` (the `qdrant.apiUrl` default). See [lib.md](./lib.md#component-configts). There is no `integrations.gateway` block; like any unknown key, an old one is ignored.

### Secrets

The schema rejects a literal secret value anywhere in the file, including under keys it does not know: a key such as `password`, `token`, `apiKey` or `secret` holding a string is an error. Credentials live in files: IMAP passwords are `{ "secretRef": "<name>" }`, read from `{credentialsDir}/imap/<name>` (`resolveImapPassword`, `imapSecretPath`); Jira, Linear, Notion, X and gog credentials are files under `credentialsDir` / `gogHome`.

## The pipeline block

`pipeline` is optional as a whole (getters throw a config error naming it when a job needs it), but when present every field below is validated by `pipelineSchema`; unknown keys are stripped except under `googleDrive`.

```json
{
  "accounts": [
    {
      "email": "user@example.com",
      "type": "gmail",
      "calendar": { "serviceAccount": "auto" },
      "emailPolling": true
    },
    {
      "email": "user@imap.example.com",
      "type": "imap",
      "emailPolling": true,
      "imap": {
        "host": "imap.provider.com",
        "port": 993,
        "tls": true,
        "user": "user@imap.example.com",
        "password": { "secretRef": "user-imap-example-com" }
      },
      "folders": ["INBOX", "Sent"]
    }
  ],
  "buckets": {
    "domains": [{ "pattern": "company.com", "bucket": "internal" }],
    "priority": ["internal", "external"]
  },
  "refs": { "digest.timezone": "America/Chicago" },
  "emailConfig": {
    "reportOnly": false,
    "receipt": {
      "forwardEnabled": true,
      "sparkReceiptsForwardTo": "receipts@example.com"
    },
    "digest": { "slackChannelId": "C0456..." }
  }
}
```

- `accounts[]` (required): `email`, `type` (`gmail` | `imap`), `emailPolling` (required); `calendar`, `imap`, `folders` optional. An account with an `imap` block is polled over IMAP (a `gmail` one with Gmail extensions), the rest through gog. `folders` (IMAP only) defaults to `[Gmail]/All Mail`, `[Gmail]/Spam` and `[Gmail]/Trash` for `gmail` accounts and every listed folder otherwise. `imap.password` must be `{ "secretRef": "<name>" }` (a literal password is a config error); see [Secrets](#secrets) and [email](./email.md#imap-passwords).
- `accounts[].calendar`: `{ "serviceAccount": "auto" }` (Workspace mailbox, gog's service account) or `{ "tokenFile": "<path relative to credentialsDir>" }` (OAuth refresh token). See [calendar](./calendar.md#account-configuration).
- `buckets.domains[]` maps email domains (`pattern`, case-insensitive) to buckets; `buckets.priority` orders bucket names (first = highest). Bucket names are also the Gmail labels classification applies (`getBucketNames()`); none is hard-coded.
- `refs`: dotted key → string, read with `getRef(key)` (throws when missing) or `tryGetRef(key)` (`''` when missing). Refs are per-instance ids and settings (Slack channel ids, Notion database ids, `digest.timezone`); there are no defaults and they are not secrets. Every ref is read with a literal key or a `*_REF` constant, so the refs an instance needs can be listed from an instance or core checkout with `grep -rhoE "(try)?[gG]etRef\('[^']+'\)|[A-Z_]+_REF = '[^']+'" src --include='*.ts' --exclude='*.test.ts' | sort -u`.
- `emailConfig.reportOnly` (required): when `true`, mail is ingested but no Gmail mutation happens (no label actions from poll and historical backfill, no `meeting` label or archive from meeting extraction, none applied by drain-updates). Skipped actions are dropped, except meeting extraction's, which are caught up once `reportOnly` is off (see [meetings](./meetings.md#reportonly-catch-up)).
- `emailConfig.receipt` (required, strict): `forwardEnabled`, `sparkReceiptsForwardTo`. No core script reads them yet; they are validated so instance scripts can rely on them. The retired `forwardJGS` key is a config error.
- `emailConfig.digest` (required): `slackChannelId` for email digest delivery.
- `emailConfig.backfill` (optional): `{ "accounts": [...], "lookbackDays": 90, "windowDays": 7 }`, all required when present, no defaults. Paced historical Gmail backfill (`email/backfill-historical`); each run searches one window per account, walking back until `lookbackDays`, then no-ops. `--accounts`, `--lookback-days`, `--window-days` override. Backfill accounts are included in `getGmailAccounts()`.
- `emailConfig.meetings` (optional): `{ "archive": boolean }`, the Gmail action on a meeting's source email (`false`: label only; `true`: label and archive out of `INBOX`, never a watched one). Absent means `archive: true`. `reportOnly` overrides both.
- `googleDrive` (optional): passed through unvalidated here and validated by the Drive job (`loadGoogleDriveConfig()`, `google-drive/lib/config`), so a mistake fails only that job. See [google-drive](./google-drive.md#configuration).

## Getters

| Getter | Returns |
| --- | --- |
| `loadConfig(options?)` | The validated `Config`. |
| `paths(options?)` | Every resolved path (`ResolvedPaths`): `baseDir`, `configDir` (`{baseDir}/config`), `contentDir` (`{baseDir}/content`), `scriptsDir` (`{baseDir}/jeeves-scripts`), `credentialsDir` (`{configDir}/credentials`), `stateDir` (`{baseDir}/state`), `imapSecretsDir`, `gogHome` (`{configDir}/gogcli`), `tokenMetricsDir` (`{stateDir}/jeeves-runner/token-metrics`). |
| `integrations(options?)` | Every integration block with defaults applied (`gh.bin` `gh`, `gh.configDir` `{configDir}/gh-cli`, `qdrant.apiUrl` the watcher's `vectorStore.url`, else `http://localhost:6333`, ...). `jira.boardId` has no default. |
| `pipeline(options?)` | The `pipeline` block. Throws when the config has none. |
| `getRef(key)` / `tryGetRef(key)` | A `pipeline.refs` value; `getRef` throws when missing, `tryGetRef` returns `''`. |
| `getEmailAccounts()`, `getGmailAccounts()`, `getCalendarAccounts()` | Account lists from `pipeline.accounts`. |
| `getBucketNames()`, `getBucketForDomain(domain)`, `getBucketPriority(bucket)` | Bucket routing. |
| `derivePaths(config)`, `deriveIntegrations(config)` | The same values from a config object, without the loader (pure; for tests). |

Library code reads config-derived values through `constants()` (`lib/constants`), which keeps the template's names (`constants().CONTENT_DIR`, `constants().GH_BIN`, ...) as a cached function of the loaded config. See [lib.md](./lib.md).

### Environment overrides

These win over the file: `GOG_HOME` (`paths().gogHome`), `TOKEN_METRICS_DIR` (`paths().tokenMetricsDir`), `GH_CONFIG_DIR`, `QDRANT_API_URL`, `LINEAR_CONFIG_PATH`. One works the other way round: `JIRA_BOARD_ID` fills `integrations().jira.boardId` only when the file sets no `boardId`.

## Silos

Every content path core resolves goes through a silo. The default silo's base path is `siloRouting.defaultBasePath`, else `paths().contentDir`; named silos are `siloRouting.silos.<name>.basePath`. A single-tenant instance can omit `siloRouting`.

Each silo: `basePath` (required, absolute); `emailDomains` (mail domains), `githubOrgs` (org names, or `{ "githubOrg", "relativePath" }` to route an org to a subdirectory), `slackWorkspaces` (team ids), `jira` / `linear` (`true`: that integration's content routes here), all optional.

- `siloPath(silo, segments)` joins `segments` onto the silo's base path (`undefined` = the default silo). Throws `UnknownSiloError` for an unconfigured name.
- `isKnownSilo(silo)` checks a name.
- Routing: `getBasePathForEmailDomain`, `getBasePathForGitHubOrg`, `getBasePathForSlackWorkspace`, `getBasePathForMeeting` (majority vote over attendee domains), `getBasePathForJira`, `getBasePathForLinear`, `getEmailBaseForAccount`, `getCalendarBaseForAccount`, `getEntityDirs`. Each falls back to the default silo.

Instance and plugin code never joins absolute content roots itself; it calls `siloPath`.

## Validation: `config check`

`configCheck({ root?, configPath? })` (and `jeeves-scripts config check`) loads the file fresh, validates it, and checks that every `jobs.<id>.silo` names a configured silo. It returns `{ ok, configPath, errors }`; the CLI prints one line per error and exits 1 on failure.

## Key files

| File | Purpose |
| --- | --- |
| `src/config/schema.ts` | `configSchema` (secret scan + object schema), `configObjectSchema`, `instanceSchema` |
| `src/config/loader.ts` | `loadConfig`, `resolveConfigPath`, `resetConfig`, `CONFIG_PATH_ENV` |
| `src/config/paths.ts`, `integrations.ts` | `paths()`, `integrations()` and their pure `derive*` forms |
| `src/config/pipeline-accessors.ts` | `pipeline()`, refs, account and bucket accessors |
| `src/config/silo-router.ts` | `siloPath`, routing functions, `UnknownSiloError` |
| `src/config/secret-guard.ts`, `imap-secrets.ts` | Secret-literal scan; IMAP `secretRef` resolution |
| `src/config/json-schema.ts` | `generateJsonSchema()` |
| `src/config/check.ts` | `configCheck()` |
| `src/config/pipeline-schema.ts`, `pipeline-email-schema.ts`, `silo-schema.ts`, `paths-schema.ts`, `integrations-schema.ts`, `jobs-schema.ts` | The block schemas |
