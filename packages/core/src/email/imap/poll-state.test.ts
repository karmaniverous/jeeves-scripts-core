import type { RunnerClient } from '@karmaniverous/jeeves-runner';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { loadState } from './poll-state.js';

const clientWith = (raw: string | null) =>
  ({ getState: vi.fn(() => raw) }) as unknown as RunnerClient;

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('loadState', () => {
  it('returns valid stored state as parsed', () => {
    const state = {
      folders: {
        INBOX: { uidValidity: 7, lastUid: 42 },
        Sent: { uidValidity: 1, lastUid: 0 },
      },
    };
    expect(loadState('a@x', clientWith(JSON.stringify(state)))).toEqual(state);
    expect(warn).not.toHaveBeenCalled();
  });

  it('treats missing state as no folders, without a warning', () => {
    expect(loadState('a@x', clientWith(null))).toEqual({ folders: {} });
    expect(loadState('a@x', clientWith(''))).toEqual({ folders: {} });
    expect(warn).not.toHaveBeenCalled();
  });

  it.each([
    ['not JSON', '{folders:'],
    ['null', 'null'],
    ['an array', '[]'],
    ['no folders', '{}'],
    ['folders not an object', '{"folders":[1]}'],
    [
      'a string watermark',
      '{"folders":{"INBOX":{"uidValidity":"7","lastUid":42}}}',
    ],
    ['a missing lastUid', '{"folders":{"INBOX":{"uidValidity":7}}}'],
    ['a negative uid', '{"folders":{"INBOX":{"uidValidity":7,"lastUid":-1}}}'],
    [
      'a fractional uid',
      '{"folders":{"INBOX":{"uidValidity":7,"lastUid":1.5}}}',
    ],
  ])('treats %s as no folders and warns instead of throwing', (_, raw) => {
    expect(loadState('a@x', clientWith(raw))).toEqual({ folders: {} });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      expect.stringMatching(/^\[imap\] a@x: ignoring invalid poll state \(/),
    );
  });
});
