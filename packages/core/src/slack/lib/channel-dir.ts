/**
 * @module slack/lib/channel-dir
 *
 * The directory a Slack channel's messages are written to:
 * `{silo}/slack/{name} ({id})`, where the silo comes from the channel's
 * workspace (`getBasePathForSlackWorkspace`). A channel renamed in Slack
 * has its existing directory renamed to match.
 */

import fs from 'node:fs';
import path from 'node:path';

import { getChannelWorkspace } from '@karmaniverous/jeeves';

import { getBasePathForSlackWorkspace } from '../../config/index.js';
import { constants } from '../../lib/constants.js';

/** The channel's message directory, renaming an existing `* ({id})` directory to the current name. */
export async function resolveChannelDir(
  channelId: string,
  channelName: string,
  token: string,
): Promise<string> {
  const teamId = await getChannelWorkspace(channelId, token, {
    cachePath: constants().SLACK_WORKSPACE_CACHE_PATH,
    defaultWorkspace: constants().PRIMARY_WORKSPACE,
  });
  const basePath = getBasePathForSlackWorkspace(teamId);
  const slackRoot = path.join(basePath, 'slack');
  const targetDirName = `${channelName} (${channelId})`;
  const targetDir = path.join(slackRoot, targetDirName);

  if (fs.existsSync(slackRoot)) {
    const suffix = `(${channelId})`;
    for (const entry of fs.readdirSync(slackRoot)) {
      if (entry.endsWith(suffix) && entry !== targetDirName) {
        const oldDir = path.join(slackRoot, entry);
        fs.renameSync(oldDir, targetDir);
        console.log(`RENAMED: ${entry} -> ${targetDirName}`);
        return targetDir;
      }
    }
  }

  return targetDir;
}
