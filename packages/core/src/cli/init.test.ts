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
let cfg: string;

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
  cfg = path.join(tmp, 'config');
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
  write(
    fixture,
    'config.sample.json',
    JSON.stringify({
      $schema: 'x',
      instance: { name: 'example', baseDir: '/base' },
    }),
  );
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
      configDir: cfg,
    });

    expect(result.created.sort()).toEqual(
      [
        '.gitignore',
        '.npmrc',
        'README.md',
        'package.json',
        'src/example/gitignore',
        'jeeves-scripts.json',
        path.join(cfg, 'config.json'),
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
    initRepo(target, { templateDir: fixture, configDir: cfg });
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
    expect(() =>
      initRepo(target, { templateDir: fixture, configDir: cfg }),
    ).toThrow(
      /--name, default: the folder name\) must be a valid npm package name: "Acme Scripts"/,
    );
  });

  it('pins the running core version by default', () => {
    initRepo(root, { name: 'acme', templateDir: fixture, configDir: cfg });
    expect(readPkg().dependencies['@karmaniverous/jeeves-scripts-core']).toBe(
      coreVersion(),
    );
  });

  it('never overwrites a file that exists', () => {
    write(root, 'README.md', 'mine\n');
    write(root, 'package.json', '{"name":"mine"}');

    const result = initRepo(root, {
      core: '0.1.0',
      templateDir: fixture,
      configDir: cfg,
    });

    expect(result.skipped.sort()).toEqual(['README.md', 'package.json']);
    expect(fs.readFileSync(path.join(root, 'README.md'), 'utf8')).toBe(
      'mine\n',
    );
    expect(readPkg().name).toBe('mine');
    expect(
      initRepo(root, { core: '0.1.0', templateDir: fixture, configDir: cfg }),
    ).toEqual({
      created: [],
      skipped: expect.arrayContaining(['.gitignore']) as string[],
    });
  });

  it.each([['^0.1.0'], ['latest'], ['0.1']])(
    'rejects a core version that is not exact: %s',
    (core) => {
      expect(() =>
        initRepo(root, { core, templateDir: fixture, configDir: cfg }),
      ).toThrow(/exact version/);
    },
  );

  it('writes config.json in the config dir and a pointer to it (#57)', () => {
    initRepo(root, { core: '0.1.0', templateDir: fixture, configDir: cfg });
    expect(
      JSON.parse(
        fs.readFileSync(path.join(root, 'jeeves-scripts.json'), 'utf8'),
      ),
    ).toEqual({
      $schema:
        './node_modules/@karmaniverous/jeeves-scripts-core/schema/pointer.schema.json',
      config: cfg,
    });
    expect(
      JSON.parse(fs.readFileSync(path.join(cfg, 'config.json'), 'utf8')),
    ).toEqual({
      $schema:
        '../instance/node_modules/@karmaniverous/jeeves-scripts-core/schema/jeeves-scripts.schema.json',
      instance: { name: 'example', baseDir: '/base' },
    });
    expect(fs.existsSync(path.join(root, 'config.sample.json'))).toBe(false);
  });

  it('never overwrites the config or the pointer', () => {
    write(cfg, 'config.json', 'mine');
    write(root, 'jeeves-scripts.json', 'pointer');
    const result = initRepo(root, {
      core: '0.1.0',
      templateDir: fixture,
      configDir: cfg,
    });
    expect(result.skipped).toEqual(
      expect.arrayContaining([
        path.join(cfg, 'config.json'),
        'jeeves-scripts.json',
      ]),
    );
    expect(fs.readFileSync(path.join(cfg, 'config.json'), 'utf8')).toBe('mine');
    expect(
      fs.readFileSync(path.join(root, 'jeeves-scripts.json'), 'utf8'),
    ).toBe('pointer');
  });

  it('requires --config-dir and a template with a sample config', () => {
    expect(() =>
      initRepo(root, { core: '0.1.0', templateDir: fixture, configDir: '' }),
    ).toThrow(/--config-dir <dir>\) is required/);
    fs.rmSync(path.join(fixture, 'config.sample.json'));
    expect(() =>
      initRepo(root, { core: '0.1.0', templateDir: fixture, configDir: cfg }),
    ).toThrow(/no config\.sample\.json/);
  });

  it('refuses a config dir inside the repo', () => {
    expect(() =>
      initRepo(root, {
        core: '0.1.0',
        templateDir: fixture,
        configDir: path.join(root, 'cfg'),
      }),
    ).toThrow(/must be outside the instance repo/);
    expect(() =>
      initRepo(root, { core: '0.1.0', templateDir: fixture, configDir: root }),
    ).toThrow(/must be outside/);
  });

  it('writes no sample config for a repo that still holds its full config', () => {
    write(
      root,
      'jeeves-scripts.json',
      JSON.stringify({ instance: { name: 'x', baseDir: '/b' } }),
    );
    const result = initRepo(root, {
      core: '0.1.0',
      templateDir: fixture,
      configDir: cfg,
    });
    expect(fs.existsSync(path.join(cfg, 'config.json'))).toBe(false);
    expect(result.skipped).toEqual(
      expect.arrayContaining([
        path.join(cfg, 'config.json'),
        'jeeves-scripts.json',
      ]),
    );
  });

  it('rejects an invalid package name', () => {
    expect(() =>
      initRepo(root, {
        name: 'Not A Name',
        templateDir: fixture,
        configDir: cfg,
      }),
    ).toThrow(/npm package name/);
  });

  it('fails when the template is missing', () => {
    expect(() =>
      initRepo(root, {
        templateDir: path.join(fixture, 'nope'),
        configDir: cfg,
      }),
    ).toThrow(/No bundled template/);
  });

  it('writes fewer than 15 files from the real template, dotfiles restored', () => {
    // The workspace may hold a local node_modules cache and the coverage
    // report its own `npm test` writes; core's build bundles neither.
    const created = initRepo(root, {
      core: '0.1.0',
      templateDir,
      configDir: cfg,
    }).created.filter(
      (f) =>
        !path.isAbsolute(f) &&
        !f.startsWith('node_modules/') &&
        !f.startsWith('coverage/'),
    );
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

    await buildProgram({ root }).parseAsync(
      ['init', '--core', '^1.0.0', '--config-dir', cfg],
      {
        from: 'user',
      },
    );

    expect(error).toHaveBeenCalledWith(
      expect.stringMatching(/^init: FAILED: .*exact version/s),
    );
    expect(process.exitCode).toBe(1);
  });
});
