/**
 * Session-refresh fixtures: gateway session rows in the shape OpenClaw
 * 2026.9.6 returns from `sessions.list` and `sessions.describe` (pinned
 * from a real response, every key, id, name and account replaced with a
 * neutral value; only a few of each row's many fields kept, unknown ones
 * included to prove they pass through), and builders for test rows.
 */

import type { LastTurnUsage } from './openclaw-db/types.js';
import type { SessionRow } from './session-refresh-gateway.js';

/** The fixture clock: 2026-11-03 12:00 UTC. */
export const NOW = Date.UTC(2026, 10, 3, 12, 0, 0);

/** `n` minutes before {@link NOW}. */
export const minutesAgo = (n: number): number => NOW - n * 60_000;

const placement = {
  state: 'local',
  generation: 0,
  createdAtMs: 1_790_000_000_000,
  updatedAtMs: 1_790_000_100_000,
  stateChangedAtMs: 1_790_000_000_000,
};

/** A Slack channel session row, as listed. */
export const SLACK_CHANNEL_ROW = {
  key: 'agent:main:slack:channel:c0000000001',
  visibility: 'shared',
  kind: 'group',
  classification: 'channel',
  agentId: 'main',
  isMain: false,
  channel: 'slack',
  chatType: 'channel',
  origin: {
    label: '#example',
    provider: 'slack',
    surface: 'slack',
    chatType: 'channel',
    from: 'slack:channel:C0000000001',
    to: 'channel:C0000000001',
    nativeChannelId: 'C0000000001',
    accountId: 'work',
  },
  deliveryContext: {
    channel: 'slack',
    to: 'channel:C0000000001',
    accountId: 'work',
  },
  lastChannel: 'slack',
  lastTo: 'channel:C0000000001',
  lastAccountId: 'work',
  archived: false,
  lastInteractionAt: minutesAgo(120),
  lastActivityAt: minutesAgo(180),
  updatedAt: minutesAgo(100),
  sessionId: '00000000-0000-4000-8000-000000000001',
  inputTokens: 242,
  outputTokens: 896,
  totalTokens: 283_032,
  status: 'done',
  placement,
  hasActiveRun: false,
  activeRunIds: [],
};

/** An agent's main session row, as listed (no `lastActivityAt`, no channel). */
export const MAIN_ROW = {
  key: 'agent:main:main',
  kind: 'direct',
  classification: 'main',
  agentId: 'main',
  isMain: true,
  chatType: 'direct',
  archived: false,
  lastInteractionAt: minutesAgo(240),
  updatedAt: minutesAgo(200),
  sessionId: '00000000-0000-4000-8000-000000000002',
  totalTokens: 473_817,
  status: 'done',
  placement,
  hasActiveRun: false,
  activeRunIds: [],
};

/** A Slack DM row: the native channel is the IM (`D…`), the target the user. */
export const SLACK_DM_ROW = {
  key: 'agent:main:slack:direct:u0000000003',
  kind: 'direct',
  classification: 'direct',
  agentId: 'main',
  channel: 'slack',
  chatType: 'direct',
  origin: {
    provider: 'slack',
    to: 'user:U0000000003',
    nativeChannelId: 'D0000000003',
    accountId: 'default',
    chatType: 'direct',
  },
  deliveryContext: {
    channel: 'slack',
    to: 'user:U0000000003',
    accountId: 'default',
  },
  archived: false,
  lastInteractionAt: minutesAgo(90),
  sessionId: '00000000-0000-4000-8000-000000000003',
  placement,
  hasActiveRun: false,
  activeRunIds: [],
};

/** A subagent row (spawn lineage). */
export const SUBAGENT_ROW = {
  key: 'agent:main:subagent:00000000-0000-4000-8000-0000000000aa',
  kind: 'direct',
  classification: 'subagent',
  agentId: 'main',
  archived: false,
  lastInteractionAt: minutesAgo(500),
  sessionId: '00000000-0000-4000-8000-000000000004',
  placement,
  hasActiveRun: false,
  activeRunIds: [],
  spawnedBy: 'agent:main:main',
  parentSessionKey: 'agent:main:main',
  spawnDepth: 1,
  subagentRole: 'leaf',
};

/** `sessions.describe` for the main session: the row without the activity fields. */
export const MAIN_DESCRIBE = {
  session: {
    key: 'agent:main:main',
    visibility: 'shared',
    kind: 'direct',
    classification: 'main',
    agentId: 'main',
    lastInteractionAt: minutesAgo(240),
    sessionId: '00000000-0000-4000-8000-000000000002',
    placement,
    totalTokens: 473_817,
  },
};

/** The first page of a two-page list. */
export const LIST_PAGE_1 = {
  ts: NOW,
  path: '(multiple)',
  count: 2,
  totalCount: 4,
  limitApplied: 2,
  nextOffset: 2,
  hasMore: true,
  owners: [],
  defaults: { modelProvider: 'anthropic' },
  sessions: [SLACK_CHANNEL_ROW, MAIN_ROW],
};

/** The last page. */
export const LIST_PAGE_2 = {
  ...LIST_PAGE_1,
  nextOffset: undefined,
  hasMore: false,
  sessions: [SLACK_DM_ROW, SUBAGENT_ROW],
};

/** A test row: an idle, local, top-level session listed with `overrides`. */
export const row = (overrides: Partial<SessionRow> = {}): SessionRow => ({
  key: 'agent:main:slack:channel:c0000000009',
  sessionId: 'sid-9',
  agentId: 'main',
  hasActiveRun: false,
  activeRunIds: [],
  lastInteractionAt: minutesAgo(120),
  placement: { state: 'local' },
  ...overrides,
});

/** A last turn: `context` tokens split as given (default all cache read), at `ts`. */
export const turn = (
  split: Partial<LastTurnUsage> = {},
  tsMs = minutesAgo(120),
): LastTurnUsage => ({
  input: 0,
  cacheRead: 0,
  cacheWrite: 0,
  tsMs,
  ...split,
});
