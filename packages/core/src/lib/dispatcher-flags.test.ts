import { parseRunnableArgs } from '@karmaniverous/jeeves';
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
  it('rejects a declared flag that is not a boolean instead of trusting it', () => {
    expect(() => declaredDispatcherFlags({ dryRun: 'false' })).toThrow(
      'dispatcher flag dryRun must be a boolean, got string',
    );
    expect(() => resolveDispatcherFlags({ printTask: 1 } as never)).toThrow(
      TypeError,
    );
  });

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

  it('declares flags that parse into exactly what resolveDispatcherFlags reads', () => {
    const parsed = parseRunnableArgs(['--print-task'], dispatcherFlags);
    expect(parsed).toEqual({ printTask: true, dryRun: false });
    expect(resolveDispatcherFlags(parsed)).toEqual(parsed);
    expect(declaredDispatcherFlags(parsed)).toEqual(parsed);
  });
});
