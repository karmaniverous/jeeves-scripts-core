import fs from 'node:fs';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildConfigCheckCommand } from './config-check.js';
import { resetConfig } from '../config/loader.js';

describe('config-check CLI', () => {
  beforeEach(() => {
    resetConfig();
    process.exitCode = undefined;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetConfig();
    process.exitCode = undefined;
  });

  it('prints OK and leaves exitCode unset for a valid config (--root)', async () => {
    vi.spyOn(fs, 'readFileSync').mockReturnValue(
      JSON.stringify({ instance: { name: 'test', baseDir: 'J:/' } }),
    );
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const command = buildConfigCheckCommand();
    await command.parseAsync(['--root', '/root'], { from: 'user' });
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('config check: OK'),
    );
    expect(process.exitCode).toBeUndefined();
  });

  it('prints FAILED, the errors, and sets exitCode 1 for an invalid config (--config)', async () => {
    vi.spyOn(fs, 'readFileSync').mockReturnValue(
      JSON.stringify({ instance: { name: 'test' } }),
    );
    const errorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const command = buildConfigCheckCommand();
    await command.parseAsync(['--config', '/root/jeeves-scripts.json'], {
      from: 'user',
    });
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('config check: FAILED'),
    );
    expect(process.exitCode).toBe(1);
  });

  it('infers typed options from the builder chain (no opts() cast)', () => {
    const command = buildConfigCheckCommand();
    command.parseOptions(['--root', '/root', '--config', '/c.json']);
    const opts = command.opts();
    // Type-level: opts.root and opts.config are `string | undefined`
    // without any manual cast, proven by this compiling under strict lint.
    expect(opts.root).toBe('/root');
    expect(opts.config).toBe('/c.json');
  });
});
