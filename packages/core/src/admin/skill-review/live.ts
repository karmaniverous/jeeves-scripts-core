/**
 * @module admin/skill-review/live
 *
 * The live side effects of `admin-review-skill-proposals`: the
 * `skillReview` block and `slack.channels` from the instance config, the
 * gateway's `skill_workshop` tool (`lib/gateway-client`), the skill roots
 * and OpenClaw's own config (OpenClaw's state directory,
 * `openclawStateDirs`; the global `openclaw` package,
 * `admin/lib/resolve-openclaw-dist`), the gateway's `skills.status`
 * (`lib/gateway-rpc`), the run directories under
 * `{stateDir}/admin/skill-review/runs/`, the worker dispatch (no Slack post
 * targets), the report's insider link (`lib/server-link`) and the summary
 * post (`reportAccount`'s bot).
 */

import os from 'node:os';
import path from 'node:path';

import { getErrorMessage } from '@karmaniverous/jeeves';

import { loadConfig } from '../../config/loader.js';
import { paths } from '../../config/paths.js';
import { readableConfig } from '../../config/readable-config.js';
import { gatewayInvoke } from '../../lib/gateway-client.js';
import { gatewayRpc, resolveOpenClawCli } from '../../lib/gateway-rpc.js';
import {
  findInOpenclawConfig,
  openclawStateDirs,
  slackBotToken,
  slackBotTokens,
} from '../../lib/openclaw-config.js';
import { liveReportLink } from '../../lib/server-link.js';
import { createSlackClient } from '../../lib/slack-client.js';
import { dispatchWithSlack } from '../../lib/worker-slack/run.js';
import { resolveOpenClawDist } from '../lib/resolve-openclaw-dist.js';
import { readInventory } from './inventory.js';
import { gatherProposals } from './proposals.js';
import { type ReviewDeps, SCRIPT_NAME } from './review.js';
import {
  resolveSettings,
  type SettingsDeps,
  type SkillReviewSettings,
} from './settings.js';
import { nodeSkillFs } from './skill-fs.js';
import {
  liveHomeDirs,
  measureCatalogBudget,
  SKILLS_STATUS_WAIT_MS,
} from './skills-status.js';

/** The runnable's id (and the worker's job id). */
export const JOB_ID = 'admin-review-skill-proposals';

/** The report link's title. */
export const REPORT_TITLE = 'Skill Workshop review';

/** Why the runnable skips: no `skillReview` block. */
export const NO_BLOCK = 'no skillReview block in the instance config';

/** Live readers for the settings. */
export const liveSettingsDeps = (): SettingsDeps => ({
  channelHomeDir: (id) => loadConfig().slack.channels[id]?.homeDir,
  slackAccounts: () => Object.keys(slackBotTokens()),
  isAbsolute: (p) => path.isAbsolute(p),
});

/**
 * The settings from the instance config, why the runnable skips (no
 * loadable config, or no `skillReview` block), or the problem.
 *
 * @returns The settings, `{ skip }` or `{ problem }`.
 * @throws When a config is found but invalid.
 */
export const liveSettings = ():
  SkillReviewSettings | { problem: string } | { skip: string } => {
  const config = readableConfig();
  if ('skip' in config) return config;
  const block = config.skillReview;
  return block === undefined
    ? { skip: NO_BLOCK }
    : resolveSettings(block, liveSettingsDeps());
};

/**
 * The global npm `node_modules` holding the `openclaw` package (the
 * package root is the dist's parent), or `undefined` with a warning when
 * it can't be found: the inventory then has no bundled or jeeves-tools
 * skills.
 *
 * @param resolveDist - The dist resolver (live: `resolveOpenClawDist`).
 * @param log - Warning sink.
 * @returns The directory.
 */
export function globalModulesDir(
  resolveDist: () => string,
  log: (line: string) => void,
): string | undefined {
  try {
    return path.dirname(path.dirname(resolveDist()));
  } catch (e) {
    log(
      `[warn] ${SCRIPT_NAME}: no global openclaw package, so no bundled or jeeves-tools skills: ${getErrorMessage(e)}`,
    );
    return undefined;
  }
}

/** Log sink. */
const log = (line: string): void => {
  console.log(line);
};

/** Live side effects. */
export const liveReviewDeps = (): ReviewDeps => {
  const [stateDir] = openclawStateDirs();
  const openclawConfig = (): unknown => findInOpenclawConfig((c) => c);
  return {
    settings: () => {
      const settings = liveSettings();
      return 'skip' in settings ? { problem: settings.skip } : settings;
    },
    gatherProposals: () =>
      gatherProposals({ invoke: gatewayInvoke, fs: nodeSkillFs, stateDir }),
    readInventory: () =>
      readInventory({
        fs: nodeSkillFs,
        stateDir,
        globalModulesDir: globalModulesDir(resolveOpenClawDist, log),
        homeDir: os.homedir(),
        openclawConfig: openclawConfig(),
      }),
    catalogBudget: (inventory) =>
      measureCatalogBudget(
        {
          rpc: (method, params) =>
            gatewayRpc(method, params, resolveOpenClawCli(), {
              waitMs: SKILLS_STATUS_WAIT_MS,
            }),
          openclawConfig: openclawConfig(),
          homeDirs: liveHomeDirs(),
        },
        inventory,
      ),
    runsRoot: path.join(paths().stateDir, 'admin', 'skill-review', 'runs'),
    now: () => new Date(),
    dispatch: (task, flags) =>
      dispatchWithSlack(task, { jobId: JOB_ID, thinking: 'medium' }, {}, flags),
    readText: (file) => nodeSkillFs.readText(file),
    reportLink: liveReportLink(REPORT_TITLE),
    postToSlack: async (channel, text, account) => {
      await createSlackClient({ token: slackBotToken(account) }).postMessage(
        channel,
        text,
      );
    },
    log,
  };
};
