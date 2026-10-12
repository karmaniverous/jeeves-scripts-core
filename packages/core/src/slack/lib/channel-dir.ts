/**
 * @module slack/lib/channel-dir
 *
 * The directory a Slack channel's messages are written to:
 * `{silo}/slack/{name} ({id})`, where the silo comes from the channel's
 * workspace (channel-workspace, then `getBasePathForSlackWorkspace`). A
 * channel renamed in Slack has its existing directory renamed to match;
 * when that rename fails (e.g. `EPERM` while another process holds the
 * directory open) the existing directory is kept and a warning logged.
 */

import fs from 'node:fs';
import path from 'node:path';

import { getBasePathForSlackWorkspace } from '../../config/index.js';
import type { ChannelInfo } from './channel-info.js';
import { channelTeamId } from './channel-workspace.js';

/** A system error's string `code`, else the error's message. */
const errorCode = (err: unknown): string => {
  if (!(err instanceof Error)) return String(err);
  return 'code' in err && typeof err.code === 'string' ? err.code : err.message;
};

/**
 * The directory for channel `channelId` under `slackRoot`, named
 * `targetDirName`. An existing `* ({id})` directory under another name is
 * renamed to the target; if the rename fails for any reason, the existing
 * directory is returned (with a warning) so messages keep going where
 * they always have. When the target already exists it is used as is and
 * any other `* ({id})` directory is left in place.
 */
function channelDirFor(
  slackRoot: string,
  channelId: string,
  targetDirName: string,
): string {
  const targetDir = path.join(slackRoot, targetDirName);
  if (!fs.existsSync(slackRoot) || fs.existsSync(targetDir)) return targetDir;

  const suffix = `(${channelId})`;
  const entry = fs.readdirSync(slackRoot).find((e) => e.endsWith(suffix));
  if (entry === undefined) return targetDir;

  const oldDir = path.join(slackRoot, entry);
  try {
    fs.renameSync(oldDir, targetDir);
  } catch (err) {
    console.warn(
      `WARN ${channelId}: could not rename "${entry}" -> "${targetDirName}" (${errorCode(err)}); keeping "${entry}"`,
    );
    return oldDir;
  }
  console.log(`RENAMED: ${entry} -> ${targetDirName}`);
  return targetDir;
}

/** The channel's message directory (workspace from `teams`, account → team), renaming an existing `* ({id})` directory to the current name when it can and keeping it when it can't. */
export async function resolveChannelDir(
  channelId: string,
  channelInfo: ChannelInfo,
  token: string,
  teams: Record<string, string>,
): Promise<string> {
  const teamId = await channelTeamId(channelId, channelInfo, token, teams);
  const basePath = getBasePathForSlackWorkspace(teamId);
  return channelDirFor(
    path.join(basePath, 'slack'),
    channelId,
    `${channelInfo.name} (${channelId})`,
  );
}
