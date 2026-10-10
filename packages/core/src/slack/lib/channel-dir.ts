/**
 * @module slack/lib/channel-dir
 *
 * The directory a Slack channel's messages are written to:
 * `{silo}/slack/{name} ({id})`, where the silo comes from the channel's
 * workspace (channel-workspace, then `getBasePathForSlackWorkspace`). A
 * channel renamed in Slack has its existing directory renamed to match.
 */

import fs from 'node:fs';
import path from 'node:path';

import { getBasePathForSlackWorkspace } from '../../config/index.js';
import type { ChannelInfo } from './channel-info.js';
import { channelTeamId } from './channel-workspace.js';

/** The channel's message directory (workspace from `teams`, account → team), renaming an existing `* ({id})` directory to the current name. */
export async function resolveChannelDir(
  channelId: string,
  channelInfo: ChannelInfo,
  token: string,
  teams: Record<string, string>,
): Promise<string> {
  const teamId = await channelTeamId(channelId, channelInfo, token, teams);
  const basePath = getBasePathForSlackWorkspace(teamId);
  const slackRoot = path.join(basePath, 'slack');
  const targetDirName = `${channelInfo.name} (${channelId})`;
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
