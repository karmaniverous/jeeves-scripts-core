import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildProgram } from './index.js';
import { formatInit, initRepo, RENAMED_DOTFILES } from './init.js';
import { coreVersion } from './package-info.js';

/** The real template workspace (what core's build bundles). */
const templateDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../template',
);

let tmp: string;
let root: string;
let fixture: string;

const write = (dir: string, rel: string, text: string) => {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), text);
};

beforeEach(() => {
  // The target folder's name is init's default package name, so give it a
  // valid one (mkdtemp suffixes are mixed case).
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jsc-init-'));
  root = path.join(tmp, 'instance');
  fs.mkdirSync(root);
  fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'jsc-tpl-'));
  write(
    fixture,
    'package.json',
    JSON.stringify({
      name: 'jeeves-scripts-template',
      private: true,
      dependencies: { '@karmaniverous/jeeves-scripts-core': '*' },
    }),
  );
  write(fixture, 'gitignore', 'node_modules/\n');
  write(fixture, 'npmrc', 'save-exact=true\n');
  write(fixture, 'src/example/gitignore', 'nested, not renamed\n');
  write(fixture, 'README.md', '# Instance\n');
});

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = undefined;
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.rmSync(fixture, { recursive: true, force: true });
});

const readPkg = () =>
  JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as {
    name: string;
    private: boolean;
    dependencies: Record<string, string>;
  };

describe('initRepo', () => {
  it('writes the template with the name, an exact core pin and restored dotfiles', () => {
    const result = initRepo(root, {
      name: '@acme/scripts',
      core: '0.1.0',
      templateDir: fixture,
    });

    expect(result.created.sort()).toEqual(
      [
        '.gitignore',
        '.npmrc',
        'README.md',
        'package.json',
        'src/example/gitignore',
      ].sort(),
    );
    expect(result.skipped).toEqual([]);
    expect(readPkg()).toEqual({
      name: '@acme/scripts',
      private: true,
      dependencies: { '@karmaniverous/jeeves-scripts-core': '0.1.0' },
    });
    expect(fs.readFileSync(path.join(root, '.gitignore'), 'utf8')).toBe(
      'node_modules/\n',
    );
    expect(fs.existsSync(path.join(root, 'gitignore'))).toBe(false);
  });

  it('defaults to the target folder name and the running core version', () => {
    const target = path.join(root, 'acme-scripts');
    fs.mkdirSync(target);
    initRepo(target, { templateDir: fixture });
    const pkg = JSON.parse(
      fs.readFileSync(path.join(target, 'package.json'), 'utf8'),
    ) as { name: string; dependencies: Record<string, string> };
    expect(pkg.name).toBe('acme-scripts');
    expect(pkg.dependencies['@karmaniverous/jeeves-scripts-core']).toBe(
      coreVersion(),
    );
  });

  it('refuses a folder name that is not a valid package name', () => {
    const target = path.join(root, 'Acme Scripts');
    fs.mkdirSync(target);
    expect(() => initRepo(target, { templateDir: fixture })).toThrow(
      /valid npm package name/,
    );
  });

  it('pins the running core version by default', () => {
    initRepo(root, { name: 'acme', templateDir: fixture });
    expect(readPkg().dependencies['@karmaniverous/jeeves-scripts-core']).toBe(
      coreVersion(),
    );
  });

  it('never overwrites a file that exists', () => {
    write(root, 'README.md', 'mine\n');
    write(root, 'package.json', '{"name":"mine"}');

    const result = initRepo(root, { core: '0.1.0', templateDir: fixture });

    expect(result.skipped.sort()).toEqual(['README.md', 'package.json']);
    expect(fs.readFileSync(path.join(root, 'README.md'), 'utf8')).toBe(
      'mine\n',
    );
    expect(readPkg().name).toBe('mine');
    expect(initRepo(root, { core: '0.1.0', templateDir: fixture })).toEqual({
      created: [],
      skipped: expect.arrayContaining(['.gitignore']) as string[],
    });
  });

  it.each([['^0.1.0'], ['latest'], ['0.1']])(
    'rejects a core version that is not exact: %s',
    (core) => {
      expect(() => initRepo(root, { core, templateDir: fixture })).toThrow(
        /exact version/,
      );
    },
  );

  it('rejects an invalid package name', () => {
    expect(() =>
      initRepo(root, { name: 'Not A Name', templateDir: fixture }),
    ).toThrow(/npm package name/);
  });

  it('fails when the template is missing', () => {
    expect(() =>
      initRepo(root, { templateDir: path.join(fixture, 'nope') }),
    ).toThrow(/No bundled template/);
  });

  it('writes fewer than 15 files from the real template, dotfiles restored', () => {
    // The workspace may hold a local node_modules cache; core's build never bundles it.
    const created = initRepo(root, {
      core: '0.1.0',
      templateDir,
    }).created.filter((f) => !f.startsWith('node_modules/'));
    expect(created.length).toBeLessThan(15);
    for (const dotfile of Object.values(RENAMED_DOTFILES))
      expect(created).toContain(dotfile);
    expect(created).toEqual(
      expect.arrayContaining([
        'bin/jeeves-scripts.js',
        'jeeves-scripts.json',
        'jeeves-scripts.plugin.ts',
        'jobs/local.json',
      ]),
    );
  });
});

describe('formatInit', () => {
  it('lists created and skipped files and the next steps', () => {
    expect(formatInit('/r', { created: ['a'], skipped: ['b'] })).toEqual([
      'create a',
      'skip   b (exists)',
      'init: 1 created, 1 skipped in /r',
      expect.stringContaining('npm install') as string,
    ]);
  });
});

describe('init command', () => {
  it('exits 1 with the problem on an invalid version', async () => {
    const error = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    await buildProgram({ root }).parseAsync(['init', '--core', '^1.0.0'], {
      from: 'user',
    });

    expect(error).toHaveBeenCalledWith(
      expect.stringMatching(/^init: FAILED: .*exact version/s),
    );
    expect(process.exitCode).toBe(1);
  });
});
