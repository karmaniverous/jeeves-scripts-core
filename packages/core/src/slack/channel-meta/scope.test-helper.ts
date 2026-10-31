/**
 * @module slack/channel-meta/scope.test-helper
 *
 * A two-workspace run for the channel-meta text-scope tests: one
 * seeded channel in `default` (`one`), two in `globex` (`alpha`, `beta`),
 * each with recent human activity, and a worker result with a
 * description and topic for every channel unless overridden; plus
 * readers for the report's field sections and the dry run's preview.
 * Test-only.
 */

import fs from 'node:fs';
import path from 'node:path';

import { vi } from 'vitest';

import { SlackApiError } from '../../lib/slack-client.js';
import type { BlockInput } from './fakes.test-helper.js';
import {
  channel,
  human,
  messageJson,
  ts,
  workspace,
} from './fakes.test-helper.js';
import { META } from './gather.test-helper.js';
import { PREVIEW_FILE } from './refresh.js';
import { harness, NOW_S } from './refresh.test-helper.js';
import type { Workspace } from './workspaces.js';

/** Seeded channels: `one` in `default`, `alpha` and `beta` in `globex`. */
export const CHANNELS = [
  ['default', 'C1', 'one'],
  ['globex', 'CV1', 'alpha'],
  ['globex', 'CV2', 'beta'],
] as const;

/** A worker result with a description and topic for every channel. */
export const RESULT = JSON.stringify({
  channels: Object.fromEntries(
    CHANNELS.map(([, id, name]) => [
      id,
      { description: `Generated ${name} text`, topic: `Now ${name}` },
    ]),
  ),
});

/** Every generated or current value of a `globex` channel. */
export const VC_TEXT = [
  'Generated alpha text',
  'Generated beta text',
  'Now alpha',
  'Now beta',
  'Typed alpha purpose',
];

/** The count line for the `globex` channels in a field section. */
export const VC_COUNT =
  '- 2 channel(s) in `globex` (text not shown outside that workspace)';

/**
 * A run over two workspaces.
 *
 * @param runsRoot - A temp directory for run directories.
 * @param reach - Accounts whose bot can open a DM with the owner.
 * @param block - Extra `slack.channelMeta` keys.
 * @param over - Harness overrides (e.g. the worker's result).
 * @returns The harness.
 */
export const scopeHarness = (
  runsRoot: string,
  reach: readonly string[],
  block: Partial<BlockInput> = {},
  over: Parameters<typeof harness>[1] = {},
): ReturnType<typeof harness> => {
  const workspaces = (): Workspace[] =>
    ['default', 'globex'].map((account) => {
      const ws = workspace(
        account,
        CHANNELS.filter(([a]) => a === account).map(([, id, name]) =>
          channel(id, {
            name,
            account,
            ...(id === 'CV1' ? { purpose: 'Typed alpha purpose' } : {}),
          }),
        ),
      );
      ws.client.openDm = vi.fn(() =>
        reach.includes(account)
          ? Promise.resolve(`D-${account}`)
          : Promise.reject(
              new SlackApiError('conversations.open', 'user_not_found'),
            ),
      );
      // A preview looks the owner up instead of opening the DM.
      ws.client.call = vi.fn((method: string) =>
        method === 'users.info' && reach.includes(account)
          ? Promise.resolve({ user: {} })
          : Promise.reject(new SlackApiError(method, 'user_not_found')),
      );
      return ws;
    });
  return harness(runsRoot, {
    block,
    workspaces,
    result: () => RESULT,
    homeDirOf: (id) => `/home/${id}`,
    files: Object.fromEntries(
      CHANNELS.flatMap(([, id, name]) => [
        [`/home/${id}/.meta/meta.json`, META],
        [
          `/arch/${name} (${id})/${ts(NOW_S - 3600)}.json`,
          messageJson(human(NOW_S - 3600, 'busy')),
        ],
      ]),
    ),
    ...over,
  });
};

/** The report's description and topic sections. */
export const fieldSections = (report: string): string =>
  report.slice(report.indexOf('## Descriptions'));

/** The only run directory under `runsRoot`. */
export const onlyRunDir = (runsRoot: string): string => {
  const [run] = fs.readdirSync(runsRoot);
  return path.join(runsRoot, run ?? '');
};

/** The dry run's preview report. */
export const readPreview = (runsRoot: string): string =>
  fs.readFileSync(path.join(onlyRunDir(runsRoot), PREVIEW_FILE), 'utf8');
