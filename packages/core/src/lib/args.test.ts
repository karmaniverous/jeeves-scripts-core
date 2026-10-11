import { describe, expect, it } from 'vitest';

import { flag, parseRunnableArgs, value } from './args.js';

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

  it('ignores unknown arguments', () => {
    expect(parseRunnableArgs(['--bogus', '--type', 'comment'], spec)).toEqual({
      live: false,
      project: '',
      type: 'comment',
    });
  });
});
