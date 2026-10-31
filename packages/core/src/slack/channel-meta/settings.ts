/**
 * @module slack/channel-meta/settings
 *
 * The runnable's settings from the validated `slack.channelMeta` block
 * (`config/slack-schema`, which applies every default and checks every
 * key's type and bounds, so `config check` reports a broken block), plus
 * what only the run can know: the report target when `reportChannel` is
 * unset (the OpenClaw command owner's DM, `channel-meta/owner`), the
 * report directory when `outputDir` is unset (the report channel's
 * `slack.channels.<id>.homeDir`), and whether each directory is absolute
 * on this host (`channel-meta/paths`: a drive path on Windows, a `/` path
 * on POSIX). A problem is returned as `{ problem }`, naming the key; a
 * run then fails (Decision 76) and `doctor` reports it. Pure apart from
 * the injected readers.
 */

import { defaultReportDir } from '../../config/slack-channel-meta-schema.js';
import type { SlackChannelMetaBlock } from '../../config/slack-schema.js';
import {
  canonicalAbsolute,
  type PathRoots,
  type PlatformPath,
} from './paths.js';

/** Where the block lives, for messages. */
export const BLOCK = 'slack.channelMeta';

/** The resolved settings. */
export interface ChannelMetaSettings {
  /** Summary target id: a channel, a DM conversation, or a user (their DM). */
  reportChannel: string;
  /** Where the target came from. */
  reportChannelSource: 'config' | 'owner';
  /** The posting bot's gateway account; unset: found from the target (`channel-meta/post`). */
  reportAccount?: string;
  /** Accounts whose channels' text the report may show; unset: the report target's account alone (`channel-meta/text-scope`). */
  reportTextAccounts?: string[];
  /** Absolute directory for the dated report files. */
  outputDir: string;
  /** Where `outputDir` came from. */
  outputDirSource: 'config' | 'homeDir';
  /** IANA zone for the report date. */
  timeZone: string;
  /** jeeves-server machine key name. */
  serverKeyName: string;
  /** Description cap. */
  descriptionMaxChars: number;
  /** Topic cap. */
  topicMaxChars: number;
  /** Recent-message window in days. */
  activityDays: number;
  /** Worker batch cap. */
  maxChannels: number;
  /** Channel ids left out. */
  exclude: ReadonlySet<string>;
  /** Set descriptions. */
  updateDescriptions: boolean;
  /** Set topics. */
  updateTopics: boolean;
  /** Path roots for the sweep, with the host's path style. */
  pathRoots: PathRoots;
  /** Sweep patterns (case-insensitive). */
  sweepPatterns: RegExp[];
}

/** What the run adds to the block (live: OpenClaw's config, `slack.channels`, `node:path`). */
export interface SettingsDeps {
  /** The OpenClaw command owner's Slack user id (`channel-meta/owner`). */
  slackOwner: () => string | undefined;
  /** A channel's configured `homeDir`. */
  channelHomeDir: (channelId: string) => string | undefined;
  /** The host's path style. */
  host: PlatformPath;
}

/** A user id: the summary goes to their DM. */
export const isUserTarget = (id: string): boolean => /^[UW]/.test(id);

/** A DM conversation id (`D…`): not among any workspace's member channels, so `channel-meta/post` looks it up. */
export const isDmTarget = (id: string): boolean => id.startsWith('D');

/** A settings problem, stopping the resolver. */
class SettingsProblem extends Error {}

const problem = (message: string): never => {
  throw new SettingsProblem(message);
};

/** `dir` absolute on this host, else a problem naming `key`. */
const onHost = (dir: string, key: string, host: PlatformPath): string =>
  canonicalAbsolute(dir, host) === undefined
    ? problem(`${key} must be absolute on this host: ${dir}`)
    : dir;

/** The summary target: the configured one, else the OpenClaw owner's DM. */
const reportTarget = (
  block: SlackChannelMetaBlock,
  deps: SettingsDeps,
): Pick<ChannelMetaSettings, 'reportChannel' | 'reportChannelSource'> => {
  if (block.reportChannel !== undefined)
    return {
      reportChannel: block.reportChannel,
      reportChannelSource: 'config',
    };
  const owner = deps.slackOwner();
  if (owner === undefined)
    return problem(
      `no report target: set ${BLOCK}.reportChannel (a Slack channel id, or a user id for their DM), or add a "slack:<user id>" entry to commands.ownerAllowFrom in the OpenClaw config`,
    );
  return { reportChannel: owner, reportChannelSource: 'owner' };
};

/** The report directory: `outputDir`, else the report channel's `homeDir`. */
const reportDir = (
  block: SlackChannelMetaBlock,
  target: string,
  deps: SettingsDeps,
): Pick<ChannelMetaSettings, 'outputDir' | 'outputDirSource'> => {
  if (block.outputDir !== undefined)
    return {
      outputDir: onHost(block.outputDir, `${BLOCK}.outputDir`, deps.host),
      outputDirSource: 'config',
    };
  // The config check applies the same rule (Decision 76).
  const dir = defaultReportDir(target, deps.channelHomeDir);
  if ('problem' in dir) return problem(dir.problem);
  return {
    outputDir: onHost(
      dir.homeDir,
      `slack.channels.${target}.homeDir`,
      deps.host,
    ),
    outputDirSource: 'homeDir',
  };
};

/** The sweep's path roots, in the host's path style (segments lower-cased). */
const pathRootsOf = (
  block: SlackChannelMetaBlock,
  host: PlatformPath,
): PathRoots => {
  const roots = Object.fromEntries(
    Object.entries(block.pathRoots).map(([segment, dir]) => [
      segment.toLowerCase(),
      onHost(dir, `${BLOCK}.pathRoots.${segment}`, host),
    ]),
  );
  return block.relativeRoot === undefined
    ? { roots, host }
    : {
        roots,
        relativeRoot: onHost(block.relativeRoot, `${BLOCK}.relativeRoot`, host),
        host,
      };
};

/**
 * Resolve the settings.
 *
 * @param block - The validated `slack.channelMeta` block.
 * @param deps - Run-time readers and the host's path style.
 * @returns The settings, or the reason they are incomplete.
 */
export function resolveSettings(
  block: SlackChannelMetaBlock,
  deps: SettingsDeps,
): ChannelMetaSettings | { problem: string } {
  try {
    const target = reportTarget(block, deps);
    return {
      ...target,
      ...(block.reportAccount === undefined
        ? {}
        : { reportAccount: block.reportAccount }),
      ...(block.reportTextAccounts === undefined
        ? {}
        : { reportTextAccounts: block.reportTextAccounts }),
      ...reportDir(block, target.reportChannel, deps),
      timeZone: block.timezone,
      serverKeyName: block.serverKey,
      descriptionMaxChars: block.descriptionMaxChars,
      topicMaxChars: block.topicMaxChars,
      activityDays: block.activityDays,
      maxChannels: block.maxChannels,
      exclude: new Set(block.excludeChannels),
      updateDescriptions: block.updateDescriptions,
      updateTopics: block.updateTopics,
      pathRoots: pathRootsOf(block, deps.host),
      sweepPatterns: block.sweepPatterns.map((s) => new RegExp(s, 'i')),
    };
  } catch (e) {
    if (e instanceof SettingsProblem) return { problem: e.message };
    throw e;
  }
}
