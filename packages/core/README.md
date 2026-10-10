# @karmaniverous/jeeves-scripts-core

Shared Jeeves scripts domains, configuration and the `jeeves-scripts` CLI for `jeeves-scripts` instance repos. An instance repo depends on this package at an exact version, keeps its settings in one `jeeves-scripts.json`, and runs every job through a two-line launcher.

## Where the documentation lives

Everything below ships in the npm package. From an instance repo, the package root is `node_modules/@karmaniverous/jeeves-scripts-core/` (on a jeeves-tools-managed instance: `{scriptsDir}/node_modules/@karmaniverous/jeeves-scripts-core/`). Skills and the watcher should point there, so they always read the docs for the core version the instance has installed.

| Path in the package | What it is |
| --- | --- |
| `README.md` | This file: overview, CLI, config, docs index. |
| `guides/<domain>.md` | One hand-written reference per domain (table below), plus design records and runbooks. TypeDoc renders them with the API reference; its output goes to the repo's root `docs/`, which is never shipped or authored. |
| `skills/<name>/SKILL.md` | The assistant skills core ships ([Skills](#skills)). |
| `schema/jeeves-scripts.schema.json` | JSON Schema for `jeeves-scripts.json`, generated from the Zod config schema. |
| `config/token-rates.seed.json` | The token rate card seed (`constants().TOKEN_RATES_SEED_PATH`). |
| `CHANGELOG.md` | Release notes. |
| `dist/**/*.d.ts` | TSDoc for every module, next to its type declarations. |

To locate the package root from code or a shell without assuming a layout:

```bash
node -p "path.dirname(require.resolve('@karmaniverous/jeeves-scripts-core/package.json'))"
```

The `exports` map publishes `./package.json`, `./guides/*`, `./skills/*`, `./schema/*` and `./config/*`, so `require.resolve('@karmaniverous/jeeves-scripts-core/guides/<domain>.md')` (or `import.meta.resolve`) returns a doc's absolute path from anywhere in the instance repo. `test/package-docs.test.ts` keeps this true: every doc and guide ships, resolves, and is indexed below.

Job ids and schedules named in the docs are the template's manifest entries. Until the job registry ships them in core (Decision 32), each instance carries them in its own `jobs/*.json`; a module without a manifest entry (backfills, migrations, event-gateway drains) needs one before `run` can start it.

### Domain docs

| Doc | Domain |
| --- | --- |
| [`guides/cli.md`](guides/cli.md) | The `jeeves-scripts` CLI and the instance launcher |
| [`guides/config.md`](guides/config.md) | `jeeves-scripts.json`: schema, resolution, getters, silos |
| [`guides/lib.md`](guides/lib.md) | Shared infrastructure: constants, gateway, workers, gh, gog, entity store |
| [`guides/admin.md`](guides/admin.md) | Token metrics, rate card, session refresh, OpenClaw patches |
| [`guides/calendar.md`](guides/calendar.md) | Google Calendar polling |
| [`guides/convert.md`](guides/convert.md) | DOCX and PDF to Markdown |
| [`guides/core.md`](guides/core.md) | Housekeeping: `.tmp` sweep, Qdrant health |
| [`guides/dispatchers.md`](guides/dispatchers.md) | Task-file dispatchers and job-side Slack I/O |
| [`guides/email.md`](guides/email.md) | Gmail (gog) and IMAP polling, download, backfills |
| [`guides/github.md`](guides/github.md) | Repo and issue sync, notifications, collaborators |
| [`guides/google-drive.md`](guides/google-drive.md) | Drive sync into the content tree |
| [`guides/jira.md`](guides/jira.md) | Jira webhook drain, backfill, backlog sort |
| [`guides/linear.md`](guides/linear.md) | Linear webhook drain, sync, backfill |
| [`guides/meetings.md`](guides/meetings.md) | Meeting extraction (Meet, Fathom, Notion) |
| [`guides/meta.md`](guides/meta.md) | Entity lifecycle maintenance |
| [`guides/slack.md`](guides/slack.md) | Slack polling and archiving |
| [`guides/x.md`](guides/x.md) | X/Twitter polling, posting, engagement |

Guides: [`guides/google-drive-spec.md`](guides/google-drive-spec.md) (Drive sync design record), [`guides/token-metrics-runbook.md`](guides/token-metrics-runbook.md) (token metrics operations).

## Skills

Core ships its own OpenClaw skills, one per domain or pattern whose behaviour lives here, plus `jeeves-scripts` for the package as a whole: `jeeves-scripts`, `jeeves-email`, `jeeves-slack`, `jeeves-calendar`, `jeeves-github`, `jeeves-jira`, `jeeves-linear`, `jeeves-x`, `jeeves-token-metrics`, `jeeves-daily-briefings`, `jeeves-standing-meetings`, and `jeeves-dates` (core's date utilities; never state a weekday without computing it). They are thin (when to use, operator rules) and link to the docs above by package-relative paths, so a skill always matches the installed core version. The gateway loads them by listing the installed package's `skills/` directory in OpenClaw's `skills.load.extraDirs`. `test/skills.test.ts` checks every shipped skill: frontmatter, size, no instance paths, links that resolve inside the package.

## Install

```bash
npm install --save-exact @karmaniverous/jeeves-scripts-core
```

Node `>=22.13`. Instances pin an exact version; upgrading core is a commit to the instance repo's `package.json`.

## Running jobs

The instance repo carries a launcher, `bin/jeeves-scripts.js`:

```js
import { main } from '@karmaniverous/jeeves-scripts-core/cli';
process.exitCode = await main({ root: new URL('..', import.meta.url) });
```

Runner jobs execute it with `node`, so the CLI never needs to be on `PATH` and the job always runs the core version pinned in that repo:

```bash
node <scriptsDir>/bin/jeeves-scripts.js run <job-id> [args...]
node <scriptsDir>/bin/jeeves-scripts.js config check
```

See [`guides/cli.md`](guides/cli.md) for every command and how `run` resolves a job id.

## Configuration

One file, `{root}/jeeves-scripts.json`, holds every setting; it never holds a secret value. Point its `$schema` at the shipped schema for editor completion:

```json
{
  "$schema": "./node_modules/@karmaniverous/jeeves-scripts-core/schema/jeeves-scripts.schema.json",
  "instance": { "name": "my-instance", "baseDir": "/opt/jeeves" }
}
```

See [`guides/config.md`](guides/config.md).

## Public API

| Import | What it is |
| --- | --- |
| `@karmaniverous/jeeves-scripts-core` | The config API (schemas, loader, getters `paths()`, `integrations()`, `pipeline()`, refs, silo resolver and routing, `configCheck`); the task-file dispatcher (`taskFileDispatcher`, `dispatchTaskFile`, `resolveTaskFile`); the OpenClaw config reader (`gatewayToken`, `slackBotToken`, `slackBotTokens`); the worker-slack config schemas and types. |
| `@karmaniverous/jeeves-scripts-core/cli` | `main`, `buildProgram`: the CLI the launcher runs. |
| `@karmaniverous/jeeves-scripts-core/<domain>/<module>` | Any built module, e.g. `lib/constants`, `lib/worker-slack/run`, `dispatchers/lib/task-file-dispatcher`. |

API reference (TypeDoc): <https://docs.karmanivero.us/jeeves-scripts-core>.

## License

BSD-3-Clause. See [LICENSE](LICENSE).
