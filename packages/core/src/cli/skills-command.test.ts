import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getPath } from './fake-openclaw.test-helper.js';
import { buildProgram } from './index.js';
import { shippedSkills, skillsDirFor } from './skills.js';

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = undefined;
});

describe('skills command', () => {
  let tmp: string;
  const savedPath = process.env.PATH;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jsc-skills-'));
  });

  afterEach(() => {
    process.env.PATH = savedPath;
    Reflect.deleteProperty(process.env, 'FAKE_OPENCLAW_STATE');
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('runs install --yes against a fake openclaw executable on PATH', async () => {
    // A fake `openclaw` that keeps its config in a JSON file.
    const state = path.join(tmp, 'state.json');
    fs.writeFileSync(state, '{}');
    fs.writeFileSync(
      path.join(tmp, 'fake-openclaw.mjs'),
      `import fs from 'node:fs';
const file = process.env.FAKE_OPENCLAW_STATE;
const config = JSON.parse(fs.readFileSync(file, 'utf8'));
const [a, b, c, d] = process.argv.slice(2);
const get = (p) => p.split('.').reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), config);
const set = (p, v) => { const ks = p.split('.'); const last = ks.pop(); let o = config; for (const k of ks) o = o[k] ??= {}; if (v === undefined) delete o[last]; else o[last] = v; };
if (a === 'config' && b === 'get') { const v = get(c); if (v === undefined) { console.log('{"error":{"message":"Config path is valid but unset"}}'); process.exit(1); } console.log(JSON.stringify(v)); }
else if (a === 'config' && b === 'set' && c === '--batch-file') { for (const op of JSON.parse(fs.readFileSync(d, 'utf8'))) set(op.path, op.value); }
else if (a === 'config' && b === 'unset') set(c, undefined);
else process.exit(2);
fs.writeFileSync(file, JSON.stringify(config));
`,
    );
    const script = path.join(tmp, 'fake-openclaw.mjs');
    if (process.platform === 'win32')
      fs.writeFileSync(
        path.join(tmp, 'openclaw.cmd'),
        `@"${process.execPath}" "${script}" %*\r\n`,
      );
    else {
      fs.writeFileSync(
        path.join(tmp, 'openclaw'),
        `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`,
      );
      fs.chmodSync(path.join(tmp, 'openclaw'), 0o755);
    }
    process.env.PATH = `${tmp}${path.delimiter}${savedPath ?? ''}`;
    process.env.FAKE_OPENCLAW_STATE = state;
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const repo = path.join(tmp, 'repo');

    await buildProgram({ root: repo }).parseAsync(
      ['skills', 'install', '--yes'],
      {
        from: 'user',
      },
    );

    expect(process.exitCode).toBeUndefined();
    const written = JSON.parse(fs.readFileSync(state, 'utf8')) as unknown;
    expect(getPath(written, 'skills.load.extraDirs')).toEqual([
      skillsDirFor(repo),
    ]);
    for (const skill of shippedSkills())
      expect(
        getPath(written, `skills.entries.${skill}.env.JEEVES_SCRIPTS_DIR`),
      ).toBe(repo);
  });
});
