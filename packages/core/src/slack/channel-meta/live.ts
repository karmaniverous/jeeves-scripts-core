/**
 * @module slack/channel-meta/live
 *
 * The live side effects of `slack-refresh-channel-meta`: every gateway
 * Slack account's workspace (bot tokens from the OpenClaw config), the
 * `slack.channelMeta` block and `slack.channels` from the instance
 * config, the OpenClaw command owner, the Slack archive's entity
 * directories, the state and run directories under
 * `{stateDir}/slack/channel-meta/`, the worker dispatch (no Slack post
 * targets; `channel-meta/worker-batch`), the report file
 * (`lib/dated-report`), its insider link (`lib/server-link`) and the
 * summary post (`channel-meta/post`).
 */

import path from 'node:path';

import { getErrorMessage } from '@karmaniverous/jeeves';

import {
  getLoadedConfigPath,
  loadConfig,
  resolveConfig,
} from '../../config/loader.js';
import { paths } from '../../config/paths.js';
import type { Config } from '../../config/schema.js';
import { getEntityDirs } from '../../config/silo-router.js';
import { deliverReport } from '../../lib/dated-report.js';
import { slackBotTokens } from '../../lib/openclaw-config.js';
import { liveReportLink } from '../../lib/server-link.js';
import { createSlackClient } from '../../lib/slack-client.js';
import { dispatchWithSlack } from '../../lib/worker-slack/run.js';
import { applyField } from './apply.js';
import { nodeArchiveFs } from './archive.js';
import { readSlackOwner } from './owner.js';
import { findDestination, postSummary } from './post.js';
import type { RefreshDeps } from './refresh.js';
import {
  type ChannelMetaSettings,
  resolveSettings,
  type SettingsDeps,
} from './settings.js';
import { loadState, saveState } from './state.js';
import {
  readHistory,
  readWorkspace,
  scopeCapturingFetch,
  type Workspace,
} from './workspaces.js';

/** The runnable's id (and the worker's job id). */
export const JOB_ID = 'slack-refresh-channel-meta';

/** The report link's title. */
export const REPORT_TITLE = 'Slack channel meta report';

/** Accounts in reading order: `default` first, then by name. */
export const accountOrder = (accounts: readonly string[]): string[] =>
  [...accounts].sort((a, b) =>
    a === 'default' ? -1 : b === 'default' ? 1 : a.localeCompare(b),
  );

/** Read every gateway Slack account's workspace. */
export async function liveWorkspaces(): Promise<Workspace[]> {
  const secrets = slackBotTokens();
  const out: Workspace[] = [];
  for (const account of accountOrder(Object.keys(secrets))) {
    const capture = scopeCapturingFetch((input, init) => fetch(input, init));
    const client = createSlackClient({
      token: secrets[account] ?? '',
      fetch: capture.fetch,
    });
    out.push(await readWorkspace(account, client, capture.scopes));
  }
  return out;
}

/** A channel's configured `homeDir`. */
const homeDirOf = (id: string): string | undefined =>
  loadConfig().slack.channels[id]?.homeDir;

/** Live readers for the settings. */
export const liveSettingsDeps = (): SettingsDeps => ({
  slackOwner: readSlackOwner,
  channelHomeDir: homeDirOf,
  slackAccounts: () => Object.keys(slackBotTokens()),
  host: path,
});

/** Why the runnable skips: no `slack.channelMeta` block. */
export const NO_BLOCK = 'no slack.channelMeta block in the instance config';

/**
 * The instance config, or why there is none to read: no config can be
 * located or read (no pointer, environment or repo file; a pointer to a
 * missing file). A config that is found but invalid throws (Decision 76:
 * an invalid config, the `slack.channelMeta` block included, fails the
 * run).
 */
const readableConfig = (): Config | { skip: string } => {
  if (getLoadedConfigPath() === null)
    try {
      resolveConfig();
    } catch (e) {
      return { skip: `no loadable instance config (${getErrorMessage(e)})` };
    }
  return loadConfig();
};

/**
 * The settings from the instance config, why the runnable skips (no
 * loadable config, or no `slack.channelMeta` block), or the problem.
 *
 * @returns The settings, `{ skip }` or `{ problem }`.
 * @throws When a config is found but invalid.
 */
export const liveSettings = ():
  ChannelMetaSettings | { problem: string } | { skip: string } => {
  const config = readableConfig();
  if ('skip' in config) return config;
  const block = config.slack.channelMeta;
  return block === undefined
    ? { skip: NO_BLOCK }
    : resolveSettings(block, liveSettingsDeps());
};

/** Live side effects. */
export const liveRefreshDeps = (): RefreshDeps => {
  const root = path.join(paths().stateDir, 'slack', 'channel-meta');
  const stateFile = path.join(root, 'state.json');
  return {
    settings: () => {
      const settings = liveSettings();
      return 'skip' in settings ? { problem: settings.skip } : settings;
    },
    workspaces: liveWorkspaces,
    archiveRoots: () => getEntityDirs('slack'),
    io: nodeArchiveFs,
    homeDirOf,
    history: (ws, id, since) => readHistory(ws.client, id, since),
    loadState: () => loadState(stateFile),
    saveState: (state) => {
      saveState(stateFile, state);
    },
    runsRoot: path.join(root, 'runs'),
    now: () => new Date(),
    dispatch: (task, flags) =>
      dispatchWithSlack(task, { jobId: JOB_ID, thinking: 'low' }, {}, flags),
    apply: (ws, id, field, text) => applyField(ws.client, id, field, text),
    reportLink: liveReportLink(REPORT_TITLE),
    deliver: deliverReport,
    destination: findDestination,
    post: postSummary,
    log: (line) => {
      console.log(line);
    },
  };
};
