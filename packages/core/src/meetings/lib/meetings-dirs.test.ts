import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { siloRouting } from '../../config/index.js';
import { getMeetingsDirs, meetingPackages } from './meetings-dirs.js';

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'meetings-dirs-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('meetingPackages', () => {
  it('yields package directories only, passing over missing and unreadable dirs', () => {
    fs.mkdirSync(path.join(dir, 'm1'));
    fs.writeFileSync(path.join(dir, 'index.json'), '{}');
    const notADir = path.join(dir, 'index.json');
    const errors: string[] = [];
    const found = [
      ...meetingPackages([dir, path.join(dir, 'missing'), notADir], (d) => {
        errors.push(d);
      }),
    ];
    expect(found).toEqual([
      { meetingsDir: dir, meetingId: 'm1', meetingPath: path.join(dir, 'm1') },
    ]);
    expect(errors).toEqual([notADir]);
    expect([...meetingPackages([notADir])]).toEqual([]);
  });
});

describe('getMeetingsDirs', () => {
  it('lists every silo meetings directory', () => {
    const dirs = getMeetingsDirs();
    // The test config has no silos: just the default silo's meetings dir.
    expect(dirs).toEqual([
      path.join(siloRouting().defaultBasePath, 'meetings'),
    ]);
    expect(dirs.every((d) => path.basename(d) === 'meetings')).toBe(true);
  });
});
