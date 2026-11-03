/**
 * Tests for origin classification: by the innermost package on the path,
 * else by root kind, and the jeeves-tools workspace rule.
 */

import { describe, expect, it } from 'vitest';

import {
  classifyOrigin,
  embeddedSkillNames,
  packageOf,
  type SkillOrigin,
  type SkillRootKind,
} from './origins.js';

const TOOLS = new Set(['tools-skill']);

describe('packageOf', () => {
  it.each([
    ['/g/node_modules/openclaw/skills/x/SKILL.md', 'openclaw'],
    [
      'C:\\g\\node_modules\\@karmaniverous\\jeeves\\skills\\x',
      '@karmaniverous/jeeves',
    ],
    [
      '/g/node_modules/@karmaniverous/jeeves-tools/node_modules/@karmaniverous/jeeves/skills/x',
      '@karmaniverous/jeeves',
    ],
    ['/home/me/skills/x/SKILL.md', undefined],
  ])('%s is in %s', (file, pkg) => {
    expect(packageOf(file)).toBe(pkg);
  });
});

describe('classifyOrigin', () => {
  it.each<[string, SkillRootKind, string, SkillOrigin]>([
    [
      '/s/agents/a/agent/workshop-skills/x/SKILL.md',
      'workshop',
      'x',
      'workshop',
    ],
    // A Workshop root wins even inside a package path.
    ['/g/node_modules/openclaw/w/x/SKILL.md', 'workshop', 'x', 'workshop'],
    [
      '/g/node_modules/@karmaniverous/jeeves/skills/x/SKILL.md',
      'extra',
      'x',
      'jeeves',
    ],
    [
      '/r/node_modules/@karmaniverous/jeeves-scripts-core/skills/x/SKILL.md',
      'extra',
      'x',
      'jeeves-scripts-core',
    ],
    [
      '/g/node_modules/@karmaniverous/jeeves-tools/skills/x/SKILL.md',
      'extra',
      'x',
      'jeeves-tools',
    ],
    [
      '/g/node_modules/openclaw/skills/x/SKILL.md',
      'bundled',
      'x',
      'openclaw-bundled',
    ],
    ['/s/plugin-skills/x/SKILL.md', 'plugin', 'x', 'plugin'],
    ['/g/node_modules/other-plugin/skills/x/SKILL.md', 'plugin', 'x', 'plugin'],
    ['/odd/skills/x/SKILL.md', 'bundled', 'x', 'openclaw-bundled'],
    [
      '/ws/skills/tools-skill/SKILL.md',
      'workspace',
      'tools-skill',
      'jeeves-tools',
    ],
    ['/ws/skills/mine/SKILL.md', 'workspace', 'mine', 'local'],
    ['/s/skills/tools-skill/SKILL.md', 'managed', 'tools-skill', 'local'],
    ['/elsewhere/x/SKILL.md', 'extra', 'x', 'local'],
  ])('%s (%s) is %s', (file, kind, name, origin) => {
    expect(classifyOrigin(file, kind, name, TOOLS)).toBe(origin);
  });
});

describe('embeddedSkillNames', () => {
  it('finds each escaped frontmatter name once', () => {
    const source = [
      'var a = "---\\nname: jeeves-admin\\ndescription: x";',
      'var b = \'---\\nname: "tools-e2e"\\ndescription: y\';',
      'var c = "---\\nname: jeeves-admin\\n";',
      'var d = "name: not-frontmatter";',
    ].join('\n');
    expect(embeddedSkillNames(source)).toEqual(['jeeves-admin', 'tools-e2e']);
  });
});
