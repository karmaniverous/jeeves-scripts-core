/**
 * Instance presets guard (design §2, §7, Decision 52): the eslint and vitest
 * presets are TypeScript source compiled into `dist/presets/`, the tsconfig
 * preset ships as JSON, all three resolve through the `./presets/*` exports,
 * and the template extends them in one line.
 */

import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import eslintPreset from '../src/presets/eslint.js';
import vitestPreset from '../src/presets/vitest.js';

const pkgRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const templateDir = path.resolve(pkgRoot, '..', 'template');
const require = createRequire(import.meta.url);

const pkg = z
  .object({
    files: z.array(z.string()),
    exports: z.record(z.string(), z.unknown()),
  })
  .parse(
    JSON.parse(fs.readFileSync(path.join(pkgRoot, 'package.json'), 'utf8')),
  );

describe('instance presets', () => {
  it('compiled presets: ./presets/*.js maps to dist with generated types', () => {
    expect(pkg.files).toContain('dist');
    expect(pkg.exports['./presets/*.js']).toEqual({
      types: './dist/presets/*.d.ts',
      default: './dist/presets/*.js',
    });
    for (const preset of ['eslint', 'vitest']) {
      expect(
        fs.existsSync(path.join(pkgRoot, 'src/presets', `${preset}.ts`)),
      ).toBe(true);
      expect(fs.existsSync(path.join(pkgRoot, 'presets', `${preset}.js`))).toBe(
        false,
      );
      expect(
        fs.existsSync(path.join(pkgRoot, 'presets', `${preset}.d.ts`)),
      ).toBe(false);
    }
  });

  it('the tsconfig preset ships as JSON and resolves through ./presets/*', () => {
    expect(pkg.files).toContain('presets');
    expect(pkg.exports['./presets/*']).toBe('./presets/*');
    expect(
      require.resolve('@karmaniverous/jeeves-scripts-core/presets/tsconfig.base.json'),
    ).toBe(path.join(pkgRoot, 'presets', 'tsconfig.base.json'));
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
