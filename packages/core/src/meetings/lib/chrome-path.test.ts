import fs from 'node:fs';
import os from 'node:os';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveChromePath } from './chrome-path.js';

describe('resolveChromePath', () => {
  beforeEach(() => {
    vi.stubEnv('PUPPETEER_EXECUTABLE_PATH', undefined);
    vi.stubEnv('CHROME_PATH', undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it.each(['PUPPETEER_EXECUTABLE_PATH', 'CHROME_PATH'])(
    'uses %s when it names an existing file',
    (name) => {
      vi.stubEnv(name, process.execPath);
      expect(resolveChromePath()).toBe(process.execPath);
    },
  );

  it('prefers PUPPETEER_EXECUTABLE_PATH over CHROME_PATH', () => {
    vi.stubEnv('PUPPETEER_EXECUTABLE_PATH', process.execPath);
    vi.stubEnv('CHROME_PATH', '/nonexistent/chrome');
    expect(resolveChromePath()).toBe(process.execPath);
  });

  it('throws when the environment path does not exist', () => {
    vi.stubEnv('PUPPETEER_EXECUTABLE_PATH', '/nonexistent/chrome/executable');
    expect(() => resolveChromePath()).toThrow(
      /Chrome executable not found at path from environment/,
    );
  });

  it('falls back to the first well-known path that exists', () => {
    const checked: string[] = [];
    vi.spyOn(fs, 'existsSync').mockImplementation((p) => {
      checked.push(String(p));
      return checked.length === 2;
    });
    expect(resolveChromePath()).toBe(checked[1]);
    expect(checked).toHaveLength(2);
  });

  it('has no well-known paths for another platform', () => {
    vi.spyOn(os, 'platform').mockReturnValue('aix');
    const exists = vi.spyOn(fs, 'existsSync');
    expect(() => resolveChromePath()).toThrow(/PUPPETEER_EXECUTABLE_PATH/);
    expect(exists).not.toHaveBeenCalled();
  });

  it('throws, naming PUPPETEER_EXECUTABLE_PATH, when nothing is found', () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(false);
    expect(() => resolveChromePath()).toThrow(/PUPPETEER_EXECUTABLE_PATH/);
  });
});
