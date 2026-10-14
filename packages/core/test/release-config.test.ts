/**
 * git-cliff runs during release-it before the release tag exists. Without
 * `--tag core/${version}` it files the release's own commits under
 * `[unreleased]`, in both CHANGELOG.md and the GitHub release notes. That
 * shipped in core/0.1.0; this guards against it coming back.
 *
 * The release notes must also use `--unreleased`, not `--latest`: release-it
 * renders them before the tag exists, when `--latest` returns the previous
 * release (karmaniverous/npm-package-template-ts#30).
 */
import { describe, expect, it } from 'vitest';

import config from '../.release-it';

const cliffCommands = (): string[] => {
  const hooks = Object.values(config.hooks ?? {}).flat();
  const notes = config.github?.releaseNotes;
  return [...hooks, ...(typeof notes === 'string' ? [notes] : [])].filter(
    (cmd): cmd is string =>
      typeof cmd === 'string' && cmd.includes('git-cliff'),
  );
};

describe('release config', () => {
  it('writes CHANGELOG.md for the version being released', () => {
    expect(config.hooks?.['before:npm:release']).toContain(
      'npx git-cliff --tag core/${version} -o CHANGELOG.md',
    );
  });

  it('builds the GitHub release notes from the version being released', () => {
    expect(config.github?.releaseNotes).toBe(
      'npx git-cliff --tag core/${version} --unreleased --strip header',
    );
  });

  it('titles the GitHub release <package>@<version>', () => {
    expect(config.github?.releaseName).toBe(
      "${name.split('/').pop()}@${version}",
    );
  });

  it('passes the release tag to every git-cliff command', () => {
    const commands = cliffCommands();
    expect(commands.length).toBeGreaterThanOrEqual(2);
    for (const cmd of commands) expect(cmd).toContain('--tag core/${version}');
  });
});
