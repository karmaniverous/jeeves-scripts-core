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
| `run people-propose [--all] [--out <file>]` | Runnable `people-propose` (no manifest). Read-only: reads `users.list` for every gateway Slack bot account (`slackBotTokens`), skips bots, deactivated users and Slackbot, groups users across workspaces by email (case-insensitive) and real name, and prints `{ summary, people, uncertain }`: a proposed `people` block ([config.md](./config.md#people)) of people with more than one account (`--all`: everyone) and the matches to check by hand (grouped by name only; a name shared inside one workspace; one email on two users of a workspace). Never writes config; `--out` writes the same JSON (UTF-8) to a file and refuses `jeeves-scripts.json`. |
| `run email-apply-labels [--since <date>] [--account <id>] [--max <n>] [--dry-run] [--config <file>]` | Runnable `email-apply-labels` (no manifest). Enqueue the classification labels stored thread state calls for but that were never applied (e.g. while `emailConfig.reportOnly` was on); `drain-updates` applies them. Idempotent. Refuses while `reportOnly` is on unless `--dry-run`. See [email.md](./email.md#label-catch-up). |

Domain work is never a CLI verb (Decision 49): it is a runnable, run with `run <id>`, like the last two rows. The CLI's own verbs are `run` and `config check`.

`main()` resolves to the exit code and never calls `process.exit` itself.

## How `run` resolves a job

Core's jobs are registered by id ([jobs](./jobs.md)); an instance declares its own jobs in `{root}/jobs/*.json` (arrays of runner job objects with `id` and `script`; other runner fields pass through) until plugins land (Dev Plan 33 phase 2).

1. **A core job id** runs core's job, always: its module is loaded through the registry and runs in the CLI's process ([`defineJob`](./jobs.md#declaring-a-job): `process.argv` is `[node, <id>, ...args]`, a crash exits 1 through `runScript`). `run` resolves when the job body has finished; a job that sets `process.exitCode` sets the CLI's exit code.
2. **An instance file never replaces a core job.** If the instance's `jobs/*.json` reuses a core id and the instance repo has a file at that entry's `script` path, `run` fails and says so. Instances change core jobs through `jobs.<id>` deltas in `jeeves-scripts.json` or (phase 2) a declared override (Decisions 6, 27).
3. **An instance-declared id** (not a core id) runs the instance file at its `script` path (e.g. `src/acme/daily-briefing.ts`) in a child process (`node --import tsx <file> [args...]`, working directory = the instance root). The exit code is the child's.
4. **An instance-declared id with no instance file** whose `script` names a core module (`src/email/poll.ts`) runs that core job (`email-poll`): a transitional alias for runner job ids that differ from core's.
5. Otherwise `run` fails: an unknown id, or an instance job whose script exists nowhere.

Running a core module by path (`node dist/<domain>/<job>.js`) runs nothing: job modules only declare their job.

Before running anything, `run` sets `JEEVES_SCRIPTS_CONFIG` to `{root}/jeeves-scripts.json` unless it is already set, so core jobs and instance scripts read the instance's config.

A malformed `jobs/*.json` entry (missing `id` or `script`, or not an object) fails `run` with the file name and the entry's position, instead of being skipped.

## Examples

```bash
node bin/jeeves-scripts.js config check
node bin/jeeves-scripts.js config check --config ./test/fixture.json
node bin/jeeves-scripts.js run meetings-fetch-notes --dry-run
node bin/jeeves-scripts.js run email-apply-labels --dry-run --since 2026-10-01
JEEVES_SCRIPTS_CONFIG=/tmp/alt.json node bin/jeeves-scripts.js run admin-refresh-token-rates
```

## Key files

| File | Purpose |
| --- | --- |
| `src/cli/index.ts` | `main`, `buildProgram`, `resolveRoot`, the `config` command |
| `src/cli/run.ts` | `readJobs`, `resolveJob`, `runJob` |
| `src/jobs/` | `defineJob`, the job registry and manifests ([jobs](./jobs.md)) |
| `src/cli/bin.ts` | Package `bin`: runs `main` with the working directory as root |
