import { describe, expect, it } from 'vitest';

import { flag, optional, parseRunnableArgs, value } from './args.js';

describe('parseRunnableArgs', () => {
  const spec = {
    live: flag('--live'),
    project: value('--project'),
    type: value('--type', 'issue'),
  };

  it('reads flags and the argument after a valued option', () => {
    expect(
      parseRunnableArgs(['--project', 'ACME', '--live', 'extra'], spec),
    ).toEqual({ live: true, project: 'ACME', type: 'issue' });
  });

  it('uses defaults when an option is absent or has no value after it', () => {
    expect(parseRunnableArgs(['--type'], spec)).toEqual({
      live: false,
      project: '',
      type: 'issue',
    });
  });

  it('leaves an absent optional option undefined', () => {
    const opt = { days: optional('--days') };
    expect(parseRunnableArgs([], opt)).toEqual({ days: undefined });
    expect(parseRunnableArgs(['--days', '7'], opt)).toEqual({ days: '7' });
  });

  it('ignores unknown arguments', () => {
    expect(parseRunnableArgs(['--bogus', '--type', 'comment'], spec)).toEqual({
      live: false,
      project: '',
      type: 'comment',
    });
  });
});
