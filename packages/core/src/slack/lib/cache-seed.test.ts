/**
 * Tests for the one-time Slack cache seed from the old channels.json and
 * slack-channel-workspaces.json.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { readJsonFile, seedChannelCache } from './cache-seed.js';
import type { ChannelInfo } from './channel-info.js';

describe('seedChannelCache', () => {
  it('carries accounts and recorded workspaces, adding missing channels', () => {
    const cache: Record<string, ChannelInfo> = {
      C1: { name: 'general', type: 'channel', _account: 'default' },
    };
    const result = seedChannelCache(
      cache,
      {
        C1: { name: 'general', _account: 'default', metadata: {} },
        D1: { name: 'dm-U1', type: 'dm', _account: 'vc', lastTs: '0' },
      },
      { C1: 'Tjgs', D1: 'Tvc', X9: 'Tvc' },
    );
    expect(cache).toEqual({
      C1: {
        name: 'general',
        type: 'channel',
        _account: 'default',
        teamId: 'Tjgs',
      },
      D1: { name: 'dm-U1', type: 'dm', _account: 'vc', teamId: 'Tvc' },
    });
    // X9 is unknown to the old channels.json: nothing to name it by.
    expect(result).toEqual({ added: 1, accountsSet: 1, teamsSet: 2, kept: 1 });
  });

  it('never overwrites cached values', () => {
    const cache: Record<string, ChannelInfo> = {
      C1: { name: 'n', type: 'channel', _account: 'vc', teamId: 'Tnew' },
    };
    seedChannelCache(
      cache,
      { C1: { name: 'n', _account: 'default' } },
      { C1: 'Told' },
    );
    expect(cache.C1).toMatchObject({ _account: 'vc', teamId: 'Tnew' });
  });

  it('rejects files of the wrong shape', () => {
    expect(() => seedChannelCache({}, [], {})).toThrow();
    expect(() => seedChannelCache({}, {}, { C1: 1 })).toThrow();
  });

  it('reads JSON with a BOM', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seed-'));
    const f = path.join(dir, 'w.json');
    fs.writeFileSync(f, '\uFEFF{"C1":"T1"}');
    expect(readJsonFile(f)).toEqual({ C1: 'T1' });
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
