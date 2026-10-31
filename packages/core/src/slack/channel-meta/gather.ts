/**
 * @module slack/channel-meta/gather
 *
 * Everything the job knows about one member channel, read-only: its
 * configured home directory and meta, its new messages (core's archive,
 * else `conversations.history`), the sweep's finding, the recent human
 * activity, and the plan for its description and topic. Also the
 * channel's next sweep state (how far it has read, the latest
 * assignment), which the flow saves only on a live run. When the history
 * read stopped at its page cap, the sweep position stays where it was
 * (the next run reads the range again) and the channel is reported; so
 * is a post whose path couldn't be read (by its ts, never its text or
 * the error, which goes to the job's stderr log). A failed read is
 * reported as Slack's method and code, else as an unexpected error
 * (`channel-meta/report-safe`).
 */

import { type ArchiveFs, readArchivedSince } from './archive.js';
import {
  type ChannelMessage,
  compareTs,
  isHumanMessage,
  laterTs,
  tsAt,
} from './messages.js';
import { type ChannelMetaEntity, readMeta } from './meta.js';
import { type FieldPlan, type MetaField, planField } from './plan.js';
import { reportSafeError, stderrWarn } from './report-safe.js';
import type { ChannelMetaSettings } from './settings.js';
import type { ChannelState } from './state.js';
import {
  compareAssignment,
  latestAssignment,
  type SweepFinding,
} from './sweep.js';
import {
  type History,
  MAX_HISTORY_PAGES,
  type MemberChannel,
  type Workspace,
  writeScopeFor,
} from './workspaces.js';

/** What the job knows about one channel. */
export interface ChannelFacts {
  /** The channel. */
  channel: MemberChannel;
  /** Configured home directory. */
  homeDir?: string;
  /** Whether it exists. */
  homeDirExists: boolean;
  /** Its seeded meta. */
  meta?: ChannelMetaEntity;
  /** The sweep's finding. */
  finding?: SweepFinding;
  /** Why the channel's messages couldn't be read (report-safe). */
  readError?: string;
  /** Why the sweep is incomplete (history cut at its page cap, posts
   * whose path couldn't be read); never message text. */
  sweepNotes?: string[];
  /** Messages in the activity window, oldest first. */
  recent: ChannelMessage[];
  /** Newest human message ts in the window. */
  lastHumanTs?: string;
  /** Description and topic plans. */
  plans: Record<MetaField, FieldPlan>;
  /** The channel's state after this run's sweep. */
  next: ChannelState;
}

/** The gatherer's inputs. */
export interface GatherDeps {
  /** File access. */
  io: ArchiveFs;
  /** Archived channel directories by id. */
  archiveDirs: ReadonlyMap<string, string>;
  /** A channel's configured `homeDir`. */
  homeDirOf: (channelId: string) => string | undefined;
  /** `conversations.history` for a channel with no archive. */
  history: (
    ws: Workspace,
    channelId: string,
    since: string | undefined,
  ) => Promise<History>;
}

/** The earlier of two bounds; `undefined` (read everything) wins. */
const earlierBound = (a: string | undefined, b: string): string | undefined =>
  a === undefined ? undefined : compareTs(a, b) <= 0 ? a : b;

/**
 * Gather one channel.
 *
 * @param channel - The member channel.
 * @param ws - Its workspace.
 * @param settings - Job settings.
 * @param state - Its state from earlier runs.
 * @param nowMs - The run's instant.
 * @param deps - Inputs.
 * @returns The facts.
 */
export async function gatherChannel(
  channel: MemberChannel,
  ws: Workspace,
  settings: ChannelMetaSettings,
  state: ChannelState,
  nowMs: number,
  deps: GatherDeps,
): Promise<ChannelFacts> {
  const windowStart = tsAt(nowMs - settings.activityDays * 86_400_000);
  const since = earlierBound(state.sweptTs, windowStart);
  let messages: ChannelMessage[] = [];
  let truncated = false;
  let readError: string | undefined;
  const dir = deps.archiveDirs.get(channel.id);
  try {
    if (dir === undefined)
      ({ messages, truncated } = await deps.history(ws, channel.id, since));
    else messages = readArchivedSince(dir, since, deps.io);
  } catch (e) {
    readError = reportSafeError(e, `reading ${channel.id}`);
  }
  const unswept = messages.filter(
    (m) => state.sweptTs === undefined || compareTs(m.ts, state.sweptTs) > 0,
  );
  const { assignment, failed } = latestAssignment(
    unswept,
    settings.sweepPatterns,
    settings.pathRoots,
    state.assignment,
  );
  const sweepNotes = [
    ...(truncated
      ? [
          `history cut at ${String(MAX_HISTORY_PAGES)} pages: sweep position kept`,
        ]
      : []),
    ...failed.map((f) => {
      stderrWarn(
        `[warn] slack/refresh-channel-meta: post ${f.ts} in ${channel.id}: path unreadable: ${f.error}`,
      );
      return `post ${f.ts}: path unreadable (details in the job log)`;
    }),
  ];
  const homeDir = deps.homeDirOf(channel.id);
  const homeDirExists = homeDir !== undefined && deps.io.exists(homeDir);
  const meta = homeDirExists ? readMeta(homeDir, deps.io.readText) : undefined;
  const recent = messages.filter((m) => compareTs(m.ts, windowStart) >= 0);
  const lastHumanTs = recent.filter(isHumanMessage).at(-1)?.ts;
  const canWrite =
    ws.scopes === undefined ||
    ws.scopes.includes(writeScopeFor(channel.isPrivate));
  const common = { homeDir, homeDirExists, meta, canWrite, lastHumanTs };
  const next: ChannelState = { ...state };
  const sweptTs = truncated
    ? state.sweptTs
    : laterTs(state.sweptTs, messages.at(-1)?.ts);
  if (sweptTs !== undefined) next.sweptTs = sweptTs;
  if (assignment !== undefined) next.assignment = assignment;
  return {
    channel,
    homeDir,
    homeDirExists,
    meta,
    finding: compareAssignment(
      assignment,
      homeDir,
      deps.io.exists,
      settings.pathRoots.host,
    ),
    readError,
    ...(sweepNotes.length > 0 ? { sweepNotes } : {}),
    recent,
    lastHumanTs,
    plans: {
      description: planField({
        ...common,
        field: 'description',
        enabled: settings.updateDescriptions,
        current: channel.purpose,
        previous: state.description,
      }),
      topic: planField({
        ...common,
        field: 'topic',
        enabled: settings.updateTopics,
        current: channel.topic,
        previous: state.topic,
      }),
    },
    next,
  };
}
