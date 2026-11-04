import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { meetsFloor, NODE_FLOOR, nodeCheck } from './node-version.js';
import { corePackageDir } from './package-info.js';

describe('NODE_FLOOR', () => {
  it("matches engines.node in core's package.json", () => {
    const { engines } = z
      .object({ engines: z.object({ node: z.string() }) })
      .parse(
        JSON.parse(
          fs.readFileSync(path.join(corePackageDir(), 'package.json'), 'utf8'),
        ),
      );
    expect(engines.node).toBe(`>=${NODE_FLOOR}`);
  });
});

describe('meetsFloor', () => {
  it.each([
    ['24.18.0', false],
    ['24.22.1', false],
    ['24.21.9', false],
    ['23.99.99', false],
    ['22.12.0', false],
    ['24.22.2', true],
    ['v24.22.2', true],
    ['24.22.3', true],
    ['24.23.0', true],
    ['25.0.0', true],
    ['25.1.4', true],
  ])('%s => %s', (version, expected) => {
    expect(meetsFloor(version)).toBe(expected);
  });

  it.each([
    ['24', false],
    ['24.22', false],
    ['25', true],
    ['24.23', true],
    ['24.22.2-pre', true],
    ['24.22.2+build', true],
  ])('reads the missing parts of %s as 0 => %s', (version, expected) => {
    expect(meetsFloor(version)).toBe(expected);
  });

  it('compares against a given floor, missing parts read as 0', () => {
    expect(meetsFloor('24.0.0', '24')).toBe(true);
    expect(meetsFloor('23.9.9', '24')).toBe(false);
    expect(meetsFloor('24.1.0', '24.1')).toBe(true);
    expect(meetsFloor('24.22.0', '24.22.1')).toBe(false);
  });

  it('reads a non-numeric part as 0', () => {
    expect(meetsFloor('24.22.x')).toBe(false);
    expect(meetsFloor('24.x.0', '24.0.0')).toBe(true);
  });
});

describe('nodeCheck', () => {
  it('fails below the floor, naming both versions and why', () => {
    const r = nodeCheck('24.18.0');
    expect(r.ok).toBe(false);
    expect(r.line).toBe(
      'node: 24.18.0: FAILED: requires >=24.22.2; Node 24.16-24.18 have a SQLite WAL checkpoint bug (the WAL grows without bound). Upgrade Node.',
    );
  });

  it.each(['24.22.2', '24.30.1', '25.2.0'])('passes at %s', (version) => {
    expect(nodeCheck(version)).toEqual({
      ok: true,
      line: `node: ${version} (requires >=24.22.2): OK`,
    });
  });

  it('defaults to the running Node', () => {
    const running = Object.getOwnPropertyDescriptor(process.versions, 'node');
    Object.defineProperty(process.versions, 'node', {
      ...running,
      value: '24.18.0',
    });
    try {
      expect(nodeCheck()).toMatchObject({ ok: false });
      expect(nodeCheck().line).toMatch(/^node: 24\.18\.0: FAILED/);
    } finally {
      if (running) Object.defineProperty(process.versions, 'node', running);
    }
  });
});
