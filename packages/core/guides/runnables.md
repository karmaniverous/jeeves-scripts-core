---
title: Runnables
---

# runnables/

The runnable registry (Decisions 4, 5, 40, 49, 50): core's runnables, their ids, their manifests, and how an instance adds to and adjusts them through its plugin, its manifests and its deltas.

**Runnable or job (Decision 73).** A _runnable_ is anything `jeeves-scripts run <id>` starts. A _job_ is a runnable registered in jeeves-runner: one with a manifest, scheduled or not. Manifests (`jobs/*.json`), the `jobs.<id>` deltas in `jeeves-scripts.json` and runner job ids keep the word because they describe runner jobs. `defineJob` is the pre-0.3.0 name of `defineRunnable`, still exported and deprecated. It runs unchanged, but core's ESLint preset (`strictTypeChecked`, so `@typescript-eslint/no-deprecated`) fails an instance's lint on every call, so upgrading an instance to 0.3.0 includes replacing `defineJob` with `defineRunnable` in its `src/` (same signature: a rename, nothing else).

## Runnable ids

A runnable id is the public contract: runner jobs run `node $JEEVES_SCRIPTS_DIR/bin/jeeves-scripts.js run <id> [args...]` (see [cli](./cli.md)). Core's ids:

| Domain | Scheduled (manifest in core) | Manual or event-driven (no manifest) |
| --- | --- | --- |
| `admin` | `admin-check-qdrant-health`, `admin-collect-token-metrics`, `admin-refresh-sessions`, `admin-refresh-token-rates`, `admin-sweep-orphaned-tmp` | `admin-regenerate-token-metrics`, `admin-report-token-metrics` |
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

The scheduled ids are the template's manifest ids. `src/runnables/registry-scheduled.ts` and `src/runnables/registry-on-demand.ts` hold the lists (`src/runnables/registry.ts` joins them); each domain's guide says what its runnables do.

## Declaring a runnable

Every runnable module default-exports `defineRunnable(...)`, exported from the package root:

```ts
import { defineRunnable } from '@karmaniverous/jeeves-scripts-core';

export default defineRunnable({
  id: 'acme-report', // domain-verb[-modifier][-object][-specifier]
  domain: 'acme', // the top-level source folder
  description: 'Report on acme.', // one line for list; registration fails without it when there's no manifest
  name: 'acme/report', // crash-log label; default: the id
  crashDir: () => '/base/acme', // where _crash.log goes; default: the working directory
  prerequisite: () => hasAcmeConfig() || 'no acme block in jeeves-scripts.json',
  flags: { live: argFlag('--live', 'Write changes') }, // the flags run accepts (see Arguments)
  run: async ({ flags }) => {
    await report(flags.live);
  },
});
```

The declaration is validated with Zod (Decision 31) and returned frozen: the id and domain are lowercase words separated by dashes, and the id starts with its domain and a dash (`acme-report` in `acme`, `google-drive-sync-files` in `google-drive`), so `acme` alone or `report-acme` throws. A runnable without a manifest needs a `description`: core's registry tests check every core one. Importing a runnable module never runs it. Running it (`run <id>`):

1. sets `process.argv` to `[node, <id>, ...args]` (runnable code may read `process.argv.slice(2)` as before) and passes the args as `ctx.args`;
2. checks `prerequisite`: anything but `true` logs `[skip] <reason>` and the run exits 0;
3. runs `run` inside `runScript(name ?? id, ..., crashDir)` from `@karmaniverous/jeeves`: an uncaught error is logged, appended to `_crash.log`, and exits 1.

Core's runnables keep the crash labels and crash directories they had before the registry (`email/poll`, `x/poll-posts`, ...; the two that named the removed `core` domain are `admin/qdrant-health-check` and `admin/sweep-orphaned-tmp`), and their inline `[skip]` guards; `prerequisite` is for new runnables (the X handle check is one). No runnable module reads config when imported: each `run` builds its collaborators from config when it runs, and hands its work back (returns or awaits it). `src/runnables/registry-runs.test.ts` imports and runs every core runnable with no loadable config to pin both (Decision 58).

### Failures, skips and exit codes

A runnable never ends the process itself (`process.exit` is a lint error in core). It reports through the framework (Decision 58):

- **Failure:** throw. `runScript` writes the `CRASH (<label>)` line and the runnable's `_crash.log`, and the process exits 1.
- **Clean skip** (a credential or input that isn't configured): an unmet `prerequisite`, or a `[skip] <reason>` line and a return; exit 0.
- **Usage error** (a missing or invalid argument): the usage message on stderr and `process.exitCode = 1`, then return.
- **Partial failure** (some items failed, the rest were processed): `process.exitCode = 1` after the run's summary.

A runnable's logic takes its config values, file roots, clients, clock and arguments as parameters; its `run` builds the live ones from `ctx.args` and config when it runs (`run: ({ args }) => main(args, liveDeps())`), so tests pass their own.

### Arguments

A runnable declares the flags it accepts as `defineRunnable({ flags })`, and reads them, parsed, from `ctx.flags`; positionals come from `ctx.args` (everything after `run <id>`). Core's runnables and instance runnables use one convention and one parser from the root export (Decision 59):

- **Boolean options are bare flags:** `--live`, `--dry-run`. Present means `true`; `--live=true` is rejected as an unknown option.
- **Valued options** are `--name value` or `--name=value` (the first `=` splits, so `--services=a=b` gives `a=b`), optionally with a short alias written `-e value`. The first occurrence wins.
- **Positionals** are the arguments that don't start with `-` and aren't the separate value of a valued option. A runnable that takes any declares `positionals`, a usage string such as `'<handle>'`.

```ts
import {
  argFlag,
  argOptional,
  argValue,
  defineRunnable,
  positionalArgs,
} from '@karmaniverous/jeeves-scripts-core';

const flags = {
  live: argFlag('--live', 'Write changes (default: dry run)'), // boolean
  project: argValue('--project', 'ACME', { description: 'Project key' }), // string, default 'ACME'
  env: argOptional('--env', { alias: '-e' }), // string | undefined
};

export default defineRunnable({
  id: 'acme-report',
  domain: 'acme',
  description: 'Report on acme.',
  flags,
  positionals: '<year> <month>',
  run: async ({ args, flags }) => {
    // run acme-report 2026 08 --env=prod --live
    const [year, month] = positionalArgs(args, flags); // ['2026', '08']
    await report({ ...flags, year, month }); // flags is typed from the spec
  },
});
```

**What `run <id>` checks** (#14), before the body runs:

- A runnable that declares `flags` (`flags: {}` for none) accepts only those, plus positionals when it declares `positionals`. Anything else exits 1 with `Unknown option <flag> for <id> (see run <id> --help)` (or `Unexpected argument <arg> ...`). A valued option without a value (at the end, as `--name=`, or followed by an argument starting with `-`, which is then checked on its own and never taken as the value) exits 1 with `<name> requires a value for <id> ...`. Every occurrence is checked, so repeating an option can't hide a flag.
- A runnable that declares no `flags` keeps the old behaviour: it gets every argument unchecked in `ctx.args` (and `ctx.flags` is `{}`), and `run` prints `[deprecated] <id> declares no flags; ...` on stderr when given any flag. **A later minor release rejects undeclared flags for every runnable**, so declare them now.
- `run <id> --help` (or `-h`) prints the usage, description, declared flags with their descriptions and defaults, and the effective manifest, then exits 0 without running anything.

Every core runnable declares its flags (a test enforces it, and that no core source reads `process.argv` or raw `args` for flags). A task-file or Slack dispatcher declares the shared `dispatcherFlags` (`--print-task`, `--dry-run`) from the root export; `taskFileDispatcher` passes the parsed flags on. Check what values mean (a number, a date, a known name) in the runnable, and report a bad one as a usage error. `parseRunnableArgs` stays exported for parsing outside `run`; it is pure, so a test passes its own args.

## Manifests

Core's jobs have a manifest in core, `jobs/<domain>.json`: an object keyed by runnable id (which is also the runner job id) with the runner fields and no `script` (runner jobs run the launcher with `run <id>`):

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

An RRStack schedule may also be written as its JSON string. The runner stores a schedule as a string: a string as written, an object as its JSON (`scheduleText`). An invalid schedule fails with the runner's message. `timeout_seconds` is optional, as in the runner: without it the job has no timeout. `on_failure` is optional too: the Slack target (channel, DM or user id) the runner alerts when a run fails or times out. `null` clears it, so the runner's `notifications.defaultOnFailure` applies. Omitting it registers a new job with no target of its own, which is what core's own manifests do; but the runner's sync writes only the keys a manifest has, so removing `on_failure` from a manifest leaves an existing job's target as it was: set `null` to clear it (#36). A non-null `prerequisite` says what must be set up first; deploy registers only jobs without one. Every manifest is validated with Zod; an invalid entry or an id in two files fails with the file name.

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
| `enabled`, `timeout_seconds`, `schedule`, `on_failure` | Replace the manifest's value (a schedule wholesale); a delta's `timeout_seconds` or `on_failure` also sets one on a manifest that has none, and `on_failure: null` clears the manifest's back to the runner default. |
| `env` | Merged key by key over the manifest's; the delta wins. |
| `args` | Appended to the manifest's. |
| `silo`, `taskFile` | Read by the runnable itself (task-file dispatchers); no runner effect. |
| `extraDirs` | Read by `admin-sweep-orphaned-tmp`: absolute directories it sweeps besides the content and scripts directories ([admin](./admin.md#prerequisites)); no runner effect. |

A delta for an id that is neither a core nor an instance runnable is an error, and so is a delta that sets `enabled`, `schedule`, `timeout_seconds`, `on_failure`, `env` or `args` on a runnable with no manifest (where they would have no effect; give the runnable a manifest instead). The runnable-read fields (`silo`, `taskFile`, `extraDirs`) need no manifest. `src/runnables/manifest.ts` (`readCoreManifests`, `applyDelta`, `effectiveManifests`) and `src/runnables/runnables.ts` (`registeredManifests`) implement this; `jeeves-scripts list --json` prints the effective set ([cli](./cli.md#listing-runnables)). Deltas shape what registration uses; they do not change a runner job that already exists.

## Instance runnables and overrides

An instance adds to core through its plugin, `{root}/jeeves-scripts.plugin.ts`. The CLI imports it in its own process with tsx (no build step) before `run`, `list`, `doctor` and `config check`; a repo without the file has no plugin.

```ts
import { definePlugin, override } from '@karmaniverous/jeeves-scripts-core';
import { z } from 'zod';

import acmeReport from './src/acme/report.js';
import { pollMyWay } from './src/acme/poll.js';

export default definePlugin({
  // Instance runnables: defineRunnable modules, exactly like core's.
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

`defineRunnable` itself already rejects an id that doesn't start with its domain and a dash. `definePlugin` and `override` validate their declarations with Zod and return them frozen; an unknown field (there is no `extensions` field, Decision 50) is an error.

An override runs instead of core's runnable, under core's id and domain, and with core's crash label, crash directory and description; `list` shows its source as `override`. It needs unit tests in the instance repo. `writtenFor` records the exact core version (semver, no range) it was written for, so a core upgrade can review every override whose core has moved on: `doctor` marks each one whose `writtenFor` differs from the installed core as `DRIFT` ([cli](./cli.md#doctor)); it never fails a run.

**Instance config.** Core never reads `local` in `jeeves-scripts.json`. When the plugin declares a `configSchema`, the CLI parses `local` with it at plugin load (an invalid block fails, naming the config file; `config check` loads the plugin to report it) and runnables read the result with `localConfig`:

```ts
import { localConfig } from '@karmaniverous/jeeves-scripts-core';

import type { configSchema } from '../../local-config.js';

const { reportChannel } = localConfig<typeof configSchema>();
```

`localConfig` throws when no `configSchema` was loaded.

## Key files

| File | Purpose |
| --- | --- |
| `src/runnables/define-runnable.ts` | `defineRunnable`, `isJobModule`, `runJobModule` |
| `src/runnables/registry.ts` | `coreJobs`, `coreDomains`, `loadJob` |
| `src/runnables/plugin.ts` | `definePlugin`, `override`, `localConfig` |
| `src/runnables/runnables.ts` | Registration: `buildRunnables`, `readInstanceManifests`, `registeredManifests` |
| `src/cli/load-plugin.ts` | Loads `jeeves-scripts.plugin.ts` with tsx |
| `src/runnables/manifest.ts` | Manifest schema, `readCoreManifests`, `applyDelta`, `effectiveManifests` |
| `src/config/jobs-schema.ts` | The `jobs` delta schema |
| `src/config/schedule-schema.ts` | The schedule schema (the runner's `validateSchedule`) and `scheduleText` |
| `jobs/<domain>.json` | Core's manifests |
