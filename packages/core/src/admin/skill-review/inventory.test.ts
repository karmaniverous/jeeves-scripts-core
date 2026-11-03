/**
 * Tests for the skill inventory: root discovery from OpenClaw's config and
 * layout, origins by package and root kind, and the jeeves-tools names.
 */

import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  type InventoryEnv,
  jeevesToolsSkillNames,
  readInventory,
  skillRoots,
} from './inventory.js';
import { memorySkillFs, skillText } from './skill-fs.test-helper.js';

const S = path.resolve('/state');
const G = path.resolve('/global/node_modules');
const CORE = path.resolve(
  '/repo/node_modules/@karmaniverous/jeeves-scripts-core/skills',
);
const WS = path.resolve('/ws');
const HOME = path.resolve('/home/me');

const files = {
  [`${S}/agents/main/agent/workshop-skills/wk/SKILL.md`]: {
    text: skillText('wk', 'Workshop one'),
    mtimeMs: 42,
  },
  [`${S}/agents/main/agent/workshop-skills/no-skill-file/notes.md`]: 'x',
  [`${S}/agents/other/agent/workshop-skills/wk2/SKILL.md`]: '# no frontmatter',
  [`${CORE}/jeeves-email/SKILL.md`]: skillText('jeeves-email', 'Email'),
  [`${G}/@karmaniverous/jeeves/skills/jeeves-design/SKILL.md`]: skillText(
    'jeeves-design',
    'Design',
  ),
  [`${S}/plugin-skills/slack/SKILL.md`]: skillText('slack', 'Slack'),
  [`${S}/skills/managed-one/SKILL.md`]: skillText('managed-one', 'Managed'),
  [`${WS}/skills/jeeves-admin/SKILL.md`]: skillText('jeeves-admin', 'Admin'),
  // Named by its frontmatter, not its directory.
  [`${WS}/skills/my-own-dir/SKILL.md`]: skillText('my-own', 'Mine'),
  [`${G}/openclaw/skills/github/SKILL.md`]: skillText('github', 'GitHub'),
  [`${G}/openclaw/custodian-skills/doctor/SKILL.md`]: skillText(
    'doctor',
    'Doctor',
  ),
  [`${G}/openclaw/dist/skills.js`]: '',
  [`${G}/@karmaniverous/jeeves-tools/dist/cli/index.js`]:
    'var s = "---\\nname: jeeves-admin\\ndescription: x";',
  [`${G}/@karmaniverous/jeeves-tools/dist/cli/README.md`]:
    '"---\\nname: not-js\\n"',
};

const env = (openclawConfig: unknown): InventoryEnv => ({
  fs: memorySkillFs(files),
  stateDir: S,
  globalModulesDir: G,
  homeDir: HOME,
  openclawConfig,
});

/** Root dirs relative to `/`, with `/` separators. */
const relDirs = (config: unknown): string[] =>
  skillRoots(env(config)).map((r) =>
    path.relative(path.resolve('/'), r.dir).replaceAll('\\', '/'),
  );

const CONFIG = {
  skills: {
    load: {
      extraDirs: [CORE, path.join(G, '@karmaniverous', 'jeeves', 'skills')],
    },
  },
  agents: {
    defaults: { workspace: WS },
    list: [{ id: 'x', workspace: WS }, { id: 'y' }],
  },
};

describe('skillRoots', () => {
  it('finds every root kind once', () => {
    const roots = skillRoots(env(CONFIG)).map((r) => [
      path.relative(path.resolve('/'), r.dir).replaceAll('\\', '/'),
      r.kind,
    ]);
    expect(roots).toEqual([
      ['state/agents/main/agent/workshop-skills', 'workshop'],
      ['state/agents/other/agent/workshop-skills', 'workshop'],
      ['repo/node_modules/@karmaniverous/jeeves-scripts-core/skills', 'extra'],
      ['global/node_modules/@karmaniverous/jeeves/skills', 'extra'],
      ['state/skills', 'managed'],
      ['state/plugin-skills', 'plugin'],
      ['ws/skills', 'workspace'],
      ['state/workspace/skills', 'workspace'],
      ['global/node_modules/openclaw/custodian-skills', 'bundled'],
      ['global/node_modules/openclaw/skills', 'bundled'],
    ]);
  });

  it('expands ~ in configured roots and workspaces', () => {
    const dirs = relDirs({
      skills: { load: { extraDirs: ['~/shared/skills', '~', '~x/skills'] } },
      agents: { defaults: { workspace: `~${path.sep}ws` } },
    });
    expect(dirs).toContain('home/me/shared/skills');
    expect(dirs).toContain('home/me');
    expect(dirs).toContain('home/me/ws/skills');
    // `~user` is not the home directory: left as configured.
    expect(dirs).toContain(
      path
        .relative(path.resolve('/'), path.resolve('~x/skills'))
        .replaceAll('\\', '/'),
    );
  });

  describe('on a case-sensitive platform', () => {
    const platform = process.platform;
    afterEach(() => {
      Object.defineProperty(process, 'platform', { value: platform });
    });

    it('keeps roots that differ only by case', () => {
      Object.defineProperty(process, 'platform', { value: 'linux' });
      const extraDirs = [path.resolve('/skills/A'), path.resolve('/skills/a')];
      const dirs = relDirs({ skills: { load: { extraDirs } } });
      expect(dirs).toContain('skills/A');
      expect(dirs).toContain('skills/a');
    });
  });

  it.each([
    ['no config', undefined],
    ['an invalid config', { skills: { load: { extraDirs: 'nope' } } }],
  ])('falls back to the layout defaults with %s', (_label, config) => {
    expect(skillRoots(env(config)).map((r) => r.kind)).toEqual([
      'workshop',
      'workshop',
      'managed',
      'plugin',
      'workspace',
      'bundled',
      'bundled',
    ]);
  });
});

describe('jeevesToolsSkillNames', () => {
  it('reads names embedded in the built jeeves-tools modules', () => {
    expect([...jeevesToolsSkillNames(env(CONFIG))]).toEqual(['jeeves-admin']);
  });
});

describe('without a global modules dir (no openclaw package found)', () => {
  const bare = (): InventoryEnv => ({
    ...env(CONFIG),
    globalModulesDir: undefined,
  });

  it('skips the bundled and jeeves-tools roots, keeping the rest', () => {
    expect(skillRoots(bare()).map((r) => r.kind)).toEqual([
      'workshop',
      'workshop',
      'extra',
      'extra',
      'managed',
      'plugin',
      'workspace',
      'workspace',
    ]);
    expect(jeevesToolsSkillNames(bare()).size).toBe(0);
  });
});

describe('readInventory', () => {
  it('reads every skill with its origin, sorted by name', () => {
    const inventory = readInventory(env(CONFIG));
    expect(inventory.map((s) => [s.name, s.origin])).toEqual([
      ['doctor', 'openclaw-bundled'],
      ['github', 'openclaw-bundled'],
      ['jeeves-admin', 'jeeves-tools'],
      ['jeeves-design', 'jeeves'],
      ['jeeves-email', 'jeeves-scripts-core'],
      ['managed-one', 'local'],
      ['my-own', 'local'],
      ['slack', 'plugin'],
      ['wk', 'workshop'],
      ['wk2', 'workshop'],
    ]);
    const wk = inventory.find((s) => s.name === 'wk');
    expect(wk).toMatchObject({ description: 'Workshop one', mtimeMs: 42 });
    expect(wk?.bytes).toBe(Buffer.byteLength(wk?.text ?? ''));
    expect(inventory.find((s) => s.name === 'wk2')?.description).toBe('');
  });

  it('sorts same-named skills by origin', () => {
    const dup = memorySkillFs({
      [`${S}/plugin-skills/same/SKILL.md`]: skillText('same', 'p'),
      [`${S}/skills/same/SKILL.md`]: skillText('same', 'l'),
    });
    const inventory = readInventory({ ...env(undefined), fs: dup });
    expect(inventory.map((s) => s.origin)).toEqual(['local', 'plugin']);
  });
});
