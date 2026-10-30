import fs from 'node:fs';

import { describe, expect, it } from 'vitest';

import { configSchema } from '../src/config/schema.js';

describe('the template', () => {
  it('ships a sample config that passes the config schema (init copies it out of the repo)', () => {
    const sample = JSON.parse(
      fs.readFileSync(
        new URL('../../template/config.sample.json', import.meta.url),
        'utf8',
      ),
    ) as unknown;
    expect(configSchema.safeParse(sample).success).toBe(true);
  });

  it('has a test that does not read the sample config, which instance repos lack (#62 review)', () => {
    const test = fs.readFileSync(
      new URL('../../template/src/example/say-hello.test.ts', import.meta.url),
      'utf8',
    );
    expect(test).not.toMatch(/config\.sample\.json/);
  });
});
