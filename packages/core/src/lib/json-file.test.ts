import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  readJsonFile,
  readJsonFileIfExists,
  writeJsonFile,
} from './json-file.js';

const schema = z.object({ n: z.number() });
let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'json-file-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('json-file', () => {
  it('writes with the chosen indent and reads back validated', () => {
    const file = path.join(dir, 'sub', 'a.json');
    writeJsonFile(file, { n: 1 });
    expect(fs.readFileSync(file, 'utf8')).toBe('{\n  "n": 1\n}');
    writeJsonFile(file, { n: 2 }, 0);
    expect(fs.readFileSync(file, 'utf8')).toBe('{"n":2}');
    expect(readJsonFile(file, schema)).toEqual({ n: 2 });
    expect(fs.readdirSync(path.dirname(file))).toEqual(['a.json']);
  });

  it('throws on a schema mismatch and falls back only for a missing file', () => {
    const file = path.join(dir, 'b.json');
    fs.writeFileSync(file, '{"n":"x"}');
    expect(() => readJsonFile(file, schema)).toThrow();
    expect(() => readJsonFileIfExists(file, schema, { n: 0 })).toThrow();
    expect(
      readJsonFileIfExists(path.join(dir, 'none.json'), schema, { n: 0 }),
    ).toEqual({ n: 0 });
  });
});
