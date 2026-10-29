import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  installChange,
  skillsDirFor,
  uninstallChange,
} from './skills-change.js';

const root = path.resolve('/repo');
const dir = skillsDirFor(root);
const SKILLS = ['jeeves-email', 'jeeves-x'];
const envPath = (s: string) => `skills.entries.${s}.env.JEEVES_SCRIPTS_DIR`;

describe('install / uninstall changes', () => {
  it('install adds the folder and every env var, keeping other entries', () => {
    const change = installChange({
      root,
      skills: SKILLS,
      config: { load: { extraDirs: ['/other'] } },
    });
    expect(change).toEqual({
      sets: [
        { path: 'skills.load.extraDirs', value: ['/other', dir] },
        { path: envPath('jeeves-email'), value: root },
        { path: envPath('jeeves-x'), value: root },
      ],
      unsets: [],
    });
  });

  it('install is idempotent', () => {
    const config = {
      load: { extraDirs: [dir] },
      entries: {
        'jeeves-email': { env: { JEEVES_SCRIPTS_DIR: root } },
        'jeeves-x': { env: { JEEVES_SCRIPTS_DIR: root } },
      },
    };
    expect(installChange({ root, skills: SKILLS, config })).toEqual({
      sets: [],
      unsets: [],
    });
  });

  it("uninstall removes exactly this repo's entries", () => {
    const config = {
      load: { extraDirs: ['/other', dir] },
      entries: {
        'jeeves-email': { env: { JEEVES_SCRIPTS_DIR: root, KEEP: 'x' } },
        'jeeves-x': { env: { JEEVES_SCRIPTS_DIR: '/another-repo' } },
      },
    };
    expect(uninstallChange({ root, skills: SKILLS, config })).toEqual({
      sets: [{ path: 'skills.load.extraDirs', value: ['/other'] }],
      unsets: [envPath('jeeves-email')],
    });
    expect(
      uninstallChange({
        root,
        skills: [],
        config: { load: { extraDirs: [dir] } },
      }),
    ).toEqual({ sets: [], unsets: ['skills.load'] });
  });

  it('uninstall leaves no empty objects behind', () => {
    const config = {
      load: { extraDirs: [dir], watch: true },
      entries: {
        'jeeves-email': { env: { JEEVES_SCRIPTS_DIR: root }, enabled: true },
        'jeeves-x': { env: { JEEVES_SCRIPTS_DIR: root } },
        other: { env: { TOKEN: 'x' } },
      },
    };
    expect(uninstallChange({ root, skills: SKILLS, config })).toEqual({
      sets: [],
      unsets: [
        'skills.load.extraDirs',
        'skills.entries.jeeves-email.env',
        'skills.entries.jeeves-x',
      ],
    });
    const { other: _other, ...ours } = config.entries;
    expect(
      uninstallChange({
        root,
        skills: SKILLS,
        config: {
          entries: {
            ...ours,
            'jeeves-email': { env: { JEEVES_SCRIPTS_DIR: root } },
          },
        },
      }),
    ).toEqual({ sets: [], unsets: ['skills.entries'] });
  });
});
