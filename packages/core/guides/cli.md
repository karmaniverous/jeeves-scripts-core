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

Node resolves core from the launcher's own `node_modules`, so a job always runs the core version pinned in that repo. Runner jobs are registered as script `{scriptsDir}/bin/jeeves-scripts.js` with args `["run", "<job-id>", ...]`; jeeves-runner runs `.js` scripts with `node` on Windows and Linux.

The package `bin` (`npx jeeves-scripts ...`, from the instance repo) does the same with the working directory as the root.

## Commands

| Command | What it does |
| --- | --- |
| `run <job-id> [args...]` | Run a job by id (below). Options after the job id are passed to the job unchanged. |
| `config check [--config <file>]` | Validate `jeeves-scripts.json` against the schema and its silo references. Prints `config check: OK (<path>)`, or `config check: FAILED (<path>)` and one line per problem with exit code 1. |
| `people propose [--all] [--out <file>]` | Read-only: reads `users.list` for every gateway Slack bot account (`slackBotTokens`), skips bots, deactivated users and Slackbot, groups users across workspaces by email (case-insensitive) and real name, and prints `{ summary, people, uncertain }`: a proposed `people` block ([config.md](./config.md#people)) of people with more than one account (`--all`: everyone) and the matches to check by hand (grouped by name only; a name shared inside one workspace; one email on two users of a workspace). Never writes config; `--out` writes the same JSON (UTF-8) to a file and refuses `jeeves-scripts.json`. |
| `email apply-labels [--since <date>] [--account <id>] [--max <n>] [--dry-run] [--config <file>]` | Enqueue the classification labels stored thread state calls for but that were never applied (e.g. while `emailConfig.reportOnly` was on); `drain-updates` applies them. Idempotent. Refuses while `reportOnly` is on unless `--dry-run`. See [email.md](./email.md#label-catch-up). |

`main()` resolves to the exit code and never calls `process.exit` itself.

## How `run` resolves a job

Until the job registry lands, job ids come from the instance repo's `jobs/*.json` (arrays of runner job objects). `run` reads every `jobs/*.json` file, validates each entry (`id` and `script` strings; other runner fields pass through), and finds the entry whose `id` matches.

1. If the instance repo has a file at the job's `script` path (e.g. `src/acme/daily-briefing.ts`), that file runs in a child process (`node --import tsx <file> [args...]`, working directory = the instance root). The exit code is the child's.
2. Otherwise the same path is mapped into core's build: `src/<domain>/<name>.ts` â†’ `dist/<domain>/<name>.js`, and that module is imported in the CLI's process with `process.argv` set to `[node, <module>, ...args]`. The module's own `runScript()` sets `process.exitCode` on failure.
3. Neither exists: `run` fails, naming both paths.

Before running anything, `run` sets `JEEVES_SCRIPTS_CONFIG` to `{root}/jeeves-scripts.json` unless it is already set, so core modules and instance scripts read the instance's config.

A malformed `jobs/*.json` entry (missing `id` or `script`, or not an object) fails `run` with the file name and the entry's position, instead of being skipped.

## Examples

```bash
node bin/jeeves-scripts.js config check
node bin/jeeves-scripts.js config check --config ./test/fixture.json
node bin/jeeves-scripts.js run fetch-meeting-notes --dry-run
node bin/jeeves-scripts.js email apply-labels --dry-run --since 2026-10-01
JEEVES_SCRIPTS_CONFIG=/tmp/alt.json node bin/jeeves-scripts.js run refresh-token-rates
```

## Key files

| File | Purpose |
| --- | --- |
| `src/cli/index.ts` | `main`, `buildProgram`, `resolveRoot`, the `config` command |
| `src/cli/email.ts` | The `email` command (`apply-labels`) |
| `src/cli/run.ts` | `readJobs`, `resolveJob`, `runJob` |
| `src/cli/bin.ts` | Package `bin`: runs `main` with the working directory as root |
