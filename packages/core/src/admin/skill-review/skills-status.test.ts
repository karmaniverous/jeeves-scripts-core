/**
 * Tests for the budget's live inputs behind their seams: the one
 * `skills.status` gateway call and its validation, the home directories
 * OpenClaw shortens to `~/`, and measuring with owners named from the
 * inventory.
 */

import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import type { GatewayRpc } from '../../lib/gateway-rpc.js';
import type { InventorySkill } from './inventory.js';
import {
  measureCatalogBudget,
  openclawHomeDirs,
  readSkillsStatus,
  SKILLS_STATUS_METHOD,
  SKILLS_STATUS_WAIT_MS,
} from './skills-status.js';

const HOME = path.resolve('/home/me');
const FILE = path.join(HOME, 'skills', 'a', 'SKILL.md');

const REPORT = {
  workspaceDir: '/w',
  agentId: 'main',
  skills: [
    {
      name: 'a',
      description: 'd'.repeat(200),
      source: 'openclaw-extra',
      filePath: FILE,
      modelVisible: true,
      eligible: true,
    },
  ],
};

const rpc = (result: unknown) =>
  vi.fn<GatewayRpc>(() => Promise.resolve(result));

describe('readSkillsStatus', () => {
  it("makes the one gateway call and validates the gateway's report", async () => {
    const call = rpc(REPORT);
    await expect(readSkillsStatus(call)).resolves.toMatchObject({
      agentId: 'main',
      skills: [{ name: 'a', filePath: FILE }],
    });
    expect(call).toHaveBeenCalledExactlyOnceWith('skills.status', {});
    expect(SKILLS_STATUS_METHOD).toBe('skills.status');
    expect(SKILLS_STATUS_WAIT_MS).toBe(60_000);
  });

  it.each([
    ['a string', 'Gateway not reachable'],
    ['the wrong shape', { agentId: 'main' }],
  ])('throws on %s', async (_case, result) => {
    await expect(readSkillsStatus(rpc(result))).rejects.toThrow();
  });
});

describe('openclawHomeDirs', () => {
  const real = (p: string) => p;
  const os = () => path.resolve('/os-home');

  it('prefers HOME, then USERPROFILE, then the OS home, plus the OS home', () => {
    expect(
      openclawHomeDirs({ HOME: '/h', USERPROFILE: '/u' }, os, real),
    ).toEqual([path.resolve('/h'), path.resolve('/os-home')]);
    expect(
      openclawHomeDirs({ HOME: ' ', USERPROFILE: '/u' }, os, real),
    ).toEqual([path.resolve('/u'), path.resolve('/os-home')]);
    expect(
      openclawHomeDirs({ HOME: 'undefined', USERPROFILE: 'null' }, os, real),
    ).toEqual([path.resolve('/os-home')]);
  });

  it('adds real paths and skips ones that cannot be resolved', () => {
    const realpath = (p: string) => {
      if (p === path.resolve('/h')) return path.resolve('/real-h');
      throw new Error('ENOENT');
    };
    expect(openclawHomeDirs({ HOME: '/h' }, os, realpath)).toEqual([
      path.resolve('/h'),
      path.resolve('/os-home'),
      path.resolve('/real-h'),
    ]);
  });

  it('works without an OS home', () => {
    expect(openclawHomeDirs({}, () => '', real)).toEqual([]);
  });
});

describe('measureCatalogBudget', () => {
  const inventory: InventorySkill[] = [
    {
      name: 'a',
      description: '',
      file: FILE,
      origin: 'workshop',
      bytes: 1,
      text: '',
    },
  ];

  it('measures the report against the config, owners from the inventory', async () => {
    const budget = await measureCatalogBudget(
      {
        rpc: rpc(REPORT),
        openclawConfig: { skills: { limits: { maxSkillsPromptChars: 1000 } } },
        homeDirs: [HOME],
      },
      inventory,
    );
    expect(budget).toMatchObject({
      maxChars: 1000,
      skills: 1,
      longest: [{ name: 'a', chars: 200, owner: 'workshop' }],
    });
  });

  it('propagates a failed gateway call', async () => {
    await expect(
      measureCatalogBudget(
        {
          rpc: () => Promise.reject(new Error('gateway closed')),
          openclawConfig: undefined,
          homeDirs: [],
        },
        [],
      ),
    ).rejects.toThrow('gateway closed');
  });
});
