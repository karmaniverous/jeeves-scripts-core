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
    expect(result).toEqual({
      added: 1,
      accountsSet: 1,
      teamsSet: 2,
      dmTeamsFromAccount: 0,
      kept: 1,
    });
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

  it("gives DMs their account's workspace, not the recorded one", () => {
    const cache: Record<string, ChannelInfo> = {};
    const result = seedChannelCache(
      cache,
      {
        D1: { name: 'dm-U1', type: 'dm', _account: 'vc' },
        G1: { name: 'mpim-G1', type: 'mpim', _account: 'vc' },
        C1: { name: 'shared', _account: 'vc' },
      },
      { D1: 'Tjgs', G1: 'Tvc', C1: 'Tjgs' },
      { default: 'Tjgs', vc: 'Tvc' },
    );
    expect(cache.D1?.teamId).toBe('Tvc');
    expect(cache.G1?.teamId).toBe('Tvc');
    // Channels keep the recorded workspace.
    expect(cache.C1?.teamId).toBe('Tjgs');
    expect(result).toMatchObject({ dmTeamsFromAccount: 1, teamsSet: 2 });
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
