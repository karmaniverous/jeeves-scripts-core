/**
 * Instance presets guard (design §2, §7): the eslint, tsconfig and vitest
 * presets ship in the package, resolve through the `./presets/*` export
 * from outside the package, and the template extends them in one line.
 */

import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import eslintPreset from '../presets/eslint.js';
import vitestPreset from '../presets/vitest.js';

const pkgRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const templateDir = path.resolve(pkgRoot, '..', 'template');
const require = createRequire(import.meta.url);

const PRESETS = ['eslint.js', 'tsconfig.base.json', 'vitest.js'];

describe('instance presets', () => {
  it('ship in the package and resolve through ./presets/*', () => {
    const files = z
      .object({ files: z.array(z.string()) })
      .parse(
        JSON.parse(fs.readFileSync(path.join(pkgRoot, 'package.json'), 'utf8')),
      ).files;
    expect(files).toContain('presets');
    for (const preset of PRESETS)
      expect(
        require.resolve(`@karmaniverous/jeeves-scripts-core/presets/${preset}`),
      ).toBe(path.join(pkgRoot, 'presets', preset));
  });

  it('eslint preset: strict type-aware config rooted at the instance', () => {
    const config = eslintPreset('/repo');
    const roots = config
      .map(
        (c) =>
          (
            c.languageOptions?.parserOptions as
              { tsconfigRootDir?: string } | undefined
          )?.tsconfigRootDir,
      )
      .filter((r) => r !== undefined);
    expect(roots).toEqual(['/repo']);
    expect(
      config.some((c) => c.rules?.['@typescript-eslint/no-floating-promises']),
    ).toBe(true);
  });

  it('vitest preset: node environment with globals', () => {
    expect(vitestPreset.test).toMatchObject({
      globals: true,
      environment: 'node',
    });
  });

  it('the template extends each preset, with no path mapping into core', () => {
    const read = (file: string) =>
      fs.readFileSync(path.join(templateDir, file), 'utf8');
    expect(JSON.parse(read('tsconfig.json'))).toEqual({
      extends: '@karmaniverous/jeeves-scripts-core/presets/tsconfig.base.json',
    });
    expect(read('eslint.config.ts')).toContain(
      '@karmaniverous/jeeves-scripts-core/presets/eslint.js',
    );
    expect(read('vitest.config.ts')).toContain(
      '@karmaniverous/jeeves-scripts-core/presets/vitest.js',
    );
  });
});
