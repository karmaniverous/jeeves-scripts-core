/**
 * @module .release-it
 * release-it configuration for `@karmaniverous/jeeves-scripts-core`
 * (design §10, Decision 47): `npm run release` runs release-it from this
 * package. TypeScript per Decision 52; release-it loads it through c12.
 *
 * git-cliff runs before the release tag exists, so both the changelog and the
 * GitHub release notes pass `--tag core/${version}`: without it git-cliff
 * files the release's own commits under `[unreleased]`.
 */

import type { Config } from 'release-it';

const config: Config = {
  git: {
    changelog: 'npx git-cliff --unreleased --strip header',
    commitMessage:
      'chore: release @karmaniverous/jeeves-scripts-core v${version}',
    tagName: 'core/${version}',
    requireBranch: 'main',
  },
  github: {
    release: true,
    releaseNotes: 'npx git-cliff --tag core/${version} --latest --strip header',
  },
  hooks: {
    'after:init': [
      'npm run lint',
      'npm run typecheck',
      'npm run test',
      'npm run build',
    ],
    'after:bump': ['npm install --package-lock-only --ignore-scripts'],
    'before:npm:release': [
      'npx git-cliff --tag core/${version} -o CHANGELOG.md',
      'git add -A',
    ],
    'after:release': [
      'git switch -c release/core/${version}',
      'git push -u origin release/core/${version}',
      'git switch ${branchName}',
    ],
  },
  npm: {
    publish: true,
  },
};

export default config;
