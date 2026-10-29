# Jeeves scripts instance repo

This repo is one Jeeves instance's scripts: its configuration, its declared overrides of core runnables and its own runnables. The shared behaviour (every domain, the `jeeves-scripts` CLI, the config schema) is [`@karmaniverous/jeeves-scripts-core`](https://www.npmjs.com/package/@karmaniverous/jeeves-scripts-core), pinned at an exact version in `package.json`.

## What lives where

| Path | Holds |
| --- | --- |
| `bin/jeeves-scripts.js` | The launcher. Runner jobs and webhooks run `node <this repo>/bin/jeeves-scripts.js run <id>`. |
| `jeeves-scripts.json` | Every setting of this instance (no secrets), validated against core's schema. |
| `jeeves-scripts.plugin.ts` | The plugin: this instance's runnables, its declared overrides of core runnables, and the schema of its `local` config block. |
| `jobs/*.json` | Manifests (schedules) for this instance's runnables, in core's format. |
| `src/` | This instance's code, on core's public API only, with tests. `src/example/say-hello.ts` is a sample: replace it. |

## Commands

```bash
npm install
npm run check      # config check: validate jeeves-scripts.json
npm run doctor     # core version, config, plugin, prerequisites, override drift
node bin/jeeves-scripts.js list
node bin/jeeves-scripts.js run example-say-hello Jane
npm run lint && npm run typecheck && npm test   # npm test also writes coverage/ (git- and typecheck-ignored)
```

## Docs

Core's guides ship in the installed package, under `node_modules/@karmaniverous/jeeves-scripts-core/guides/`: start with `cli.md`, `config.md` and `runnables.md`. They are also published at <https://docs.karmanivero.us/jeeves-scripts-core>.

Fix shared behaviour in core (issue, PR, release, then bump the pin here), never by editing `node_modules` or copying core code into `src/`.
