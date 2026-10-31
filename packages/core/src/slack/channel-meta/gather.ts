/**
 * @module slack/channel-meta/gather
 *
 * Everything the job knows about one member channel, read-only: its
 * configured home directory and meta, its new messages (core's archive,
 * else `conversations.history`), the sweep's finding, the recent human
 * activity, and the plan for its description and topic. Also the
 * channel's next sweep state (how far it has read, the latest
 * assignment), which the flow saves only on a live run. When the history
 * read stops at its page cap ({@link readHistoryFallback}), the sweep
 * position still moves to the newest message read, so a busy channel
 * makes progress every run instead of re-reading the same pages, and the
 * channel is reported; so is a post whose path couldn't be read (by its ts, never its text or
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

/** What the history fallback read, and how far that sweeps. */
interface HistoryRead {
  /** Messages read, oldest first. */
  messages: ChannelMessage[];
  /** The newest message the sweep may count as read, if any. */
  sweptTo?: string;
  /** Why the read is incomplete, if it is. */
  note?: string;
}

const CUT = `history cut at ${String(MAX_HISTORY_PAGES)} pages`;

/** `a` and `b` merged by ts (one copy each), oldest first. */
const mergeByTs = (
  a: readonly ChannelMessage[],
  b: readonly ChannelMessage[],
): ChannelMessage[] =>
  [...new Map([...a, ...b].map((m) => [m.ts, m])).values()].sort((x, y) =>
    compareTs(x.ts, y.ts),
  );

/**
 * Read a channel with no archive from `since`, never stuck on its page
 * cap (`channel-meta/workspaces` `readHistory`):
 *
 * - no bound (no sweep position yet): Slack serves the newest pages
 *   first, so a cut read holds the newest messages; the sweep moves to
 *   the newest one, and older history is never swept (the latest
 *   assignment is what counts);
 * - a bound: Slack pages forward from it, so a cut read is contiguous
 *   from `since` and the sweep moves to the newest message read. When
 *   the sweep position was already past that (the bound was the
 *   activity window), a second capped read from the sweep position
 *   gets the newest messages, so the sweep and the topic's recent
 *   messages still advance; the messages in between were swept before.
 *
 * @param read - The history reader for this channel.
 * @param since - The read's bound (the earlier of the sweep position and
 *   the activity window).
 * @param sweptTs - The sweep position.
 * @returns What was read and how far it sweeps.
 */
export async function readHistoryFallback(
  read: (since: string | undefined) => Promise<History>,
  since: string | undefined,
  sweptTs: string | undefined,
): Promise<HistoryRead> {
  const first = await read(since);
  const newest = first.messages.at(-1)?.ts;
  if (!first.truncated) return { messages: first.messages, sweptTo: newest };
  if (since === undefined)
    return {
      messages: first.messages,
      sweptTo: newest,
      note: `${CUT}: only the newest messages read; older history not swept`,
    };
  if (
    sweptTs === undefined ||
    newest === undefined ||
    compareTs(sweptTs, newest) <= 0
  )
    return {
      messages: first.messages,
      sweptTo: newest,
      note: `${CUT}: swept up to the newest message read; the next run reads on from there`,
    };
  const second = await read(sweptTs);
  return {
    messages: mergeByTs(first.messages, second.messages),
    sweptTo: second.messages.at(-1)?.ts,
    note: second.truncated
      ? `${CUT} twice: swept up to the newest message read; the next run reads on from there`
      : `${CUT}: part of the activity window not read; every new message swept`,
  };
}

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
  let sweptTo: string | undefined;
  let historyNote: string | undefined;
  let readError: string | undefined;
  const dir = deps.archiveDirs.get(channel.id);
  try {
    if (dir === undefined)
      ({
        messages,
        sweptTo,
        note: historyNote,
      } = await readHistoryFallback(
        (bound) => deps.history(ws, channel.id, bound),
        since,
        state.sweptTs,
      ));
    else {
      messages = readArchivedSince(dir, since, deps.io);
      sweptTo = messages.at(-1)?.ts;
    }
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
    ...(historyNote === undefined ? [] : [historyNote]),
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
  const sweptTs = laterTs(state.sweptTs, sweptTo);
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
