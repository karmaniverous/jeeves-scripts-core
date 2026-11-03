/**
 * @module admin/skill-review/skills-status
 *
 * The live inputs of the catalog budget: the gateway's own
 * `skills.status` report for its default agent, read through core's
 * `lib/gateway-rpc` (`gatewayRpc('skills.status', {})`: the `openclaw`
 * CLI under the current Node binary, no shell; the report carries each
 * skill's SKILL.md path, which `openclaw skills list --json` omits), and
 * the home directories OpenClaw shortens to `~/` (`HOME`, else
 * `USERPROFILE`, else the OS home; plus the OS home and their real
 * paths). The RPC is a {@link GatewayRpc} seam; reads nothing else.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { GatewayRpc } from '../../lib/gateway-rpc.js';
import {
  analyzeCatalogBudget,
  type CatalogBudget,
  type SkillsStatus,
  skillsStatusSchema,
} from './catalog-budget.js';
import type { InventorySkill } from './inventory.js';
import { pathKey } from './skill-fs.js';

/** The gateway method that reports the skills. */
export const SKILLS_STATUS_METHOD = 'skills.status';

/** How long the CLI waits for the gateway's `skills.status` answer. */
export const SKILLS_STATUS_WAIT_MS = 60_000;

/**
 * The gateway's `skills.status` report.
 *
 * @param rpc - Gateway RPC seam.
 * @returns The validated report.
 * @throws When the call fails or returns something else.
 */
export async function readSkillsStatus(rpc: GatewayRpc): Promise<SkillsStatus> {
  return skillsStatusSchema.parse(await rpc(SKILLS_STATUS_METHOD, {}));
}

const usable = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim();
  return trimmed && trimmed !== 'undefined' && trimmed !== 'null'
    ? trimmed
    : undefined;
};

/**
 * The home directories OpenClaw shortens to `~/` in skill locations.
 *
 * @param env - The environment.
 * @param homedir - The OS home lookup.
 * @param realpath - A real-path lookup (throws when missing).
 * @returns Absolute directories, deduplicated.
 */
export function openclawHomeDirs(
  env: NodeJS.ProcessEnv,
  homedir: () => string,
  realpath: (p: string) => string,
): string[] {
  const native = usable(homedir());
  const homes = [usable(env.HOME) ?? usable(env.USERPROFILE) ?? native, native]
    .filter((h): h is string => h !== undefined)
    .map((h) => path.resolve(h));
  const real = homes.flatMap((h) => {
    try {
      return [realpath(h)];
    } catch {
      return [];
    }
  });
  return [...new Set([...homes, ...real])];
}

/** The live home directories. */
export const liveHomeDirs = (): string[] =>
  openclawHomeDirs(process.env, os.homedir, (p) => fs.realpathSync(p));

/** What the live budget reads. */
export interface CatalogBudgetEnv {
  /** Gateway RPC seam. */
  rpc: GatewayRpc;
  /** The parsed `openclaw.json`. */
  openclawConfig: unknown;
  /** Home directories (see {@link openclawHomeDirs}). */
  homeDirs: readonly string[];
}

/**
 * Measure the live catalog, naming owners from the skill inventory.
 *
 * @param env - Live inputs.
 * @param inventory - The review's skill inventory.
 * @returns The budget.
 * @throws When the report can't be read or the limits are malformed.
 */
export async function measureCatalogBudget(
  env: CatalogBudgetEnv,
  inventory: readonly InventorySkill[],
): Promise<CatalogBudget> {
  const status = await readSkillsStatus(env.rpc);
  const origins = new Map(inventory.map((s) => [pathKey(s.file), s.origin]));
  return analyzeCatalogBudget({
    status,
    openclawConfig: env.openclawConfig,
    homeDirs: env.homeDirs,
    originOf: (file) => origins.get(pathKey(file)),
  });
}
