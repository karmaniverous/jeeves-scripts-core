# jobs/

The job registry (Decisions 4, 5, 40): core's jobs, their ids, their manifests, and how an instance adjusts them.

## Job ids

A job id is the public contract: runner jobs run `node {scriptsDir}/bin/jeeves-scripts.js run <id> [args...]` (see [cli](./cli.md)). Core's ids:

| Domain | Scheduled (manifest in core) | Manual or event-driven (no manifest) |
| --- | --- | --- |
| `admin` | `admin-check-qdrant-health`, `admin-collect-token-metrics`, `admin-refresh-sessions`, `admin-refresh-token-rates`, `admin-sweep-orphaned-tmp` | `admin-regenerate-token-metrics` |
| `calendar` | `calendar-poll` |  |
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

`schedule` is any jeeves-runner schedule object (a recurrence with `freq`, `interval`, `byhour`, `byminute`, `timezone`, or a `rules` set). A non-null `prerequisite` says what must be set up first; deploy registers only jobs without one. Every manifest is validated with Zod; an invalid entry or an id in two files fails with the file name.

## Instance deltas

An instance never copies a core manifest. It adjusts a core job with a delta under `jobs.<id>` in `jeeves-scripts.json` (see [config](./config.md)):

```json
{
  "jobs": {
    "slack-poll": { "schedule": { "freq": "minutely", "interval": 5 } },
    "email-backfill-historical": { "enabled": false },
    "google-drive-sync": {
      "env": { "JR_DB_PATH": "/base/state/runner/runner.sqlite" }
    }
  }
}
```

| Field | Effect |
| --- | --- |
| `enabled`, `timeout_seconds`, `schedule` | Replace the manifest's value (a schedule wholesale). |
| `env` | Merged key by key over the manifest's; the delta wins. |
| `args` | Appended to the manifest's. |
| `silo`, `taskFile` | Read by the job itself (task-file dispatchers); no runner effect. |

A delta for an id that is neither a core job nor an instance job is an error. `src/jobs/manifest.ts` (`readCoreManifests`, `applyDelta`, `effectiveManifests`) implements this; the `jobs` command that prints the effective set comes with Dev Plan 33 phase 3.

## Instance jobs and overrides

Until plugins land (Dev Plan 33 phase 2), an instance declares its own jobs in `{root}/jobs/*.json` as runner job objects with a `script` path (`src/<domain>/<name>.ts`). Rules (enforced by `run`; see "How run resolves a job" in [cli](./cli.md)):

- An instance file never replaces a core job. An instance entry that reuses a core id with a script present in the instance repo fails. To change what a core job does, use a delta, or (phase 2) a declared override.
- An instance-only id runs the instance file at its `script` path.
- An instance-only id whose `script` names a core module, with no instance file there, runs that core job (a transitional alias for runner job ids that differ from core's).

## Key files

| File | Purpose |
| --- | --- |
| `src/jobs/define-job.ts` | `defineJob`, `isJobModule`, `runJobModule` |
| `src/jobs/registry.ts` | `coreJobs`, `findJob`, `findJobByScript`, `loadJob` |
| `src/jobs/manifest.ts` | Manifest schema, `readCoreManifests`, `applyDelta`, `effectiveManifests` |
| `src/config/jobs-schema.ts` | The `jobs` delta and runner schedule schemas |
| `jobs/<domain>.json` | Core's manifests |
