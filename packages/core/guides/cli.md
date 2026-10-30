---
title: CLI
---

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

Node resolves core from the launcher's own `node_modules`, so a job always runs the core version pinned in that repo. Runner jobs are registered as script `$JEEVES_SCRIPTS_DIR/bin/jeeves-scripts.js` with args `["run", "<id>", ...]`; jeeves-runner runs `.js` scripts with `node` on Windows and Linux.

## The global hand-off

The package `bin` (`jeeves-scripts ...` after `npm install -g @karmaniverous/jeeves-scripts-core`, or `npx jeeves-scripts ...`) is a hand-off only. It finds the scripts repo by, in order:

1. a leading `--dir <path>` (or `--dir=<path>`), before the verb, so a runnable's own arguments are never taken;
2. `JEEVES_SCRIPTS_DIR`;
3. the nearest `jeeves-scripts.json` (the config pointer, or a legacy config) at or above the working directory;

and runs that repo's `bin/jeeves-scripts.js` with the rest of the command line, so the repo's pinned core runs, whatever version is installed globally. With no repo found (or one without its launcher yet), it runs only `init`, `--help` and `--version` itself, in the named directory or the working directory; anything else exits 1 saying how to point it at a repo. A repo initialised but not yet installed (launcher present, core not resolvable) is treated the same, and the error says to run `npm install` there. Runner jobs never use it.

```bash
jeeves-scripts --dir /srv/jeeves-scripts list   # any directory
jeeves-scripts doctor                           # inside the repo
jeeves-scripts --dir ./new-instance init        # no repo yet
```

## Commands

| Command | What it does |
| --- | --- |
| `run <id> [args...]` | Run a runnable by id (below), checking the arguments against the flags it declares. `run <id> --help` prints its usage, flags and effective manifest and runs nothing. Exit 0 when done or skipped; 1 on a crash, an unknown id, a registration error or an undeclared option; a runnable may set another code with `process.exitCode`. |
| `list [glob] [--json]` | Every registered runnable whose id matches the glob ([below](#listing-runnables)). Exit 1 on an invalid manifest, delta or registration. |
| `config check [--config <file>]` | Validate the instance config ([config.md](./config.md#where-the-file-is)) against the schema and its silo references, then load and register the instance plugin as `list` does: its `configSchema` validates the `local` block ([runnables](./runnables.md#instance-runnables-and-overrides)), and registration checks unique ids, the naming rule and core domains, the instance manifests and the `jobs` deltas (an unknown id fails). A plugin that fails to load or register, an invalid manifest or delta, or a rejected `local` is a problem like any other. Silo references are `jobs.<id>.silo` and `integrations.x.accounts.<handle>.silo`. Prints `config check: OK (<path>, from <source>)` (`pointer <file>`, `JEEVES_SCRIPTS_CONFIG`, `--config` or `legacy repo file`), or `config check: FAILED (...)` and one line per problem with exit code 1. |
| `config set <path> <value> [--live] [--config <file>]`, `config unset <path> [--live] [--config <file>]` | Change the instance config: dry run unless `--live`; the result is validated as `config check` validates it; `--live` writes a dated backup (newest 20 kept) and replaces the file atomically. Refused on a legacy config in the repo. Exit 1 on a bad path or an invalid result. See [config.md](./config.md#editing-the-config). |
| `doctor` | Report on the instance ([below](#doctor)). Informational: always exits 0. |
| `--version`, `--help` | The core version; usage (there is no `help` verb; `<verb> --help` gives a verb's usage). |
| `init --config-dir <dir> [--name <pkg>] [--core <version>]` | Write an instance repo into the root from the template bundled in core, and its `config.json` into `--config-dir` ([below](#init)). Exit 1 on an invalid name or version; `--config-dir` is required. |
| `skills install \| uninstall [-y \| --yes]`, `skills status` | Wire core's shipped skills into OpenClaw through `openclaw config set` ([below](#skills)). Exit 1, with `skills <action>: FAILED: <reason>` on stderr, when `openclaw` fails. |
| `run slack-backfill-history --channel <id> [--before <ts>]` | Runnable `slack-backfill-history` (no manifest): re-reads one Slack channel from its first message up to `--before` (default: the oldest message archived for it), resumably, without moving `slack-poll`'s read position. See [slack.md](./slack.md#re-reading-history). |
| `run people-propose [--all] [--out <file>]` | Runnable `people-propose` (no manifest). Read-only: reads `users.list` for every gateway Slack bot account (`slackBotTokens`), skips bots, deactivated users and Slackbot, groups users across workspaces by email (case-insensitive) and real name, and prints `{ summary, people, uncertain }`: a proposed `people` block ([config.md](./config.md#people)) of people with more than one account (`--all`: everyone) and the matches to check by hand (grouped by name only; a name shared inside one workspace; one email on two users of a workspace). Never writes config; `--out` writes the same JSON (UTF-8) to a file and refuses `jeeves-scripts.json`. |
| `run email-apply-labels [--since <date>] [--account <id>] [--max <n>] [--dry-run] [--config <file>]` | Runnable `email-apply-labels` (no manifest). Enqueue the classification labels stored thread state calls for but that were never applied (e.g. while the account was report-only); `drain-updates` applies them. Idempotent. Skips report-only accounts; refuses when every target account is report-only, unless `--dry-run`. See [email.md](./email.md#label-catch-up). |

Domain work is never a CLI verb (Decision 49): it is a runnable, run with `run <id>`, like the last two rows. The CLI's own verbs are `run`, `list`, `config check|set|unset`, `doctor`, `init` and `skills`.

`main()` resolves to the exit code and never calls `process.exit` itself. A verb that fails (an unknown id, a plugin that fails to load, an invalid manifest or delta) prints one line, `<verb>: FAILED: <reason>`, to stderr, with no stack trace, and resolves to 1. Commander's own parse errors (an unknown verb or option, a missing argument) print Commander's message and exit 1 through Commander.

## How `run` resolves a runnable

Before resolving, `run` registers the instance root with the config loader (`JEEVES_SCRIPTS_CONFIG` if set, else `{root}/jeeves-scripts.json`, the pointer or a legacy config; [config.md](./config.md#where-the-file-is)) and loads the instance plugin, `{root}/jeeves-scripts.plugin.ts`, in its own process with tsx ([runnables](./runnables.md#instance-runnables-and-overrides)). Then:

1. **A plugin override** for `<id>` runs instead of core's runnable.
2. Else **a core id** runs core's runnable, its module loaded through the registry.
3. Else **a plugin runnable** id runs the instance runnable.
4. Else `run` fails: unknown id.

Every runnable runs in the CLI's process ([`defineRunnable`](./runnables.md#declaring-a-runnable): `process.argv` is `[node, <id>, ...args]`, a crash exits 1 through `runScript`). `run` resolves when the body has finished. A plugin that fails to load, or breaks a registration rule (a core id or core domain reused, an override of an unknown id), fails `run` before anything runs.

`run` never adds a manifest's `args`: a registered runner job's args are `["run", <id>, ...effective manifest args]`, so a person typing `run <id>` gets exactly what was typed.

The runnable gets everything after the id as `ctx.args`, and its declared flags parsed as `ctx.flags`. When it declares `flags`, `run` first rejects any option it does not declare (exit 1, `Unknown option <flag> for <id> (see run <id> --help)`), before the body runs; when it declares none, the arguments pass unchecked with a deprecation warning, until a later minor release makes the check apply to every runnable. `run <id> --help` (or `-h`) prints the usage, description, declared flags and effective manifest, and exits 0 without running the body. Every runnable follows one convention: bare boolean flags (`--live`, `--dry-run`), valued options as `--name value` or `--name=value`, and positionals; for example `run jira-backfill --project=ACME --live` ([runnables](./runnables.md#arguments)).

Running a core module by path (`node dist/<domain>/<module>.js`) runs nothing: runnable modules only declare themselves.

## Listing runnables

`jeeves-scripts list [glob] [--json]` lists every registered runnable, core and instance, whose id matches `glob` (shell-style `*`, `?` and `[...]` against the id; default `*`), sorted by id, which sorts by domain:

| Column | Content |
| --- | --- |
| `id` | The runnable id |
| `source` | `core`, `instance`, or `override` (a plugin override of a core id) |
| `schedule` | The effective schedule after instance deltas, as the runner stores it (a cron string as written, an RRStack object as compact JSON), when it has a manifest; blank otherwise |
| `enabled` | The effective `enabled` after deltas, when it has a manifest; blank otherwise |
| `description` | The manifest's `description`, else the `defineRunnable` one |

`--json` prints an array with one object per runnable: the same fields (`schedule` and `enabled` are `null` without a manifest) plus `domain` and `manifest` (the effective manifest after deltas, or `null`). `schedule` is as written: a string (cron, or RRStack JSON) or an RRStack object ([runnables](./runnables.md#manifests)); the runner job's `schedule` is the string, or the object's JSON. A manifest without `timeout_seconds` registers a job with no timeout. `on_failure: null` clears a job's failure-alert target; a manifest without the key leaves an existing job's target unchanged ([runnables](./runnables.md#manifests)). jeeves-tools registers runner jobs from it: every entry with a manifest whose `prerequisite` is `null`. `list` reads the instance config (for deltas), loads the plugin, reads core's and the instance's manifests, and imports the modules of runnables without a manifest to read their descriptions.

## Init

`jeeves-scripts init [--name <pkg>] [--core <version>]` writes a new instance repo into the root (the working directory for `npx`):

```bash
mkdir jeeves-scripts && cd jeeves-scripts
npx @karmaniverous/jeeves-scripts-core init
npm install
node bin/jeeves-scripts.js config check
node bin/jeeves-scripts.js doctor
```

- It copies the template bundled in the package (`template/`, fewer than 15 files: the launcher, the plugin with the sample runnable `example-say-hello` and its manifest and test, one-line tool configs extending core's presets, and a README).
- It writes the config outside the repo: `<--config-dir>/config.json` from the template's sample config (`config.sample.json`, not copied into the repo), and the repo's `jeeves-scripts.json` as a pointer to that directory ([config.md](./config.md#where-the-file-is)). `--config-dir` is required; a relative path resolves against the working directory.
- It **never overwrites** a file, the config and the pointer included: every file that exists is reported as skipped, so running it again in a repo changes nothing.
- `gitignore`, `npmrc` and `nvmrc` are stored renamed in the package (npm would drop or rename them) and written as `.gitignore`, `.npmrc` and `.nvmrc`.
- `package.json` gets the package name (`--name`, default the name of the folder it writes into, which must then be a valid npm package name) and core pinned at an exact version (`--core`, default the running core's version); a range such as `^0.1.0` is refused.
- At the end, when `openclaw` is on the host, it runs `skills install` (which shows the change and asks); otherwise it prints the command to run later.

## Skills

Core ships its skills in the package (`skills/<name>/SKILL.md`); they are wired into OpenClaw, never copied. Each declares `JEEVES_SCRIPTS_DIR` (`metadata.openclaw.requires.env`) and names every file as a `$JEEVES_SCRIPTS_DIR/...` path, such as `$JEEVES_SCRIPTS_DIR/node_modules/@karmaniverous/jeeves-scripts-core/guides/email.md`.

| Command | What it changes in OpenClaw's config |
| --- | --- |
| `skills install` | Adds `<repo>/node_modules/@karmaniverous/jeeves-scripts-core/skills` to `skills.load.extraDirs` (exact match, so running it again changes nothing) and sets `skills.entries.<skill>.env.JEEVES_SCRIPTS_DIR` to the repo root for each shipped skill. |
| `skills uninstall` | Removes exactly those entries: this repo's folder from `extraDirs`, and each `JEEVES_SCRIPTS_DIR` that names this repo, plus any object that removing them would leave empty (`skills.load`, a skill's `env` or entry, `skills.entries`). |
| `skills status` | Changes nothing. Reports the folder and each skill as `wired`, `missing` or `stale` (another core skills folder in `extraDirs`, or `JEEVES_SCRIPTS_DIR` naming another repo), and a core skill shadowed by a same-named skill from another source (such as the workspace). |

`install` and `uninstall` print the change and ask `Apply? [y/N]`; `--yes` applies without asking. Without a terminal to ask on (a script, a runner job), they apply nothing and print the command to re-run with `--yes`. Changes go through `openclaw config get`, `openclaw config set --batch-file` (one atomic batch) and `openclaw config unset`, so OpenClaw validates its own config.

## Doctor

`jeeves-scripts doctor` prints one report and always exits 0; a problem is a line, never a failure:

| Line | Content |
| --- | --- |
| `core:` | The installed core version |
| `config:` | The config file location and `OK` or `FAILED`, with one indented line per problem (as `config check`) |
| `plugin:` | `jeeves-scripts.plugin.ts` with its runnable and override counts, `none`, or `FAILED` with the load or registration error |
| `manifests:` | A count of met, not met and manual prerequisites, then every effective manifest (core's and the instance's, deltas applied): enabled or disabled, and its prerequisite state: `met` or `not met: <reason>` from the runnable's `defineRunnable` prerequisite check when it has one; else `met` when the manifest's `prerequisite` is `null` (deploy registers it), or `manual: <text>` |
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

## Programmatic use

The CLI is also importable from `@karmaniverous/jeeves-scripts-core/cli`: `main({ root?, argv? })` runs it and resolves the exit code (the launcher calls it), and `buildProgram({ root })` returns the Commander program without parsing, for tests and wrappers. It is outside the root export (and the TypeDoc API reference, which covers the root export); `src/cli/index.ts` documents both.

## Key files

| File | Purpose |
| --- | --- |
| `src/cli/index.ts` | `main`, `buildProgram`, `resolveRoot`, the `config` command |
| `src/cli/list.ts` | `listRunnables`, `formatList` |
| `src/cli/doctor.ts` | `doctorReport` |
| `src/cli/init.ts` | `initRepo`, `formatInit` |
| `src/cli/skills.ts` | `skills install \| uninstall \| status`: the status report, the confirmation, applying a change |
| `src/cli/skills-change.ts` | What `skills install` and `skills uninstall` change (OpenClaw's `skills` block, the sets and unsets) |
| `src/cli/hand-off.ts` | The global hand-off: `--dir`, `JEEVES_SCRIPTS_DIR`, walk-up, delegation to the repo's launcher |
| `src/cli/openclaw.ts` | The `openclaw` CLI calls (config get, batch set, unset, skills list) |
| `src/cli/package-info.ts` | The running core's package directory and version |
| `src/cli/load-plugin.ts` | `loadPlugin`: imports `jeeves-scripts.plugin.ts` with tsx |
| `src/cli/run.ts` | `registerInstance`, `resolveRunnable`, `runJob` |
| `src/runnables/` | `defineRunnable`, the runnable registry and manifests ([runnables](./runnables.md)) |
| `src/cli/bin.ts` | Package `bin`: the global hand-off |
