/**
 * @module slack/channel-meta/survey
 *
 * The run's read-only pass: every member channel of every workspace
 * (`channel-meta/workspaces`, excluded channels left out) gathered in reading
 * order (`channel-meta/gather`: sweep, coverage, description and topic plans),
 * the fields that need text (`channel-meta/apply-result`), and the next state
 * with each channel's sweep position. Reads only; the state is returned,
 * not saved.
 */

import { type Wanted, wantedOf } from './apply-result.js';
import { type ArchiveFs, indexArchive } from './archive.js';
import { type ChannelFacts, gatherChannel, type GatherDeps } from './gather.js';
import type { ChannelMetaSettings } from './settings.js';
import type { JobState } from './state.js';
import { memberChannels, type Workspace } from './workspaces.js';

/** What the survey reads. */
export interface SurveyDeps {
  /** Archive roots (`<silo>/slack`). */
  archiveRoots: () => string[];
  /** File access. */
  io: ArchiveFs;
  /** A channel's configured `homeDir`. */
  homeDirOf: (channelId: string) => string | undefined;
  /** History fallback. */
  history: GatherDeps['history'];
}

/** What the survey found. */
export interface Survey {
  /** Per-channel facts, in reading order. */
  facts: ChannelFacts[];
  /** Fields that need text, per channel, in reading order. */
  wanted: Wanted[];
  /** The state with every surveyed channel's new sweep position. */
  next: JobState;
}

/**
 * Survey every member channel.
 *
 * @param workspaces - Every workspace read.
 * @param settings - The job's settings.
 * @param state - The loaded state.
 * @param now - The run's clock reading.
 * @param deps - Readers.
 * @returns Facts, wanted fields and the next state.
 */
export async function surveyChannels(
  workspaces: readonly Workspace[],
  settings: ChannelMetaSettings,
  state: JobState,
  now: Date,
  deps: SurveyDeps,
): Promise<Survey> {
  const gatherDeps: GatherDeps = {
    io: deps.io,
    archiveDirs: indexArchive(deps.archiveRoots(), deps.io),
    homeDirOf: deps.homeDirOf,
    history: deps.history,
  };
  const facts: ChannelFacts[] = [];
  const wanted: Wanted[] = [];
  const next: JobState = { ...state, channels: { ...state.channels } };
  for (const { channel, ws } of memberChannels(workspaces, settings.exclude)) {
    const f = await gatherChannel(
      channel,
      ws,
      settings,
      state.channels[channel.id] ?? {},
      now.getTime(),
      gatherDeps,
    );
    facts.push(f);
    wanted.push(...wantedOf(f, ws));
    next.channels[channel.id] = f.next;
  }
  return { facts, wanted, next };
}
