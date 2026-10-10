/**
 * Tests for lib/meta-config against temp meta config files.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { META_PORT } from '@karmaniverous/jeeves';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { componentConfigPath } from './component-config.js';
import { metaConfig, metaUrl } from './meta-config.js';

let root: string;
let file: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-config-'));
  file = componentConfigPath('meta', root);
  fs.mkdirSync(path.dirname(file), { recursive: true });
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('metaUrl', () => {
  it("uses the meta service's configured port", () => {
    fs.writeFileSync(file, JSON.stringify({ port: 2938, watcherUrl: 'x' }));
    expect(metaUrl(file)).toBe('http://127.0.0.1:2938');
  });

  it('defaults to the platform meta port without a port key or a file', () => {
    fs.writeFileSync(file, JSON.stringify({ schedule: '*/5 * * * *' }));
    expect(metaConfig(file).port).toBe(META_PORT);
    fs.rmSync(file);
    expect(metaUrl(file)).toBe(`http://127.0.0.1:${String(META_PORT)}`);
  });

  it('rejects an invalid port', () => {
    fs.writeFileSync(file, JSON.stringify({ port: 'nope' }));
    expect(() => metaUrl(file)).toThrow(/Invalid jeeves-meta config/);
  });
});
