# jobs/

The runnable registry (Decisions 4, 5, 40, 49, 50): core's runnables, their ids, their manifests, and how an instance adds to and adjusts them through its plugin, its manifests and its deltas.

## Job ids

A job id is the public contract: runner jobs run `node {scriptsDir}/bin/jeeves-scripts.js run <id> [args...]` (see [cli](./cli.md)). Core's ids:

| Domain | Scheduled (manifest in core) | Manual or event-driven (no manifest) |
| --- | --- | --- |
| `admin` | `admin-check-qdrant-health`, `admin-collect-token-metrics`, `admin-refresh-sessions`, `admin-refresh-token-rates`, `admin-sweep-orphaned-tmp` | `admin-regenerate-token-metrics` |
| `calendar` | `calendar-poll` |  |
| `convert` |  | `convert-docx-to-md`, `convert-pdf-to-md` ([convert](./convert.md#runnables)) |
| `email` | `email-poll`, `email-download`, `email-drain-updates`, `email-backfill-historical` | `email-apply-labels`, `email-inventory` |
| `github` | `github-sync-repos`, `github-sync-issues`, `github-watch`, `github-build-registry`, `github-poll-collabs`, `github-drain-collabs` |  |
| `google-drive` | `google-drive-sync` |  |
| `jira` | `jira-refresh-fields`, `jira-sort-backlog` | `jira-backfill`, `jira-drain` |
| `linear` | `linear-sync-issues`, `linear-sync-comments` | `linear-backfill`, `linear-drain` |
| `meetings` | `meetings-fetch-notes`, `meetings-extract`, `meetings-ingest-notion` |  |
| `meta` | `meta-sweep-duplicates`, `meta-disable-old` |  |
| `slack` | `slack-poll` |  |
| `x` | `x-poll-posts`, `x-poll-mentions`, `x-poll-feed`, `x-poll-likes`, `x-poll-bookmarks`, `x-drain-queues` | `x-post`, `x-refresh-token`, `x-like`, `x-repost` (kept, Decision 50) |
| `people` |  | `people-propose` |

The scheduled ids are the template's manifest ids. `src/jobs/registry.ts` holds the list; each domain's guide says what its jobs do.

## Declaring a job

Every job module default-exports `defineJob(...)`, exported from the package root:

```ts
import { defineJob } from '@karmaniverous/jeeves-scripts-core';

export default defineJob({
  id: 'acme-report', // domain-verb[-modifier][-object][-specifier]
  domain: 'acme', // the top-level source folder
  description: 'Report on acme.', // one line for list; required without a manifest
  name: 'acme/report', // crash-log label; default: the id
  crashDir: () => '/base/acme', // where _crash.log goes; default: the working directory
  prerequisite: () => hasAcmeConfig() || 'no acme block in jeeves-scripts.json',
  run: async ({ args }) => {
    await report(args.includes('--live'));
  },
});
```

The declaration is validated with Zod (Decision 31) and returned frozen: the id and domain are lowercase words separated by dashes, and the id starts with its domain and a dash (`acme-report` in `acme`, `google-drive-sync-files` in `google-drive`), so `acme` alone or `report-acme` throws. A runnable without a manifest needs a `description`: core's registry tests check every core one. Importing a job module never runs the job. Running it (`run <id>`):

1. sets `process.argv` to `[node, <id>, ...args]` (job code may read `process.argv.slice(2)` as before) and passes the args as `ctx.args`;
2. checks `prerequisite`: anything but `true` logs `[skip] <reason>` and the run exits 0;
3. runs `run` inside `runScript(name ?? id, ..., crashDir)` from `@karmaniverous/jeeves`: an uncaught error is logged, appended to `_crash.log`, and exits 1.

Core's jobs keep the crash labels and crash directories they had before the registry (`email/poll`, `x/poll-posts`, ...), and their inline `[skip]` guards; `prerequisite` is for new jobs. Some modules still compute config-derived constants when imported; none starts work.

## Manifests

Scheduled core jobs have a manifest in core, `jobs/<domain>.json`: an object keyed by job id with the runner fields and no `script` (runner jobs run the launcher with `run <id>`):

```json
{
  "slack-poll": {
    "name": "Slack Poll",
    "description": "Poll Slack channels for new messages, auto-discover new channels, and write per-message JSON archives.",
    "schedule": { "freq": "minutely", "interval": 11, "timezone": "UTC" },
    "overlap_policy": "skip",
    "timeout_seconds": 300,
    "enabled": true,
    "prerequisite": "..."
  }
}
```

`schedule` takes every form a jeeves-runner job's schedule takes, and only those (Decision 54): it is validated with the runner's own `validateSchedule`, so a manifest is valid exactly when the runner would accept its schedule.

| Form | Example | Time zone |
| --- | --- | --- |
| Cron expression (croner: five, six or seven fields, or a nickname such as `@daily`) | `"17 */6 * * *"` | The runner host's |
| RRStack, flat: `freq` and `timezone` plus any RRule option (`interval`, `byhour`, `byminute`, `byweekday`, ...) | `{ "freq": "daily", "byhour": 6, "byminute": 0, "timezone": "UTC" }` | `timezone` (an IANA zone), required |
| RRStack, full: `timezone`, optional `timeUnit`, `rules` | `{ "timezone": "UTC", "timeUnit": "ms", "rules": [{ "effect": "event", "options": { "freq": "minutely", "interval": 11 } }] }` | `timezone`, required |

An RRStack schedule may also be written as its JSON string. The runner stores a schedule as a string: a string as written, an object as its JSON (`scheduleText`). An invalid schedule fails with the runner's message. `timeout_seconds` is optional, as in the runner: without it the job has no timeout. A non-null `prerequisite` says what must be set up first; deploy registers only jobs without one. Every manifest is validated with Zod; an invalid entry or an id in two files fails with the file name.

An instance's own manifests are `{root}/jobs/*.json` in the same format. Each id must be a registered runnable that has no core manifest: an instance runnable, or a core runnable that ships without one (for example `x-post`, Decision 50). A core manifest is changed only by a delta (below). `list` fails, naming the file, on an instance manifest that breaks these rules.

## Instance deltas

An instance never copies a core manifest. It adjusts a runnable's manifest (core's or its own) with a delta under `jobs.<id>` in `jeeves-scripts.json` (see [config](./config.md)):

```json
{
  "jobs": {
    "slack-poll": {
      "schedule": { "freq": "minutely", "interval": 5, "timezone": "UTC" }
    },
    "email-backfill-historical": { "enabled": false },
    "google-drive-sync": {
      "env": { "JR_DB_PATH": "/base/state/runner/runner.sqlite" }
    }
  }
}
```

| Field | Effect |
| --- | --- |
| `enabled`, `timeout_seconds`, `schedule` | Replace the manifest's value (a schedule wholesale); a delta's `timeout_seconds` also sets one on a manifest that has none. |
| `env` | Merged key by key over the manifest's; the delta wins. |
| `args` | Appended to the manifest's. |
| `silo`, `taskFile` | Read by the job itself (task-file dispatchers); no runner effect. |

A delta for an id that is neither a core nor an instance runnable is an error. `src/jobs/manifest.ts` (`readCoreManifests`, `applyDelta`, `effectiveManifests`) and `src/jobs/runnables.ts` (`registeredManifests`) implement this; `jeeves-scripts list --json` prints the effective set ([cli](./cli.md#listing-runnables)). Deltas shape what registration uses; they do not change a runner job that already exists.

## Instance runnables and overrides

An instance adds to core through its plugin, `{root}/jeeves-scripts.plugin.ts`. The CLI imports it in its own process with tsx (no build step) before `run`, `list` and `doctor`; a repo without the file has no plugin.

```ts
import { definePlugin, override } from '@karmaniverous/jeeves-scripts-core';
import { z } from 'zod';

import acmeReport from './src/acme/report.js';
import { pollMyWay } from './src/acme/poll.js';

export default definePlugin({
  // Instance runnables: defineJob modules, exactly like core's.
  jobs: [acmeReport],
  // Declared replacements of core runnables (R20).
  overrides: [
    override({
      job: 'email-poll', // the core id it replaces
      issue: 'karmaniverous/jeeves-scripts-core#123', // why
      writtenFor: '0.1.0', // the exact core version it was written against
      run: async ({ args }) => {
        await pollMyWay(args);
      },
    }),
  ],
  // Validates the instance's own `local` block in jeeves-scripts.json.
  configSchema: z.object({ reportChannel: z.string() }),
});
```

Registration (plugin load) fails, listing every problem with its id and domain, when:

- a plugin runnable reuses a core id (declare an override instead), or uses a core domain (`admin`, `email`, `x`, ...; instance domains never reuse one), or two plugin runnables share an id;
- an override names no core runnable, or two overrides name the same one.

`defineJob` itself already rejects an id that doesn't start with its domain and a dash. `definePlugin` and `override` validate their declarations with Zod and return them frozen; an unknown field (there is no `extensions` field, Decision 50) is an error.

An override runs instead of core's runnable, under core's id and domain; `list` shows its source as `override`. It needs unit tests in the instance repo. `writtenFor` records the core version it was written for, so a core upgrade can review every override whose core has moved on: `doctor` marks each one whose `writtenFor` differs from the installed core as `DRIFT` ([cli](./cli.md#doctor)); it never fails a run.

**Instance config.** Core never reads `local` in `jeeves-scripts.json`. When the plugin declares a `configSchema`, the CLI parses `local` with it at plugin load (an invalid block fails, naming the config file) and runnables read the result with `localConfig`:

```ts
import { localConfig } from '@karmaniverous/jeeves-scripts-core';

import type { configSchema } from '../../local-config.js';

const { reportChannel } = localConfig<typeof configSchema>();
```

`localConfig` throws when no `configSchema` was loaded.

## Key files

| File | Purpose |
| --- | --- |
| `src/jobs/define-job.ts` | `defineJob`, `isJobModule`, `runJobModule` |
| `src/jobs/registry.ts` | `coreJobs`, `coreDomains`, `findJob`, `loadJob` |
| `src/jobs/plugin.ts` | `definePlugin`, `override`, `localConfig` |
| `src/jobs/runnables.ts` | Registration: `buildRunnables`, `readInstanceManifests`, `registeredManifests` |
| `src/cli/load-plugin.ts` | Loads `jeeves-scripts.plugin.ts` with tsx |
| `src/jobs/manifest.ts` | Manifest schema, `readCoreManifests`, `applyDelta`, `effectiveManifests` |
| `src/config/jobs-schema.ts` | The `jobs` delta schema |
| `src/config/schedule-schema.ts` | The schedule schema (the runner's `validateSchedule`) and `scheduleText` |
| `jobs/<domain>.json` | Core's manifests |
