# jeeves-scripts-core 🎩

[![license](https://img.shields.io/badge/license-BSD--3--Clause-blue.svg)](https://github.com/karmaniverous/jeeves-scripts-core/tree/main/LICENSE)

Shared scripts domains, job registry and CLI for `jeeves-scripts` instance
repos. Part of the Jeeves platform. See the [jeeves-scripts-core product
spec](https://github.com/karmaniverous/jeeves-scripts-core) (owner-held,
private planning doc) for the full design.

## Monorepo Structure

This repository is a private workspace root. It holds two packages:

| Package                                      | npm                                                                                              | Description                                                                 |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| [`packages/core`](packages/core)             | [`@karmaniverous/jeeves-scripts-core`](https://www.npmjs.com/package/@karmaniverous/jeeves-scripts-core) | Shared domains, job registry, config loader and the `jeeves-scripts` CLI (published, public npm) |
| [`packages/template`](packages/template)     | `jeeves-scripts-template` (private, never published alone)                                        | Bundled scaffold `jeeves-scripts init` writes into a new instance repo       |

`packages/core`'s build copies `packages/template` (without `node_modules`)
into `packages/core/template/`, which is listed in core's `files`. The
template is linted, type-checked and tested in its own workspace against the
core just built from source, exactly as an instance repo would consume it.

## Status

This repo currently holds only the repository tooling (lint, typecheck,
build, test, dead-code checks, docs, CI) and a minimal placeholder source
file per package. The shared domains are ported from
[`jeeves-scripts-template`](https://github.com/karmaniverous/jeeves-scripts-template)
in a later pass, one domain per commit.

## Development

```bash
npm install
npm run build        # builds packages/core, then copies packages/template into it
npm run lint
npm run typecheck
npm test
npm run knip
npm run docs
```

All gates run **per workspace** from the repo root (`npm run <script> --workspaces --if-present`),
and again from the same `cwd` each package's release process uses (`release-it`
`after:init` hooks), per the project's pre-PR checklist.

### Code Quality Standard

Every file in this repo — library code, CLI code, tests, and tool config
files alike (`eslint.config.ts`, `rollup.config.ts`, `knip.ts`,
`prettier.config.ts`, `tsconfig.json`) — is linted with strict, type-aware
`typescript-eslint` (`strictTypeChecked` + `stylisticTypeChecked`) and
type-checked with strict `tsc`. No file is excluded from type-aware linting
and `eslint-disable` is never used; if a rule can't be satisfied the code is
fixed instead.

### Held-back Dependencies

All dependencies are pinned at their latest version subject to peer
constraints. The following are held back from the newest release available
on npm at the time of writing, each for the peer constraint that holds it:

| Dependency   | Latest on npm | Pinned here | Held back by                                                                                     |
| ------------ | ------------- | ----------- | --------------------------------------------------------------------------------------------------- |
| `typescript` | `7.0.2`       | `^6.0.3`    | `typescript-eslint@8.71.1` requires `typescript: ">=4.8.4 <6.1.0"`; `typedoc@0.28.20` requires `typescript` up to `6.0.x`. |

No other dependency in this repo is held back from its latest npm release at
the time of writing.

## License

BSD-3-Clause. See [LICENSE](LICENSE).
