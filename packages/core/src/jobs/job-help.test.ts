import { describe, expect, it } from 'vitest';

import { argFlag, argOptional, argValue } from '../lib/args.js';
import { defineJob } from './define-job.js';
import {
  argsError,
  flagsDeprecation,
  formatJobHelp,
  wantsHelp,
} from './job-help.js';

const job = defineJob({
  id: 'acme-report',
  domain: 'acme',
  description: 'Report on acme.',
  flags: {
    live: argFlag('--live', 'Write changes'),
    max: argValue('--max', '5', { alias: '-m', description: 'Items' }),
    since: argOptional('--since'),
  },
  positionals: '<handle>',
  run: () => undefined,
});

const loose = defineJob({
  id: 'acme-loose',
  domain: 'acme',
  run: () => undefined,
});

describe('wantsHelp', () => {
  it('spots --help and -h', () => {
    expect(wantsHelp(['--help'])).toBe(true);
    expect(wantsHelp(['x', '-h'])).toBe(true);
    expect(wantsHelp(['--live'])).toBe(false);
  });
});

describe('argsError', () => {
  it('accepts declared flags, aliases, both value forms and declared positionals', () => {
    expect(
      argsError(job, ['me', '--live', '-m', '3', '--since=2026-01-01']),
    ).toBeUndefined();
  });

  it('names the first undeclared option or positional', () => {
    expect(argsError(job, ['--nope'])).toBe(
      'Unknown option --nope for acme-report (see run acme-report --help)',
    );
    const noPositionals = defineJob({
      id: 'acme-np',
      domain: 'acme',
      flags: {},
      run: () => undefined,
    });
    expect(argsError(noPositionals, ['x'])).toBe(
      'Unexpected argument x for acme-np (see run acme-np --help)',
    );
  });

  it('reports a valued option without a value', () => {
    expect(argsError(job, ['--max'])).toMatch(/^--max requires a value/);
  });

  it('checks nothing for a runnable that declares no flags', () => {
    expect(argsError(loose, ['--anything', 'x'])).toBeUndefined();
  });
});

describe('flagsDeprecation', () => {
  it('warns only for flags given to a runnable that declares none', () => {
    expect(flagsDeprecation(loose, ['--x'])).toMatch(
      /^\[deprecated\] acme-loose/,
    );
    expect(flagsDeprecation(loose, ['positional'])).toBeUndefined();
    expect(flagsDeprecation(job, ['--live'])).toBeUndefined();
  });
});

describe('formatJobHelp', () => {
  it('prints usage, description, flags and the manifest', () => {
    const text = formatJobHelp(job, { schedule: '0 * * * *' } as never);
    expect(text).toContain(
      'Usage: jeeves-scripts run acme-report [options] <handle>',
    );
    expect(text).toContain('Report on acme.');
    expect(text).toContain('  --live  Write changes');
    expect(text).toContain('  -m, --max <value>  Items; default: 5');
    expect(text).toContain('  --since <value>');
    expect(text).toContain('  -h, --help  Print this help and exit');
    expect(text).toContain('"schedule": "0 * * * *"');
  });

  it('says so when no flags are declared and there is no manifest', () => {
    const text = formatJobHelp(loose, undefined);
    expect(text).toContain('(no flags declared)');
    expect(text).toContain('(none: not scheduled)');
  });
});
