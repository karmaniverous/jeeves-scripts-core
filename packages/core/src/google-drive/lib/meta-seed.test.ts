/**
 * Meta seeding reaches the meta service at the address from the meta
 * service's own config (lib/meta-config), never a hard-coded port.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  metaUrl: vi.fn(() => 'http://127.0.0.1:2938'),
}));

vi.mock('../../lib/meta-config.js', () => ({ metaUrl: mocks.metaUrl }));

const { seedMeta } = await import('./meta-seed.js');
const { MetaSyncConfigSchema } = await import('./config.js');
const { seedShareMetas } = await import('./seed-metas.js');

const recorder = () => {
  const urls: string[] = [];
  const fetchFn = (url: string) => {
    urls.push(url);
    return Promise.resolve(new Response('', { status: 201 }));
  };
  return { urls, fetchFn };
};

describe('meta seed address', () => {
  beforeEach(() => {
    mocks.metaUrl.mockClear();
  });

  it("posts to the meta config's URL by default, or to an explicit one", async () => {
    const { urls, fetchFn } = recorder();
    await seedMeta('/p', null, fetchFn);
    await seedMeta('/p', null, fetchFn, 'http://meta.test:9');
    expect(urls).toEqual([
      'http://127.0.0.1:2938/seed',
      'http://meta.test:9/seed',
    ]);
  });

  it('seedShareMetas reads the address once per run, and not at all when seeding is off', async () => {
    const { fetchFn } = recorder();
    const meta = MetaSyncConfigSchema.parse({ seed: false });
    await seedShareMetas('/t', ['a'], new Set(), meta, fetchFn);
    expect(mocks.metaUrl).not.toHaveBeenCalled();
    await seedShareMetas('/t', [], new Set(), { ...meta, seed: true }, fetchFn);
    expect(mocks.metaUrl).toHaveBeenCalledTimes(1);
  });
});
