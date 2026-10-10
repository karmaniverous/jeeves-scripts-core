/**
 * Tests for the account → workspace cache (auth.test, cached in state).
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  accountTeams,
  loadAccountTeams,
  primaryTeam,
  teamToAccount,
} from './account-teams.js';

let dir: string;
let file: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'account-teams-'));
  file = path.join(dir, 'slack', 'accounts.json');
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('accountTeams', () => {
  it('asks auth.test once per account and caches the answers', async () => {
    const teamOf = vi.fn((t: string) =>
      Promise.resolve(t === 'xoxb-work' ? 'Twork' : 'Tmain'),
    );
    const tokens = { default: 'xoxb-d', work: 'xoxb-work' };
    await expect(accountTeams(tokens, file, teamOf)).resolves.toEqual({
      default: 'Tmain',
      work: 'Twork',
    });
    expect(loadAccountTeams(file)).toEqual({ default: 'Tmain', work: 'Twork' });
    await accountTeams(tokens, file, teamOf);
    expect(teamOf).toHaveBeenCalledTimes(2);
  });

  it('leaves out an account whose auth.test fails, and retries it next time', async () => {
    const teamOf = vi
      .fn()
      .mockResolvedValueOnce('Tmain')
      .mockRejectedValueOnce(new Error('invalid_auth'));
    await expect(
      accountTeams({ default: 'a', work: 'b' }, file, teamOf),
    ).resolves.toEqual({ default: 'Tmain' });
    teamOf.mockResolvedValueOnce('Twork');
    await expect(
      accountTeams({ default: 'a', work: 'b' }, file, teamOf),
    ).resolves.toEqual({ default: 'Tmain', work: 'Twork' });
  });

  it('treats an unreadable cache as empty', () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '{bad');
    expect(loadAccountTeams(file)).toEqual({});
  });
});

describe('helpers', () => {
  it("the primary workspace is the default account's", () => {
    expect(primaryTeam({ work: 'Twork', default: 'Tmain' })).toBe('Tmain');
    expect(primaryTeam({ work: 'Twork' })).toBe('Twork');
    expect(primaryTeam({})).toBe('');
  });

  it('inverts accounts to teams', () => {
    expect(teamToAccount({ default: 'Tmain', work: 'Twork' })).toEqual({
      Tmain: 'default',
      Twork: 'work',
    });
  });
});
