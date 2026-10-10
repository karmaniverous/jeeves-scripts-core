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
      Promise.resolve(t === 'xoxb-vc' ? 'Tvc' : 'Tjgs'),
    );
    const tokens = { default: 'xoxb-d', vc: 'xoxb-vc' };
    await expect(accountTeams(tokens, file, teamOf)).resolves.toEqual({
      default: 'Tjgs',
      vc: 'Tvc',
    });
    expect(loadAccountTeams(file)).toEqual({ default: 'Tjgs', vc: 'Tvc' });
    await accountTeams(tokens, file, teamOf);
    expect(teamOf).toHaveBeenCalledTimes(2);
  });

  it('leaves out an account whose auth.test fails, and retries it next time', async () => {
    const teamOf = vi
      .fn()
      .mockResolvedValueOnce('Tjgs')
      .mockRejectedValueOnce(new Error('invalid_auth'));
    await expect(
      accountTeams({ default: 'a', vc: 'b' }, file, teamOf),
    ).resolves.toEqual({ default: 'Tjgs' });
    teamOf.mockResolvedValueOnce('Tvc');
    await expect(
      accountTeams({ default: 'a', vc: 'b' }, file, teamOf),
    ).resolves.toEqual({ default: 'Tjgs', vc: 'Tvc' });
  });

  it('treats an unreadable cache as empty', () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '{bad');
    expect(loadAccountTeams(file)).toEqual({});
  });
});

describe('helpers', () => {
  it("the primary workspace is the default account's", () => {
    expect(primaryTeam({ vc: 'Tvc', default: 'Tjgs' })).toBe('Tjgs');
    expect(primaryTeam({ vc: 'Tvc' })).toBe('Tvc');
    expect(primaryTeam({})).toBe('');
  });

  it('inverts accounts to teams', () => {
    expect(teamToAccount({ default: 'Tjgs', vc: 'Tvc' })).toEqual({
      Tjgs: 'default',
      Tvc: 'vc',
    });
  });
});
