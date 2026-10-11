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

## The global hand-off

The package `bin` (`jeeves-scripts ...` after `npm install -g @karmaniverous/jeeves-scripts-core`, or `npx jeeves-scripts ...`) is a hand-off only. It finds the scripts repo by, in order:

1. a leading `--dir <path>` (or `--dir=<path>`), before the verb, so a runnable's own arguments are never taken;
2. `JEEVES_SCRIPTS_DIR`;
3. the nearest `jeeves-scripts.json` at or above the working directory;

and runs that repo's `bin/jeeves-scripts.js` with the rest of the command line, so the repo's pinned core runs, whatever version is installed globally. With no repo found (or one without its launcher yet), it runs only `init`, `--help` and `--version` itself, in the named directory or the working directory; anything else exits 1 saying how to point it at a repo. Runner jobs never use it.

```bash
jeeves-scripts --dir /srv/jeeves-scripts list   # any directory
jeeves-scripts doctor                           # inside the repo
jeeves-scripts --dir ./new-instance init        # no repo yet
```

## Commands

| Command | What it does |
| --- | --- |
| `run <id> [args...]` | Run a runnable by id (below). Everything after the id is passed to it unchanged. Exit 0 when done or skipped; 1 on a crash, an unknown id or a registration error; a runnable may set another code with `process.exitCode`. |
| `list [glob] [--json]` | Every registered runnable whose id matches the glob ([below](#listing-runnables)). Exit 1 on an invalid manifest, delta or registration. |
| `config check [--config <file>]` | Validate `jeeves-scripts.json` against the schema and its silo references, then load the instance plugin as `list` and `run` do, so its `configSchema` validates the `local` block ([jobs](./jobs.md#instance-runnables-and-overrides)); a plugin that fails to load or rejects `local` is a problem like any other. Prints `config check: OK (<path>)`, or `config check: FAILED (<path>)` and one line per problem with exit code 1. |
| `doctor` | Report on the instance ([below](#doctor)). Informational: always exits 0. |
| `--version`, `--help` | The core version; usage. |
| `init [--name <pkg>] [--core <version>]` | Write an instance repo into the root from the template bundled in core ([below](#init)). Exit 1 on an invalid name or version. |
| `skills install \| uninstall \| status [--yes]` | Wire core's shipped skills into OpenClaw through `openclaw config set` ([below](#skills)). Exit 1 when `openclaw` fails. |
| `run people-propose [--all] [--out <file>]` | Runnable `people-propose` (no manifest). Read-only: reads `users.list` for every gateway Slack bot account (`slackBotTokens`), skips bots, deactivated users and Slackbot, groups users across workspaces by email (case-insensitive) and real name, and prints `{ summary, people, uncertain }`: a proposed `people` block ([config.md](./config.md#people)) of people with more than one account (`--all`: everyone) and the matches to check by hand (grouped by name only; a name shared inside one workspace; one email on two users of a workspace). Never writes config; `--out` writes the same JSON (UTF-8) to a file and refuses `jeeves-scripts.json`. |
| `run email-apply-labels [--since <date>] [--account <id>] [--max <n>] [--dry-run] [--config <file>]` | Runnable `email-apply-labels` (no manifest). Enqueue the classification labels stored thread state calls for but that were never applied (e.g. while `emailConfig.reportOnly` was on); `drain-updates` applies them. Idempotent. Refuses while `reportOnly` is on unless `--dry-run`. See [email.md](./email.md#label-catch-up). |

Domain work is never a CLI verb (Decision 49): it is a runnable, run with `run <id>`, like the last two rows. The CLI's own verbs are `run`, `list`, `config check`, `doctor`, `init` and `skills`.

`main()` resolves to the exit code and never calls `process.exit` itself. A verb that fails (an unknown id, a plugin that fails to load, an invalid manifest or delta) prints one line, `<verb>: FAILED: <reason>`, to stderr, with no stack trace, and resolves to 1. Commander's own parse errors (an unknown verb or option, a missing argument) print Commander's message and exit 1 through Commander.

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
| `schedule` | The effective schedule after instance deltas, as the runner stores it (a cron string as written, an RRStack object as compact JSON), when it has a manifest; blank otherwise |
| `enabled` | The effective `enabled` after deltas, when it has a manifest; blank otherwise |
| `description` | The manifest's `description`, else the `defineJob` one |

`--json` prints an array with one object per runnable: the same fields (`schedule` and `enabled` are `null` without a manifest) plus `domain` and `manifest` (the effective manifest after deltas, or `null`). `schedule` is as written: a string (cron, or RRStack JSON) or an RRStack object ([jobs](./jobs.md#manifests)); the runner job's `schedule` is the string, or the object's JSON. A manifest without `timeout_seconds` registers a job with no timeout. jeeves-tools registers runner jobs from it: every entry with a manifest whose `prerequisite` is `null`. `list` reads the instance config (for deltas), loads the plugin, reads core's and the instance's manifests, and imports the modules of runnables without a manifest to read their descriptions.

## Init

`jeeves-scripts init [--name <pkg>] [--core <version>]` writes a new instance repo into the root (the working directory for `npx`):

```bash
mkdir jeeves-scripts && cd jeeves-scripts
npx @karmaniverous/jeeves-scripts-core init
npm install
node bin/jeeves-scripts.js config check
node bin/jeeves-scripts.js doctor
```

- It copies the template bundled in the package (`template/`, fewer than 15 files: the launcher, a sample `jeeves-scripts.json`, the plugin with the sample runnable `example-say-hello` and its manifest and test, one-line tool configs extending core's presets, and a README).
- It **never overwrites** a file: every file that exists is reported as skipped, so running it again in a repo changes nothing.
- `gitignore`, `npmrc` and `nvmrc` are stored renamed in the package (npm would drop or rename them) and written as `.gitignore`, `.npmrc` and `.nvmrc`.
- `package.json` gets the package name (`--name`, default the name of the folder it writes into, which must then be a valid npm package name) and core pinned at an exact version (`--core`, default the running core's version); a range such as `^0.1.0` is refused.
- At the end, when `openclaw` is on the host, it runs `skills install` (which shows the change and asks); otherwise it prints the command to run later.

## Skills

Core ships its skills in the package (`skills/<name>/SKILL.md`); they are wired into OpenClaw, never copied. Each declares `JEEVES_SCRIPTS_DIR` (`metadata.openclaw.requires.env`) and names every file as a `$JEEVES_SCRIPTS_DIR/...` path, such as `$JEEVES_SCRIPTS_DIR/node_modules/@karmaniverous/jeeves-scripts-core/guides/email.md`.

| Command | What it changes in OpenClaw's config |
| --- | --- |
| `skills install` | Adds `<repo>/node_modules/@karmaniverous/jeeves-scripts-core/skills` to `skills.load.extraDirs` (exact match, so running it again changes nothing) and sets `skills.entries.<skill>.env.JEEVES_SCRIPTS_DIR` to the repo root for each shipped skill. |
| `skills uninstall` | Removes exactly those entries: this repo's folder from `extraDirs`, and each `JEEVES_SCRIPTS_DIR` that names this repo. |
| `skills status` | Changes nothing. Reports the folder and each skill as `wired`, `missing` or `stale` (another core skills folder in `extraDirs`, or `JEEVES_SCRIPTS_DIR` naming another repo), and a core skill shadowed by a same-named skill from another source (such as the workspace). |

`install` and `uninstall` print the change and ask `Apply? [y/N]`; `--yes` applies without asking. Without a terminal to ask on (a script, a runner job), they apply nothing and print the command to re-run with `--yes`. Changes go through `openclaw config get`, `openclaw config set --batch-file` (one atomic batch) and `openclaw config unset`, so OpenClaw validates its own config.

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
| `src/cli/init.ts` | `initRepo`, `formatInit` |
| `src/cli/skills.ts` | `skills install \| uninstall \| status`: the changes, the status report, the confirmation |
| `src/cli/hand-off.ts` | The global hand-off: `--dir`, `JEEVES_SCRIPTS_DIR`, walk-up, delegation to the repo's launcher |
| `src/cli/openclaw.ts` | The `openclaw` CLI calls (config get, batch set, unset, skills list) |
| `src/cli/package-info.ts` | The running core's package directory and version |
| `src/cli/load-plugin.ts` | `loadPlugin`: imports `jeeves-scripts.plugin.ts` with tsx |
| `src/cli/run.ts` | `registerInstance`, `resolveRunnable`, `runJob` |
| `src/jobs/` | `defineJob`, the job registry and manifests ([jobs](./jobs.md)) |
| `src/cli/bin.ts` | Package `bin`: the global hand-off |
