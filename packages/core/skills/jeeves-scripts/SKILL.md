---
name: jeeves-scripts
description: The jeeves-scripts instance repo and @karmaniverous/jeeves-scripts-core - running runnables and jobs with the launcher, jeeves-scripts.json, jobs/*.json, instance code, and where the core docs live. Use when running, adding or debugging a scripts job, editing jeeves-scripts.json, or looking up how a core domain behaves.
metadata: { "openclaw": { "requires": { "env": ["JEEVES_SCRIPTS_DIR"] } } }
---

# Jeeves Scripts

The scripts repo (`$JEEVES_SCRIPTS_DIR`) is a thin instance repo. The shared behaviour (every domain: email, Slack, calendar, GitHub, Jira, Linear, X, meetings, token metrics, dispatchers) is `@karmaniverous/jeeves-scripts-core`, pinned at an exact version in the repo's `package.json`. This skill ships in that package, so its links point at the docs for the installed version.

## What lives where

- **Core (the package):** domain code, the `jeeves-scripts` CLI, the config schema, and the docs: [README]($JEEVES_SCRIPTS_DIR/node_modules/@karmaniverous/jeeves-scripts-core/README.md), [guides/]($JEEVES_SCRIPTS_DIR/node_modules/@karmaniverous/jeeves-scripts-core/guides/cli.md) (one per domain, plus runbooks such as [token metrics]($JEEVES_SCRIPTS_DIR/node_modules/@karmaniverous/jeeves-scripts-core/guides/token-metrics-runbook.md)).
- **`jeeves-scripts.json`:** every setting of this instance, and nothing else (see [config.md]($JEEVES_SCRIPTS_DIR/node_modules/@karmaniverous/jeeves-scripts-core/guides/config.md)). State goes to the runner store or the state folder, secrets to the credentials folder; another component's settings are read from that component's own config, never copied here.
- **`jobs/*.json`:** this instance's own manifests (schedules for its own runnables, or for a core runnable that ships without one), in core's format. Core's runnables are registered in core with their manifests; the instance adjusts them with `jobs.<id>` deltas in `jeeves-scripts.json` and never redeclares them. To send one job's failure alerts somewhere other than the runner's default, set `on_failure` (a Slack channel, DM or user id) in its manifest or delta; `null` in a delta restores the default.
- **`src/` + `jeeves-scripts.plugin.ts`:** instance-only code: the plugin registers the instance's runnables, its declared overrides of core runnables and the schema of its `local` config block ([runnables.md]($JEEVES_SCRIPTS_DIR/node_modules/@karmaniverous/jeeves-scripts-core/guides/runnables.md#instance-runnables-and-overrides)). Shared behaviour belongs in core, not here. `jeeves-scripts list` shows what is registered.
- **Who someone is** comes from `people` in `jeeves-scripts.json` ([config.md]($JEEVES_SCRIPTS_DIR/node_modules/@karmaniverous/jeeves-scripts-core/guides/config.md#people)); draft it with `run people-propose`.

## Running runnables

A runnable is anything `run <id>` starts; a job is a runnable registered in jeeves-runner (it has a manifest). Manifests, `jobs.<id>` deltas and runner job ids keep the word "job".

Every runner job runs the launcher, so it always uses the pinned core:

```bash
node "$JEEVES_SCRIPTS_DIR/bin/jeeves-scripts.js" run <id> [args...]
node "$JEEVES_SCRIPTS_DIR/bin/jeeves-scripts.js" config check
```

Runnables declare their flags: `run <id> --help` prints a runnable's usage, flags and effective manifest without running it. An undeclared option exits 1 (`Unknown option <flag> for <id>`) before anything runs; runnables that declare no flags only warn, for now.

How `run` resolves an id and every other command: [cli.md]($JEEVES_SCRIPTS_DIR/node_modules/@karmaniverous/jeeves-scripts-core/guides/cli.md).

## Core package rules

What goes into core, and how (for changes to `@karmaniverous/jeeves-scripts-core` itself):

- **Prove it in an instance, then hoist it.** Core holds behaviour any instance may use, and a feature enters core only after it has run on an instance. Build it in the instance's `src/` first; once it works on real data, hoist it.
- **A hoisted feature is generic and opt-in:** no instance names, ids, hosts, channels, paths or people in its code, docs, tests or manifests. It does nothing until the instance configures it (an unconfigured runnable logs one skip line and exits 0), and its manifests ship disabled.
- **One-off migrations never ship in core.** A cutover or remediation of one instance's history is a dry-run script in that instance's project archive.
- **Patching OpenClaw's files is not core's job.** Anything that edits OpenClaw's own files belongs in `jeeves install` / `jeeves update` (the `jeeves` package), not in a runnable.
- **Neutral fixtures.** Tests and examples use invented names, never a real client, instance or person.
- **Docs:** TypeDoc runs from the repo root only. Authored docs live in `packages/<pkg>/guides/` and ship with the package: a domain's docs are `guides/<domain>.md`, never `src/<domain>/README.md`.

## Operator rules

- **Run `config check` after every edit** to `jeeves-scripts.json`; it must pass before anything runs.
- **Never put a secret in `jeeves-scripts.json`** or commit one; the config's secret guard rejects them.
- **Fix shared behaviour in core** (branch, PR, release, bump the pin), never by editing `node_modules` or copying core code into `src/`.
- **Per-instance values are the operator's call:** accounts, channels, schedules. Ask; don't copy another instance's values.
- **The docs for the installed core** are under `$JEEVES_SCRIPTS_DIR/node_modules/@karmaniverous/jeeves-scripts-core/guides/`, one per domain.
- **`JEEVES_SCRIPTS_DIR`** is set for these skills by `jeeves-scripts skills install`. If it is empty or wrong, run `node <repo>/bin/jeeves-scripts.js skills status` (from the instance repo) and tell the operator.

## Domain skills

`jeeves-email`, `jeeves-slack`, `jeeves-calendar`, `jeeves-github`, `jeeves-jira`, `jeeves-linear`, `jeeves-x`, `jeeves-token-metrics`, `jeeves-daily-briefings`, `jeeves-standing-meetings`, `jeeves-dates`, `channel-status-recap`.
