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
| `jobs/<domain>.json` | Core's job manifests, keyed by job id ([`guides/jobs.md`](guides/jobs.md)). |
| `presets/`, `dist/presets/` | The presets an instance repo's one-line tool configs extend: TypeScript (`presets/tsconfig.base.json`, JSON because TypeScript reads only JSON tsconfigs) and the ESLint and Vitest presets, authored in TypeScript and shipped compiled with their types (`dist/presets/eslint.js`, `dist/presets/vitest.js`). All three are imported as `@karmaniverous/jeeves-scripts-core/presets/<file>` (`eslint.js`, `vitest.js`, `tsconfig.base.json`). |
| `template/` | The instance repo `jeeves-scripts init` writes ([`guides/cli.md`](guides/cli.md#init)). |
| `CHANGELOG.md` | Release notes. |
| `dist/**/*.d.ts` | TSDoc for every module, next to its type declarations. |

To locate the package root from code or a shell without assuming a layout:

```bash
node -p "path.dirname(require.resolve('@karmaniverous/jeeves-scripts-core/package.json'))"
```

The `exports` map publishes `./package.json`, `./guides/*`, `./skills/*`, `./schema/*`, `./config/*` and `./presets/*` (with `./presets/*.js` mapped to the compiled presets in `dist/presets/`), so `require.resolve('@karmaniverous/jeeves-scripts-core/guides/<domain>.md')` (or `import.meta.resolve`) returns a doc's absolute path from anywhere in the instance repo. `test/package-docs.test.ts` keeps this true: every doc and guide ships, resolves, and is indexed below.

Job ids named in the docs are core's registered ids ([`guides/jobs.md`](guides/jobs.md)): `jeeves-scripts run <id>` runs any of them. Scheduled jobs have a manifest in core (`jobs/<domain>.json`); an instance adjusts them with `jobs.<id>` deltas in `jeeves-scripts.json` and never copies them. `jeeves-scripts list` shows every registered runnable.

### Domain docs

| Doc | Domain |
| --- | --- |
| [`guides/cli.md`](guides/cli.md) | The `jeeves-scripts` CLI and the instance launcher |
| [`guides/config.md`](guides/config.md) | `jeeves-scripts.json`: schema, resolution, getters, silos |
| [`guides/jobs.md`](guides/jobs.md) | The runnable registry: ids, `defineJob`, manifests, instance deltas, the instance plugin |
| [`guides/lib.md`](guides/lib.md) | Shared infrastructure: constants, gateway, workers, gh, gog, entity store |
| [`guides/admin.md`](guides/admin.md) | Token metrics, rate card, session refresh, housekeeping (`.tmp` sweep, Qdrant health) |
| [`guides/calendar.md`](guides/calendar.md) | Google Calendar polling |
| [`guides/convert.md`](guides/convert.md) | DOCX and PDF to Markdown |
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

Core ships its own OpenClaw skills, one per domain or pattern whose behaviour lives here, plus `jeeves-scripts` for the package as a whole: `jeeves-scripts`, `jeeves-email`, `jeeves-slack`, `jeeves-calendar`, `jeeves-github`, `jeeves-jira`, `jeeves-linear`, `jeeves-x`, `jeeves-token-metrics`, `jeeves-daily-briefings`, `jeeves-standing-meetings`, and `jeeves-dates` (core's date utilities; never state a weekday without computing it). They are thin (when to use, operator rules), declare `JEEVES_SCRIPTS_DIR` (the scripts repo root) in their frontmatter, and name the docs above as `$JEEVES_SCRIPTS_DIR/node_modules/@karmaniverous/jeeves-scripts-core/guides/<domain>.md`, so a skill always matches the installed core version. `jeeves-scripts skills install` wires them in: it lists the installed package's `skills/` directory in OpenClaw's `skills.load.extraDirs` and sets `JEEVES_SCRIPTS_DIR` for each skill ([cli.md](guides/cli.md#skills)). `test/skills.test.ts` checks every shipped skill: frontmatter and the `JEEVES_SCRIPTS_DIR` declaration, size, no instance paths, and package paths that exist.

## Install

```bash
npm install --save-exact @karmaniverous/jeeves-scripts-core
```

Node `>=22.13`. Instances pin an exact version; upgrading core is a commit to the instance repo's `package.json`.

To start a new instance repo:

```bash
mkdir jeeves-scripts && cd jeeves-scripts
npx @karmaniverous/jeeves-scripts-core init --name acme-scripts
npm install
node bin/jeeves-scripts.js doctor
```

`init` never overwrites a file, and wires core's skills into OpenClaw when it is on the host ([`guides/cli.md`](guides/cli.md#init)). Installed globally (`npm install -g @karmaniverous/jeeves-scripts-core`), `jeeves-scripts` only hands off to a repo's launcher ([`guides/cli.md`](guides/cli.md#the-global-hand-off)).

## Running jobs

The instance repo carries a launcher, `bin/jeeves-scripts.js`:

```js
import { main } from '@karmaniverous/jeeves-scripts-core/cli';
process.exitCode = await main({ root: new URL('..', import.meta.url) });
```

Runner jobs execute it with `node`, so the CLI never needs to be on `PATH` and the job always runs the core version pinned in that repo:

```bash
node <scriptsDir>/bin/jeeves-scripts.js run <id> [args...]
node <scriptsDir>/bin/jeeves-scripts.js list [glob] [--json]
node <scriptsDir>/bin/jeeves-scripts.js config check
node <scriptsDir>/bin/jeeves-scripts.js doctor
```

See [`guides/cli.md`](guides/cli.md) for every command and how `run` resolves an id. An instance adds its own runnables, overrides of core runnables and the schema of its own `local` config block in `{root}/jeeves-scripts.plugin.ts`, which the CLI loads with tsx ([`guides/jobs.md`](guides/jobs.md#instance-runnables-and-overrides)).

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
| `@karmaniverous/jeeves-scripts-core` | The config API (schemas, loader, getters `paths()`, `integrations()`, `pipeline()`, refs, silo resolver and routing, `configCheck`); `constants()`; `defineJob`; the plugin API (`definePlugin`, `override`, `localConfig`); the utilities: the task-file dispatcher (`taskFileDispatcher`, `dispatchTaskFile`, `resolveTaskFile`) with `digestTimeZone` and the date helpers (`withDateContext`, `requireTimeZone`, `dayOfWeek`, `formatDate`, `relativeDays`), `dispatchWithSlack` and the worker-slack config schemas, the readers for other components' config (OpenClaw, jeeves-runner, jeeves-meta, any `jeeves-<name>`), the `gh` helpers, `getTokenMetrics`, and `convertDocxToMd` / `convertPdfToMd` (also the runnables `convert-docx-to-md`, `convert-pdf-to-md`). |
| `@karmaniverous/jeeves-scripts-core/cli` | `main`, `buildProgram`: the CLI the launcher runs. |

No other module is exported: instance code imports only these (Decision 7). A core function instance code needs is added to the root export, with docs and tests.

API reference (TypeDoc): <https://docs.karmanivero.us/jeeves-scripts-core>.

## License

BSD-3-Clause. See [LICENSE](LICENSE).
