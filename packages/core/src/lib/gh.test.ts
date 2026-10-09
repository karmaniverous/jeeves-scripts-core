import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:child_process', () => ({
  default: {
    spawnSync: vi.fn(),
  },
}));

import cp from 'node:child_process';

import { gh, ghApi, ghJson, setupGhConfig } from './gh.js';

describe('gh', () => {
  afterEach(() => {
    vi.mocked(cp.spawnSync).mockReset();
  });

  describe('setupGhConfig', () => {
    it('sets GH_CONFIG_DIR environment variable', () => {
      const prev = process.env.GH_CONFIG_DIR;
      setupGhConfig();
      expect(process.env.GH_CONFIG_DIR).toBeDefined();
      expect(process.env.GH_CONFIG_DIR).not.toBe('');
      process.env.GH_CONFIG_DIR = prev;
    });
  });

  describe('gh()', () => {
    it('returns structured result on success', () => {
      vi.mocked(cp.spawnSync).mockReturnValue({
        stdout: '  output text  ',
        stderr: '',
        status: 0,
        signal: null,
        pid: 1,
        output: [],
        error: undefined,
      });

      const result = gh(['repo', 'list']);
      expect(result).toEqual({
        ok: true,
        status: 0,
        out: 'output text',
        err: '',
      });
    });

    it('throws on non-zero exit when allowFail is false', () => {
      vi.mocked(cp.spawnSync).mockReturnValue({
        stdout: '',
        stderr: 'not found',
        status: 1,
        signal: null,
        pid: 1,
        output: [],
        error: undefined,
      });

      expect(() => gh(['repo', 'view', 'missing'])).toThrow(
        /failed.*not found/,
      );
    });

    it('returns failure result when allowFail is true and exit non-zero', () => {
      vi.mocked(cp.spawnSync).mockReturnValue({
        stdout: '',
        stderr: 'error msg',
        status: 2,
        signal: null,
        pid: 1,
        output: [],
        error: undefined,
      });

      const result = gh(['pr', 'view'], { allowFail: true });
      expect(result).toEqual({
        ok: false,
        status: 2,
        out: '',
        err: 'error msg',
      });
    });

    it('throws on spawn error when allowFail is false', () => {
      vi.mocked(cp.spawnSync).mockReturnValue({
        stdout: '',
        stderr: '',
        status: null,
        signal: null,
        pid: 1,
        output: [],
        error: new Error('ENOENT'),
      });

      expect(() => gh(['version'])).toThrow('ENOENT');
    });

    it('returns error result when allowFail is true and spawn error', () => {
      vi.mocked(cp.spawnSync).mockReturnValue({
        stdout: '',
        stderr: '',
        status: null,
        signal: null,
        pid: 1,
        output: [],
        error: new Error('ENOENT'),
      });

      const result = gh(['version'], { allowFail: true });
      expect(result.ok).toBe(false);
      expect(result.error).toContain('ENOENT');
    });

    it('trims stdout and stderr', () => {
      vi.mocked(cp.spawnSync).mockReturnValue({
        stdout: '\n  hello \n',
        stderr: ' warn \n',
        status: 0,
        signal: null,
        pid: 1,
        output: [],
        error: undefined,
      });

      const result = gh(['test']);
      expect(result.out).toBe('hello');
      expect(result.err).toBe('warn');
    });
  });

  describe('ghJson()', () => {
    it('parses stdout as JSON', () => {
      vi.mocked(cp.spawnSync).mockReturnValue({
        stdout: '{"name":"repo","stars":5}',
        stderr: '',
        status: 0,
        signal: null,
        pid: 1,
        output: [],
        error: undefined,
      });

      expect(ghJson(['repo', 'view', '--json', 'name'])).toEqual({
        name: 'repo',
        stars: 5,
      });
    });

    it('returns null for empty stdout', () => {
      vi.mocked(cp.spawnSync).mockReturnValue({
        stdout: '',
        stderr: '',
        status: 0,
        signal: null,
        pid: 1,
        output: [],
        error: undefined,
      });

      expect(ghJson(['repo', 'view'])).toBeNull();
    });

    it('throws on invalid JSON', () => {
      vi.mocked(cp.spawnSync).mockReturnValue({
        stdout: 'not json',
        stderr: '',
        status: 0,
        signal: null,
        pid: 1,
        output: [],
        error: undefined,
      });

      expect(() => ghJson(['broken'])).toThrow();
    });
  });

  describe('ghApi()', () => {
    it('calls gh with api endpoint', () => {
      vi.mocked(cp.spawnSync).mockReturnValue({
        stdout: '{"id":1}',
        stderr: '',
        status: 0,
        signal: null,
        pid: 1,
        output: [],
        error: undefined,
      });

      const result = ghApi('repos/owner/repo');
      expect(result).toEqual({ id: 1 });
      expect(vi.mocked(cp.spawnSync)).toHaveBeenCalledWith(
        expect.anything(),
        ['api', 'repos/owner/repo'],
        expect.anything(),
      );
    });
  });
});
