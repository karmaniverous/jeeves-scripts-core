---
name: jeeves-scripts
description: The jeeves-scripts instance repo and @karmaniverous/jeeves-scripts-core - running jobs with the launcher, jeeves-scripts.json, jobs/*.json, instance code, and where the core docs live. Use when running, adding or debugging a scripts job, editing jeeves-scripts.json, or looking up how a core domain behaves.
---

# Jeeves Scripts

The scripts repo (`{scriptsDir}`) is a thin instance repo. The shared behaviour (every domain: email, Slack, calendar, GitHub, Jira, Linear, X, meetings, token metrics, dispatchers) is `@karmaniverous/jeeves-scripts-core`, pinned at an exact version in the repo's `package.json`. This skill ships in that package, so its links point at the docs for the installed version.

## What lives where

- **Core (the package):** domain code, the `jeeves-scripts` CLI, the config schema, and the docs: [README](../../README.md), [docs/](../../docs/cli.md), [guides/](../../guides/token-metrics-runbook.md).
- **`jeeves-scripts.json`:** every setting of this instance, and nothing else (see [config.md](../../docs/config.md)). State goes to the runner store or the state folder, secrets to the credentials folder; another component's settings are read from that component's own config, never copied here.
- **`jobs/*.json`:** this instance's job manifest (ids, schedules, the module each job runs).
- **`src/` + `jeeves-scripts.plugin.ts`:** instance-only code. Shared behaviour belongs in core, not here.

## Running jobs

Every runner job runs the launcher, so it always uses the pinned core:

```bash
node {scriptsDir}/bin/jeeves-scripts.js run <job-id> [args...]
node {scriptsDir}/bin/jeeves-scripts.js config check
```

How `run` resolves an id and every other command: [cli.md](../../docs/cli.md).

## Operator rules

- **Run `config check` after every edit** to `jeeves-scripts.json`; it must pass before a job runs.
- **Never put a secret in `jeeves-scripts.json`** or commit one; the config's secret guard rejects them.
- **Fix shared behaviour in core** (branch, PR, release, bump the pin), never by editing `node_modules` or copying core code into `src/`.
- **Per-instance values are the operator's call:** accounts, channels, schedules. Ask; don't copy another instance's values.
- To read a doc from a shell: `node -p "require.resolve('@karmaniverous/jeeves-scripts-core/docs/<domain>.md')"` in `{scriptsDir}`.

## Domain skills

`jeeves-email`, `jeeves-slack`, `jeeves-calendar`, `jeeves-github`, `jeeves-jira`, `jeeves-linear`, `jeeves-x`, `jeeves-token-metrics`, `jeeves-daily-briefings`, `jeeves-standing-meetings`, `jeeves-dates`.
