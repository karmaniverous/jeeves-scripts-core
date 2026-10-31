import fs from 'node:fs';
import path from 'node:path';

import { ApiError } from '@xdevplatform/xdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createXClient,
  lookupUser,
  withAutoRefresh,
  xHandlePrerequisite,
} from './x-api.js';
import type { XClient, XUserLookupClient } from './x-client.js';
import { type XWorld, xWorld } from './x-deps.test-helper.js';
import { writeOAuthCredentials } from './x-oauth.js';

let w: XWorld;
beforeEach(() => {
  w = xWorld();
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
  w.cleanup();
});

const check = (over: Record<string, unknown> = {}) =>
  xHandlePrerequisite({
    scriptName: 'post.ts',
    accounts: () => w.deps.accounts,
    oauthDir: () => w.deps.oauthDir,
    ...over,
  });

describe('xHandlePrerequisite', () => {
  it('needs a handle argument', () => {
    expect(check()({ args: [], flags: {} })).toBe(
      'No X account handle provided. Usage: jeeves-scripts run <job-id> <handle> (post.ts)',
    );
  });

  it('needs a configured account only when asked', () => {
    expect(
      check({ requireAccount: true })({ args: ['other'], flags: {} }),
    ).toBe(
      "X account 'other' is not in integrations.x.accounts in the instance config",
    );
    expect(check()({ args: ['other'], flags: {} })).toBe(
      'X OAuth2 credentials not configured',
    );
  });

  it('needs the OAuth file unless told not to', () => {
    expect(
      check({ requireAccount: true })({ args: ['example'], flags: {} }),
    ).toBe(true);
    fs.rmSync(path.join(w.deps.oauthDir, 'x-example-oauth2.json'));
    expect(check()({ args: ['example'], flags: {} })).toBe(
      'X OAuth2 credentials not configured',
    );
    expect(
      check({ requireOAuth: false })({ args: ['example'], flags: {} }),
    ).toBe(true);
  });
});

describe('createXClient', () => {
  it('needs credentials with an access token', () => {
    expect(createXClient(w.deps.oauthDir, 'nobody')).toBeNull();
    expect(createXClient(w.deps.oauthDir, 'example')).toBeNull();
    writeOAuthCredentials(w.deps.oauthDir, 'example', {
      provider: 'x',
      account: 'example',
      access_token: 'tok',
    });
    expect(createXClient(w.deps.oauthDir, 'example')).not.toBeNull();
  });
});

describe('withAutoRefresh', () => {
  const unauthorized = () =>
    new ApiError('no', 401, 'Unauthorized', new Headers());

  beforeEach(() => {
    writeOAuthCredentials(w.deps.oauthDir, 'example', {
      provider: 'x',
      account: 'example',
      access_token: 'tok',
    });
  });

  it('throws without credentials', async () => {
    await expect(
      withAutoRefresh(w.deps.oauthDir, 'nobody', () => Promise.resolve(1)),
    ).rejects.toThrow('No X credentials for @nobody');
  });

  it('returns the call result', async () => {
    await expect(
      withAutoRefresh(w.deps.oauthDir, 'example', () => Promise.resolve(7)),
    ).resolves.toBe(7);
  });

  it('refreshes once on a 401 and retries', async () => {
    const fn = vi
      .fn<(c: XClient) => Promise<number>>()
      .mockRejectedValueOnce(unauthorized())
      .mockResolvedValueOnce(9);
    const refresh = vi.fn(() =>
      Promise.resolve({ accessToken: 'new', refreshToken: 'r' }),
    );
    await expect(
      withAutoRefresh(w.deps.oauthDir, 'example', fn, refresh),
    ).resolves.toBe(9);
    expect(refresh).toHaveBeenCalledWith('example');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('rethrows the 401 when the refresh gives nothing, and other errors as they are', async () => {
    const err = unauthorized();
    await expect(
      withAutoRefresh(
        w.deps.oauthDir,
        'example',
        () => Promise.reject(err),
        () => Promise.resolve(null),
      ),
    ).rejects.toBe(err);
    await expect(
      withAutoRefresh(w.deps.oauthDir, 'example', () =>
        Promise.reject(new Error('boom')),
      ),
    ).rejects.toThrow('boom');
  });
});

describe('lookupUser', () => {
  it('caches a resolved id and reports an unknown handle', async () => {
    const getByUsername = vi.fn((h: string) =>
      Promise.resolve({ data: h === 'ghost' ? undefined : { id: `id-${h}` } }),
    );
    const client: XUserLookupClient = { users: { getByUsername } };
    await expect(lookupUser(client, 'cached-one')).resolves.toBe(
      'id-cached-one',
    );
    await expect(lookupUser(client, 'cached-one')).resolves.toBe(
      'id-cached-one',
    );
    expect(getByUsername).toHaveBeenCalledTimes(1);
    await expect(lookupUser(client, 'ghost')).resolves.toBeNull();
  });
});
