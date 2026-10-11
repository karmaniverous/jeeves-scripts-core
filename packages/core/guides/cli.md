# cli/

The `jeeves-scripts` CLI. Built on `@commander-js/extra-typings`; the instance launcher calls `main()` from `@karmaniverous/jeeves-scripts-core/cli` with the instance repo root, so nothing depends on the working directory or `PATH`.

## The launcher

Every instance repo has `bin/jeeves-scripts.js`:

```js
import process from 'node:process';
import { URL } from 'node:url';

import { main } from '@karmaniverous/jeeves-scripts-core/cli';

process.exitCode = await main({ root: new URL('..', import.meta.url) });
```

Node resolves core from the launcher's own `node_modules`, so a job always runs the core version pinned in that repo. Runner jobs are registered as script `{scriptsDir}/bin/jeeves-scripts.js` with args `["run", "<id>", ...]`; jeeves-runner runs `.js` scripts with `node` on Windows and Linux.

The package `bin` (`npx jeeves-scripts ...`, from the instance repo) does the same with the working directory as the root.

## Commands

| Command | What it does |
| --- | --- |
| `run <id> [args...]` | Run a runnable by id (below). Everything after the id is passed to it unchanged. Exit 0 when done or skipped; 1 on a crash, an unknown id or a registration error; a runnable may set another code with `process.exitCode`. |
| `list [glob] [--json]` | Every registered runnable whose id matches the glob ([below](#listing-runnables)). Exit 1 on an invalid manifest, delta or registration. |
| `config check [--config <file>]` | Validate `jeeves-scripts.json` against the schema and its silo references. Prints `config check: OK (<path>)`, or `config check: FAILED (<path>)` and one line per problem with exit code 1. |
| `doctor` | Report on the instance ([below](#doctor)). Informational: always exits 0. |
| `run people-propose [--all] [--out <file>]` | Runnable `people-propose` (no manifest). Read-only: reads `users.list` for every gateway Slack bot account (`slackBotTokens`), skips bots, deactivated users and Slackbot, groups users across workspaces by email (case-insensitive) and real name, and prints `{ summary, people, uncertain }`: a proposed `people` block ([config.md](./config.md#people)) of people with more than one account (`--all`: everyone) and the matches to check by hand (grouped by name only; a name shared inside one workspace; one email on two users of a workspace). Never writes config; `--out` writes the same JSON (UTF-8) to a file and refuses `jeeves-scripts.json`. |
| `run email-apply-labels [--since <date>] [--account <id>] [--max <n>] [--dry-run] [--config <file>]` | Runnable `email-apply-labels` (no manifest). Enqueue the classification labels stored thread state calls for but that were never applied (e.g. while `emailConfig.reportOnly` was on); `drain-updates` applies them. Idempotent. Refuses while `reportOnly` is on unless `--dry-run`. See [email.md](./email.md#label-catch-up). |

Domain work is never a CLI verb (Decision 49): it is a runnable, run with `run <id>`, like the last two rows. The CLI's own verbs are `run`, `list`, `config check` and `doctor`.

`main()` resolves to the exit code and never calls `process.exit` itself.

## How `run` resolves a runnable

Before resolving, `run` sets `JEEVES_SCRIPTS_CONFIG` to `{root}/jeeves-scripts.json` (unless it is already set) and loads the instance plugin, `{root}/jeeves-scripts.plugin.ts`, in its own process with tsx ([jobs](./jobs.md#instance-runnables-and-overrides)). Then:

1. **A plugin override** for `<id>` runs instead of core's runnable.
2. Else **a core id** runs core's runnable, its module loaded through the registry.
3. Else **a plugin runnable** id runs the instance runnable.
4. Else `run` fails: unknown id.

Every runnable runs in the CLI's process ([`defineJob`](./jobs.md#declaring-a-job): `process.argv` is `[node, <id>, ...args]`, a crash exits 1 through `runScript`). `run` resolves when the body has finished. A plugin that fails to load, or breaks a registration rule (a core id or core domain reused, an override of an unknown id), fails `run` before anything runs.

`run` never adds a manifest's `args`: a registered runner job's args are `["run", <id>, ...effective manifest args]`, so a person typing `run <id>` gets exactly what was typed.

Running a core module by path (`node dist/<domain>/<module>.js`) runs nothing: runnable modules only declare themselves.

## Listing runnables

`jeeves-scripts list [glob] [--json]` lists every registered runnable, core and instance, whose id matches `glob` (shell-style `*`, `?` and `[...]` against the id; default `*`), sorted by id, which sorts by domain:

| Column | Content |
| --- | --- |
| `id` | The runnable id |
| `source` | `core`, `instance`, or `override` (a plugin override of a core id) |
| `schedule` | The effective schedule after instance deltas, as compact JSON, when it has a manifest; blank otherwise |
| `enabled` | The effective `enabled` after deltas, when it has a manifest; blank otherwise |
| `description` | The manifest's `description`, else the `defineJob` one |

`--json` prints an array with one object per runnable: the same fields (`schedule` and `enabled` are `null` without a manifest) plus `domain` and `manifest` (the effective manifest after deltas, or `null`). jeeves-tools registers runner jobs from it: every entry with a manifest whose `prerequisite` is `null`. `list` reads the instance config (for deltas), loads the plugin, reads core's and the instance's manifests, and imports the modules of runnables without a manifest to read their descriptions.

## Doctor

`jeeves-scripts doctor` prints one report and always exits 0; a problem is a line, never a failure:

| Line | Content |
| --- | --- |
| `core:` | The installed core version |
| `config:` | The config file location and `OK` or `FAILED`, with one indented line per problem (as `config check`) |
| `plugin:` | `jeeves-scripts.plugin.ts` with its runnable and override counts, `none`, or `FAILED` with the load or registration error |
| `manifests:` | Every effective manifest (core's and the instance's, deltas applied): enabled or disabled, and its `prerequisite` (`none` means deploy registers it) |
| `overrides:` | Every declared override with the core version it was written for; one whose `writtenFor` differs from the installed core is marked `DRIFT` with its issue to recheck |

Use it after an upgrade (override drift) and when a runnable won't register.

## Examples

```bash
node bin/jeeves-scripts.js config check
node bin/jeeves-scripts.js config check --config ./test/fixture.json
node bin/jeeves-scripts.js list
node bin/jeeves-scripts.js doctor
node bin/jeeves-scripts.js list 'email-*' --json
node bin/jeeves-scripts.js run meetings-fetch-notes --dry-run
node bin/jeeves-scripts.js run email-apply-labels --dry-run --since 2026-10-01
JEEVES_SCRIPTS_CONFIG=/tmp/alt.json node bin/jeeves-scripts.js run admin-refresh-token-rates
```

## Key files

| File | Purpose |
| --- | --- |
| `src/cli/index.ts` | `main`, `buildProgram`, `resolveRoot`, the `config` command |
| `src/cli/list.ts` | `listRunnables`, `formatList` |
| `src/cli/doctor.ts` | `doctorReport` |
| `src/cli/package-info.ts` | The running core's package directory and version |
| `src/cli/load-plugin.ts` | `loadPlugin`: imports `jeeves-scripts.plugin.ts` with tsx |
| `src/cli/run.ts` | `registerInstance`, `resolveRunnable`, `runJob` |
| `src/jobs/` | `defineJob`, the job registry and manifests ([jobs](./jobs.md)) |
| `src/cli/bin.ts` | Package `bin`: runs `main` with the working directory as root |
