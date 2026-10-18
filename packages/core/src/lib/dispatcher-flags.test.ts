import { afterEach, describe, expect, it } from 'vitest';

import {
  declaredDispatcherFlags,
  dispatcherFlags,
  resolveDispatcherFlags,
} from './dispatcher-flags.js';

const savedArgv = process.argv;
afterEach(() => {
  process.argv = savedArgv;
});

describe('resolveDispatcherFlags', () => {
  it('reads raw arguments', () => {
    expect(resolveDispatcherFlags(['--dry-run'])).toEqual({
      printTask: false,
      dryRun: true,
    });
  });

  it('takes parsed flags, defaulting the missing ones', () => {
    expect(resolveDispatcherFlags({ printTask: true })).toEqual({
      printTask: true,
      dryRun: false,
    });
    expect(resolveDispatcherFlags({ dryRun: true })).toEqual({
      printTask: false,
      dryRun: true,
    });
  });

  it('defaults to process.argv', () => {
    process.argv = ['node', 'acme-digest', '--print-task'];
    expect(resolveDispatcherFlags()).toEqual({
      printTask: true,
      dryRun: false,
    });
  });
});

describe('declaredDispatcherFlags', () => {
  it('passes declared dispatcher flags on, and nothing else', () => {
    expect(declaredDispatcherFlags({ dryRun: true, printTask: false })).toEqual(
      {
        dryRun: true,
        printTask: false,
      },
    );
    expect(declaredDispatcherFlags({})).toBeUndefined();
    expect(declaredDispatcherFlags(undefined)).toBeUndefined();
  });

  it('names the shared flags', () => {
    expect(Object.values(dispatcherFlags).map((s) => s.name)).toEqual([
      '--print-task',
      '--dry-run',
    ]);
  });
});
