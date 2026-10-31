---
title: Configuration
---

# config/

One validated file, the instance config (`<config dir>/config.json`, outside the instance repo), configures every script on an instance. It holds instance settings, path overrides, integrations, the pipeline (accounts, buckets, refs, email and Drive settings), silo routing and per-job deltas. It never holds a secret value. Everything here is exported from the package root, `@karmaniverous/jeeves-scripts-core`.

## Where the file is

The config lives outside the instance repo, so instance data (a channel's home directory, an account, a schedule delta) changes without a PR. The repo's `jeeves-scripts.json` is only a pointer to the config directory:

```json
{
  "$schema": "./node_modules/@karmaniverous/jeeves-scripts-core/schema/pointer.schema.json",
  "config": "J:/config/jeeves-scripts"
}
```

The config is `<config>/config.json` (same schema as always). `config` must be an absolute directory and `config.json` must exist, or loading fails naming both files. `jobs/*.json`, the plugin, `src/` and the plugin's `local` schema stay in the repo.

Resolution never depends on the working directory. The first that applies wins:

1. An explicit path: `loadConfig({ configPath })`, or `--config <file>` on `config check`, `config set` and `config unset`.
2. The `JEEVES_SCRIPTS_CONFIG` environment variable (`CONFIG_PATH_ENV`).
3. `{root}/jeeves-scripts.json`, where `root` is the instance repo root the launcher passes (`setConfigRoot`).

Whichever file that is: a pointer resolves to `<config>/config.json`; a full config (it has `instance`) is used as is. A full config still in the repo (step 3) is the **legacy** layout: it works, and every command prints one warning, `config is in the instance repo; move it (guides/config.md#moving-the-config)`. Anything else fails, naming the file.

`jeeves-scripts run` and `doctor` register the root with the loader (`setConfigRoot(root)`) before anything loads; they no longer set `JEEVES_SCRIPTS_CONFIG`. Runner jobs need no environment and no runner change. `config check` and `doctor` say where the config came from: `pointer <file>`, `JEEVES_SCRIPTS_CONFIG`, `--config` or `legacy repo file` (`resolveConfig()` returns `{ path, source, pointer? }`; `getLoadedConfigSource()` after a load).

## Editing the config

Edit the config with `config set` and `config unset`, never by hand and never by a PR:

```bash
node bin/jeeves-scripts.js config set slack.channels.C0123.homeDir J:/content/projects/acme
node bin/jeeves-scripts.js config set slack.channels.C0123.homeDir J:/content/projects/acme --live
node bin/jeeves-scripts.js config unset slack.channels.C0123 --live
```

- **Path:** dotted keys from the root (`slack.channels.C0123.homeDir`); a key that contains dots is a bracketed JSON string (`pipeline.refs["slack.myChannel"]`). `set` creates missing parent objects; `unset` requires the key to exist.
- **Value:** parsed as JSON when it parses (`3`, `true`, `{"a":1}`), else taken as a string, so a path or name needs no quotes. A string that would parse as JSON (`"3"`, `"true"`) must reach the command with its double quotes: `'"3"'` in bash and PowerShell 7, `'\"3\"'` in Windows PowerShell 5.1, which strips inner double quotes from native-command arguments. The dry run shows the value as JSON, so check it before `--live`.
- **Who sees the change:** each run reads the config afresh. The watcher's Slack map helpers reload it when the file changes.
- **Validation:** the whole edited document is checked exactly as `config check` checks it (core schema with its secret guard, silo references, the gateway Slack accounts `slack.channelMeta` names, the plugin's `configSchema` on `local`). Invalid: the problems are printed, the exit code is 1 and the file is untouched.
- **Dry run by default:** prints the change as `-` / `+` lines and writes nothing. `--live` writes it.
- **Backups:** before writing, `--live` copies the file to `config.json.<UTC yyyymmddTHHMMSSZ>.bak` beside it and keeps the newest 20.
- **Atomic:** the new content is written to a temporary file in the same directory and renamed over `config.json`, so a job never reads a half-written file.
- A legacy config in the repo is refused: move it first.

## Moving the config

To move an instance from the legacy layout (the full config in the repo's `jeeves-scripts.json`) to a config directory:

1. Merge or close open PRs that change `jeeves-scripts.json`; `config check` passes on the repo file.
2. Copy `jeeves-scripts.json` to `{configRoot}/jeeves-scripts/config.json` (e.g. `J:/config/jeeves-scripts/config.json`).
3. Replace the repo's `jeeves-scripts.json` with the pointer above, naming that directory. `config check` reports `from pointer ...` and passes.
4. Commit and push the pointer; pull it on the instance.
5. Check: `jeeves-scripts list --json` works, one job run (`runner_trigger`) succeeds, and the runner's `sync-jobs` dry run shows no changes.

Rollback: restore the repo's `jeeves-scripts.json` from git (the copy in the config directory is then unused).

The loader is lazy and cached: nothing touches the filesystem until the first getter call, and later calls return the cached config regardless of options. `resetConfig()` clears the cache (tests). `getLoadedConfigPath()` returns the file that was loaded.

## Shape

The JSON Schema ships at `schema/jeeves-scripts.schema.json` in the package (generated from the Zod schema at build time; `generateJsonSchema()` returns the same object). Point `$schema` at it for editor completion:

```json
{
  "$schema": "./node_modules/@karmaniverous/jeeves-scripts-core/schema/jeeves-scripts.schema.json",
  "instance": { "name": "acme", "baseDir": "/base" },
  "paths": { "contentDir": "/base/content" },
  "integrations": {
    "gh": { "account": "acme-org" },
    "x": { "accounts": { "acme": { "relativePath": "x/acme" } } }
  },
  "pipeline": {
    "accounts": [],
    "buckets": { "domains": [], "priority": [] },
    "refs": { "digest.timezone": "America/Chicago" },
    "emailConfig": {
      "reportOnly": true,
      "digest": { "slackChannelId": "C0000000000" }
    }
  },
  "siloRouting": {
    "silos": {
      "client": {
        "basePath": "/base/client",
        "emailDomains": ["client.example.com"]
      }
    }
  },
  "jobs": {
    "meetings-extract": { "enabled": false },
    "admin-sweep-orphaned-tmp": { "extraDirs": ["/base/scratch"] }
  }
}
```

This example passes `config check` as it stands. A `jobs` key must be the id of a registered runnable (core's, or one the instance plugin registers), so a task-file dispatcher's delta such as `"acme-generate-digest": { "silo": "client", "taskFile": "digest/TASK.md" }` belongs in an instance whose plugin registers `acme-generate-digest`.

| Block | Schema | Contents |
| --- | --- | --- |
| `instance` | `instanceSchema` | `name`, `baseDir` (required). Every default path derives from `baseDir`. |
| `paths` | `pathsSchema` | Optional overrides: `configDir`, `contentDir`, `scriptsDir`, `credentialsDir`, `stateDir`, `gogHome`, `tokenMetricsDir`. |
| `integrations` | `integrationsSchema` | `gh` (`bin`, `configDir`, `account`, `botUser`), `qdrant` (`apiUrl`, `serviceName`), `gog` (`bin`), `notion` (`version`), `jira` (`siteUrl`, `email`, `apiTokenPath`, `boardId`, `fieldsFilename`, `maxHistory`), `linear` (`configPath`, `maxHistory`), `x` (`accounts.<handle>.silo`, `.relativePath`). |
| `pipeline` | `pipelineSchema` | Optional. `accounts[]` (mail and calendar), `buckets` (`domains[]`, `priority[]`), `refs` (dotted key → string: Slack ids, Notion ids, time zones), `emailConfig`, `googleDrive`. |
| `siloRouting` | `siloRoutingSchema` | `defaultBasePath` (default: `paths().contentDir`) and named `silos.<name>`: `basePath`, `emailDomains`, `githubOrgs`, `slackWorkspaces`, `jira`, `linear`. |
| `slack` | `slackConfigSchema` | `channels.<channelId>`: `project`, `homeDir` (absolute path). What this instance decides about a channel; see [Slack channels](#slack-channels). `backfillBudgetSeconds` (default 60), `newChannelLookbackDays` (optional): `slack-poll`. `channelMeta` (`slackChannelMetaSchema`, optional): `timezone` and `serverKey` required, `outputDir` required unless the report goes to a channel with a `homeDir`, the rest defaulted; no block: `slack-refresh-channel-meta` skips; see [slack](./slack.md#channel-meta). |
| `people` | `peopleSchema` | `<personId>` (slug): `name`, `emails?`, `accounts?: { channel, account, id }[]`. Which accounts and addresses belong to one person; see [People](#people). |
| `library` | `librarySchema` | `mirrors[]` (default none): `id` (unique slug), `repo` (`owner/repo`), `ref` (default `main`), `subdir` (default whole repo), `dest` (relative to `paths.contentDir`; not under `.meta` in any case, not overlapping another mirror's), `exclude[]`, `minRatio` (default 0.5), `siteLinks` (`pattern` with one `{name}`, `target` with one `{dir}`), `adopt` (default false: take over an existing `dest` the mirror didn't write). The public repo subdirectories `library-sync-mirrors` mirrors; no block, no mirrors; see [library](./library.md#configuration). |
| `punchList` | `punchListSchema` | `dir`, `timeZone`, `slack.channel` and `scriptsRepo` (`repo`, `clone`) required; `retentionDays` (default 30), `slack.account` (default `default`), `slack.pinnedTs`, `specPath`, `installMap` (default none: `owner/name` → `[{ component, packageJson }]`), `lockFile`, `pendingFile`, `cursorFile`, `inboxDir` (default under `{stateDir}/punch-list/`), `inputRoots` (default the default silo's archive directories and the watcher's issues file; absolute, or starting with `{home}` / `{npmGlobal}`). No block: both `punch-list-*` runnables skip; see [punch list](./punch-list.md#configuration). |
| `transcripts` | `transcriptsSchema` | `libraryDir` (default `<default silo>/library/video-transcripts`), `scratchDir` (default `{stateDir}/transcripts`), `userAgent` (default `jeeves-scripts/<instance.name>`), all optional. Read by `transcripts-fetch-video`; the API key is the `TRANSCRIPT_API_KEY` environment variable, never a config value; see [transcripts](./transcripts.md#configuration). |
| `jobs` | `jobsSchema` | Per-runnable deltas by runnable id: `enabled`, `schedule`, `env`, `args`, `timeout_seconds`, `on_failure`, `silo`, `taskFile`, `extraDirs`, `files`, `owners`, `account`, `ruleset`. `on_failure` is validated by `onFailureSchema`, which manifests share. `silo` and `taskFile` are read by the task-file dispatcher (see [dispatchers](./dispatchers.md)) and `silo` is checked by `config check`; `extraDirs` (absolute paths) is read by `admin-sweep-orphaned-tmp`, which sweeps those directories with the same rules as the content and scripts directories ([admin](./admin.md#prerequisites)); `files` (`githubSyncFileSchema`: `source` a relative path under `paths.scriptsDir` with no `..` segment, `target` with no leading `/`), `owners` (`githubSyncOwnerSchema`: `owner`, `type` `user` or `org`, `ruleset`, `include`, `exclude`), `account` (non-empty; default `integrations.gh.botUser`) and `ruleset` (`githubRulesetSchema`) are read by `github-sync-files` ([github](./github.md#configuration)); the rest shape the effective manifest `list --json` prints ([runnables](./runnables.md#instance-deltas)). |
| `local` | none (any JSON) | The instance's own block. Core never reads it; the instance plugin's `configSchema` validates it at plugin load and runnables read it with `localConfig` ([runnables](./runnables.md#instance-runnables-and-overrides)). |

Every schema is exported (Zod 4), with its `z.infer` type (`Config`, `PathsConfigInput`, `IntegrationsConfig`, `PipelineConfig`, `SiloRoutingConfig`, `JobDelta`, ...).

### Slack channels

`slack.channels` maps a Slack channel id to what this instance decides about it: `project` (tags the channel's indexed messages) and `homeDir` (the channel's home directory; must be an absolute path). It is the only place those decisions live; channel names, types, members and user details come from Slack and are cached in `{stateDir}/slack` (state, not config). See [slack.md](./slack.md#channel-config).

Two more `slack` settings tune `slack-poll`: `backfillBudgetSeconds` (positive integer, default 60), the most time one channel may take in a run before it saves its position and hands off to the next channel; and `newChannelLookbackDays` (non-negative; unset by default), how far back a channel with no read position yet is read (`0`: from now; unset: its full history). See [slack.md](./slack.md#read-positions-state).

### People

`people` says which accounts and email addresses belong to one person, which is a decision we make, so it is config:

```json
"people": {
  "jane-doe": {
    "name": "Jane Doe",
    "emails": ["jane@example.com", "jane.doe@example.org"],
    "accounts": [
      { "channel": "slack", "account": "default", "id": "U0JANE0001" },
      { "channel": "slack", "account": "work", "id": "U0JANE0002" }
    ]
  }
}
```

- The key is a lowercase slug. `channel` is the channel kind (`slack`, later `telegram`, ...), `account` the gateway's account id for it, `id` the person's id there.
- No account (`channel` + `account` + `id`) and no email (compared case-insensitively) may belong to two people; `config check` reports the clash.
- Code resolves with `lib/people`: `personForAccount(channel, account, id)`, `personForEmail(email)` (accepts `Name <addr>`), `personForChannelId(channel, id)` (the one owner of an id across accounts), `peopleForEmails`, `emailPeopleFields`. Unlisted accounts and addresses resolve to `undefined`.
- Where it is used: Slack message authors ([slack.md](./slack.md)), token-metrics DM names ([admin.md](./admin.md)), meeting packages ([meetings.md](./meetings.md)), email messages ([email.md](./email.md#output-format)) and calendar events ([calendar.md](./calendar.md)). A listed person gets the configured `name` and their person id; anyone unlisted is recorded as before.
- Facts about each account (name, email, bot flag) still come from the channel, e.g. the Slack cache. To draft the block, run `jeeves-scripts run people-propose` ([cli.md](./cli.md#commands)), check it, and copy what is right.

### Other components' settings

The instance config holds this instance's settings only. A setting that belongs to another component is read from that component's own config, never copied here: the gateway port from the OpenClaw config (`gatewayPort()`), the runner's port from `{configDir}/jeeves-runner/config.json` (`runnerUrl()`), Qdrant's URL from the watcher's `vectorStore.url` (the `qdrant.apiUrl` default). See [lib.md](./lib.md#component-configts). There is no `integrations.gateway` block; like any unknown key, an old one is ignored.

### Secrets

The schema rejects a literal secret value anywhere in the file, including under keys it does not know: a key such as `password`, `token`, `apiKey` or `secret` holding a string is an error. Credentials live in files: IMAP passwords are `{ "secretRef": "<name>" }`, read from `{credentialsDir}/imap/<name>` (`resolveImapPassword`, `imapSecretPath`); Jira, Linear, Notion, X and gog credentials are files under `credentialsDir` / `gogHome`.

## The pipeline block

`pipeline` is optional as a whole (getters throw a config error naming it when a runnable needs it), but when present every field below is validated by `pipelineSchema`; unknown keys are stripped except under `googleDrive`.

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
      "email": "shared@example.com",
      "type": "gmail",
      "emailPolling": true,
      "reportOnly": true
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
    "digest": { "slackChannelId": "C0456..." }
  }
}
```

- `accounts[]` (required): `email`, `type` (`gmail` | `imap`), `emailPolling` (required); `calendar`, `imap`, `folders`, `reportOnly` optional. An account with an `imap` block is polled over IMAP (a `gmail` one with Gmail extensions), the rest through gog. `folders` (IMAP only) defaults to `[Gmail]/All Mail`, `[Gmail]/Spam` and `[Gmail]/Trash` for `gmail` accounts and every listed folder otherwise. `imap.password` must be `{ "secretRef": "<name>" }` (a literal password is a config error); see [Secrets](#secrets) and [email](./email.md#imap-passwords).
- `accounts[].reportOnly` (optional boolean): `true` ingests this one account but never writes back to its mailbox, while the others are still labelled; use it for a mailbox authorised with a read-only token, or one other people watch. It can only opt an account in: an account's effective flag is `emailConfig.reportOnly || accounts[].reportOnly === true` (`reportOnlyFor(pipeline)` resolves it; every email and meetings job uses it). Unlike the global flag, `drain-updates` drops (and logs) any item already queued for such an account instead of leaving it pending, since a read-only token would fail it on every run. See [email](./email.md#report-only).
- `accounts[].calendar`: `{ "serviceAccount": "auto" }` (Workspace mailbox, gog's service account) or `{ "tokenFile": "<path relative to credentialsDir>" }` (OAuth refresh token). See [calendar](./calendar.md#account-configuration).
- `buckets.domains[]` maps email domains (`pattern`, case-insensitive) to buckets; `buckets.priority` orders bucket names (first = highest). Bucket names are also the Gmail labels classification applies (`getBucketNames()`); none is hard-coded.
- `refs`: dotted key → string, read with `getRef(key)` (throws when missing) or `tryGetRef(key)` (`''` when missing). Refs are per-instance ids and settings (Slack channel ids, Notion database ids, `digest.timezone`); there are no defaults and they are not secrets. Every ref is read with a literal key or a `*_REF` constant, so the refs an instance needs can be listed from an instance or core checkout with `grep -rhoE "(try)?[gG]etRef\('[^']+'\)|[A-Z_]+_REF = '[^']+'" src --include='*.ts' --exclude='*.test.ts' | sort -u`.
- `emailConfig.reportOnly` (required): when `true`, every account is report-only: mail is ingested but no Gmail mutation happens (no label actions from poll and historical backfill, no `meeting` label or archive from meeting extraction, none applied by drain-updates, whose queue is left untouched). Skipped actions are dropped, except meeting extraction's, which are caught up once the account is no longer report-only (see [meetings](./meetings.md#reportonly-catch-up)). `accounts[].reportOnly` makes a single account report-only while this is `false`.
- `emailConfig.digest` (required): `slackChannelId` for email digest delivery.
- `emailConfig.backfill` (optional): `{ "accounts": [...], "lookbackDays": 90, "windowDays": 7 }`, all required when present, no defaults. Paced historical Gmail backfill (`email/backfill-historical`); each run searches one window per account, walking back until `lookbackDays`, then no-ops. `--accounts`, `--lookback-days`, `--window-days` override. Backfill accounts are included in `getGmailAccounts()`.
- `emailConfig.meetings` (optional): `{ "archive": boolean }`, the Gmail action on a meeting's source email (`false`: label only; `true`: label and archive out of `INBOX`, never a watched one). Absent means `archive: true`. A report-only account (either flag) overrides both.
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
| `reportOnlyFor(pipeline)` | `(account) => boolean`: each account's effective report-only flag (`emailConfig.reportOnly \|\| accounts[].reportOnly === true`), matched on the trimmed, lowercased address; an address not in `accounts` follows the global flag. Pure. |
| `getBucketNames()`, `getBucketForDomain(domain)`, `getBucketPriority(bucket)` | Bucket routing. |
| `derivePaths(config)`, `deriveIntegrations(config)` | The same values from a config object, without the loader (pure; for tests). |

Library code reads config-derived values through `constants()` (`lib/constants`), which keeps the template's names (`constants().CONTENT_DIR`, `constants().GH_BIN`, ...) as a cached function of the loaded config. See [lib.md](./lib.md).

### Environment overrides

These win over the file: `GOG_HOME` (`paths().gogHome`), `TOKEN_METRICS_DIR` (`paths().tokenMetricsDir`), `GH_CONFIG_DIR`, `QDRANT_API_URL`, `LINEAR_CONFIG_PATH`, `JIRA_BOARD_ID` (`integrations().jira.boardId`). Set a value in one place only.

## Silos

Every content path core resolves goes through a silo. The default silo's base path is `siloRouting.defaultBasePath`, else `paths().contentDir`; named silos are `siloRouting.silos.<name>.basePath`. A single-tenant instance can omit `siloRouting`.

Each silo: `basePath` (required; give an absolute path, since a relative one resolves against the working directory); `emailDomains` (mail domains), `githubOrgs` (org names, or `{ "githubOrg", "relativePath" }` to route an org to a subdirectory), `slackWorkspaces` (team ids), `jira` / `linear` (`true`: that integration's content routes here), all optional.

- `siloPath(silo, segments)` joins `segments` onto the silo's base path (`undefined` = the default silo). Throws `UnknownSiloError` for an unconfigured name.
- `isKnownSilo(silo)` checks a name; `siloRouting()` returns the resolved `siloRouting` block (the default silo's base path filled in).
- Routing: `getBasePathForEmailDomain`, `getBasePathForGitHubOrg`, `getBasePathForSlackWorkspace`, `getBasePathForMeeting` (majority vote over attendee domains), `getBasePathForJira`, `getBasePathForLinear`, `getEmailBaseForAccount`, `getCalendarBaseForAccount`, `getEntityDirs`. Each falls back to the default silo.

Instance and plugin code never joins absolute content roots itself; it calls `siloPath`.

## Validation: `config check`

`configCheck({ root?, configPath? })` (and `jeeves-scripts config check`) loads the file fresh, validates it, and checks that every `jobs.<id>.silo` and every `integrations.x.accounts.<handle>.silo` names a configured silo, and that `slack.channelMeta.reportAccount` and every `reportTextAccounts` entry name a gateway Slack account (OpenClaw's configured bot tokens, read only when the block names one; `configCheck(options, { slackAccounts })` takes another reader). It returns `{ ok, configPath, errors }`; the CLI prints one line per error and exits 1 on failure. When those checks pass, `jeeves-scripts config check` also loads the instance plugin, as `list` and `run` do, so the plugin's `configSchema` validates the `local` block; a plugin that fails to load or rejects `local` adds its message to `errors` (`instanceConfigCheck` in `src/cli/config-check.ts`). Registration then checks the manifests and the `jobs` deltas as `list` does: a delta for an id no runnable has fails, and so does a delta that sets `enabled`, `schedule`, `timeout_seconds`, `env` or `args` on a runnable with no manifest, where those fields would have no effect (Decision 58).

## Key files

| File | Purpose |
| --- | --- |
| `src/config/schema.ts` | `configSchema` (secret scan + object schema), `configObjectSchema`, `instanceSchema` |
| `src/config/loader.ts` | `loadConfig`, `resolveConfigPath`, `resetConfig`, `CONFIG_PATH_ENV` |
| `src/config/paths.ts`, `integrations.ts` | `paths()`, `integrations()` and their pure `derive*` forms |
| `src/config/pipeline-accessors.ts` | `pipeline()`, refs, account and bucket accessors |
| `src/config/silo-router.ts` | `siloPath`, `siloRouting()`, routing functions, `UnknownSiloError` |
| `src/config/secret-guard.ts`, `imap-secrets.ts` | Secret-literal scan; IMAP `secretRef` resolution |
| `src/config/json-schema.ts` | `generateJsonSchema()` |
| `src/config/check.ts` | `configCheck()` |
| `src/config/pipeline-schema.ts`, `pipeline-email-schema.ts`, `silo-schema.ts`, `paths-schema.ts`, `integrations-schema.ts`, `jobs-schema.ts` | The block schemas |
