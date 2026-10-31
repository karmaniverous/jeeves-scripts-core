/**
 * @module slack/channel-meta/fakes.test-helper
 *
 * Fakes for the channel-meta tests: an in-memory {@link ArchiveFs}
 * (files by path, directories implied), a scripted Slack client that
 * records calls, and builders for settings, channels, workspaces and
 * report inputs.
 * Test-only.
 */

import path from 'node:path';

import { vi } from 'vitest';
import type { z } from 'zod';

import {
  type SlackChannelMetaBlock,
  slackChannelMetaSchema,
} from '../../config/slack-schema.js';
import type { SlackClient } from '../../lib/slack-client.js';
import type { ArchiveFs } from './archive.js';
import type { ChannelFacts } from './gather.js';
import type { ChannelMessage } from './messages.js';
import type { PlatformPath } from './paths.js';
import type { FieldPlan } from './plan.js';
import type { ReportInput } from './report-input.js';
import {
  type ChannelMetaSettings,
  resolveSettings,
  type SettingsDeps,
} from './settings.js';
import type { MemberChannel, Workspace } from './workspaces.js';

const norm = (p: string): string => path.resolve(p);

/**
 * An in-memory file system.
 *
 * @param files - File texts by path.
 * @returns The port.
 */
export function memoryArchiveFs(files: Record<string, string>): ArchiveFs {
  const byPath = new Map(
    Object.entries(files).map(([p, text]) => [norm(p), text]),
  );
  const isDir = (p: string): boolean => {
    const base = norm(p) + path.sep;
    return [...byPath.keys()].some((k) => k.startsWith(base));
  };
  return {
    readdir: (dir) => {
      if (!isDir(dir)) return undefined;
      const base = norm(dir) + path.sep;
      const names = new Set<string>();
      for (const k of byPath.keys())
        if (k.startsWith(base))
          names.add(k.slice(base.length).split(path.sep)[0] ?? '');
      return [...names].sort();
    },
    readText: (file) => byPath.get(norm(file)),
    exists: (p) => byPath.has(norm(p)) || isDir(p),
  };
}

/** A message file's JSON. */
export const messageJson = (m: ChannelMessage): string => JSON.stringify(m);

/** Slack ts `n` seconds after the epoch. */
export const ts = (seconds: number): string => `${String(seconds)}.000100`;

/** A person's message. */
export const human = (
  seconds: number,
  text: string,
  user = 'U0PERSON',
): ChannelMessage => ({
  ts: ts(seconds),
  user,
  text,
  userName: { alias: 'A Person', is_bot: false },
});

/** A bot's message. */
export const bot = (seconds: number, text: string): ChannelMessage => ({
  ts: ts(seconds),
  user: 'U0BOT',
  botId: 'B0BOT',
  text,
  userName: { name: 'bot', is_bot: true },
});

/** The keys a `slack.channelMeta` block always needs. */
export const REQUIRED = { timezone: 'UTC', serverKey: 'scripts' };

/** What every test block starts from (the required keys, a user target). */
export const BASE = { ...REQUIRED, reportChannel: 'U0OWNER' };

/** A `slack.channelMeta` block as written in the config. */
export type BlockInput = z.input<typeof slackChannelMetaSchema>;

/**
 * A validated block (defaults applied), as the loader gives it.
 *
 * @param input - The block as written.
 * @returns The parsed block.
 */
export const blockOf = (input: BlockInput): SlackChannelMetaBlock =>
  slackChannelMetaSchema.parse(input);

/**
 * Run-time readers: no OpenClaw owner, no channel `homeDir`, a Windows
 * host, unless overridden.
 *
 * @param over - Reader overrides.
 * @returns The readers.
 */
export const settingsDeps = (
  over: Partial<SettingsDeps> = {},
): SettingsDeps => ({
  slackOwner: () => undefined,
  channelHomeDir: () => undefined,
  host: path.win32,
  ...over,
});

/**
 * Resolve settings from a block as written (see {@link settingsDeps}).
 *
 * @param input - The block.
 * @param over - Reader overrides.
 * @returns The settings or the problem.
 */
export const resolveWith = (
  input: BlockInput,
  over: Partial<SettingsDeps> = {},
): ReturnType<typeof resolveSettings> =>
  resolveSettings(blockOf(input), settingsDeps(over));

/** A resolution's problem, or `(no problem)`. */
export const problemOf = (s: ReturnType<typeof resolveSettings>): string =>
  'problem' in s ? s.problem : '(no problem)';

/**
 * Settings from a block, failing the test when they are incomplete. The
 * report directory defaults to an absolute one in the host style.
 *
 * @param input - Keys over {@link BASE}.
 * @param host - The host's path style (default `path.win32`).
 * @returns The settings.
 */
export function settingsFrom(
  input: Partial<BlockInput> = {},
  host: PlatformPath = path.win32,
): ChannelMetaSettings {
  const resolved = resolveWith(
    {
      ...BASE,
      outputDir: host === path.win32 ? 'C:/out' : '/out',
      ...input,
    },
    { host },
  );
  if ('problem' in resolved) throw new Error(resolved.problem);
  return resolved;
}

/** A member channel. */
export const channel = (
  id: string,
  over: Partial<MemberChannel> = {},
): MemberChannel => ({
  id,
  name: id.toLowerCase(),
  isPrivate: false,
  purpose: '',
  topic: '',
  account: 'default',
  ...over,
});

/** Scripted responses by Slack method. */
export type SlackScript = Record<
  string,
  (
    params: Record<string, unknown>,
  ) => Record<string, unknown> | Promise<Record<string, unknown>>
>;

/**
 * A Slack client answering from a script; unscripted methods throw.
 *
 * @param script - Responses by method.
 * @returns The client and its recorded calls.
 */
export function scriptedSlack(script: SlackScript): {
  client: SlackClient;
  calls: { method: string; params: Record<string, unknown> }[];
} {
  const calls: { method: string; params: Record<string, unknown> }[] = [];
  const answer = async (method: string, params: Record<string, unknown>) => {
    calls.push({ method, params });
    const fn = script[method];
    if (!fn) throw new Error(`unscripted Slack call ${method}`);
    return fn(params);
  };
  const client: SlackClient = {
    call: (method, params = {}) => answer(method, params),
    post: (method, body) => answer(method, body),
    postMessage: vi.fn(() => Promise.resolve({ channel: 'C', ts: '1.1' })),
    openDm: vi.fn(() => Promise.resolve('D0DM')),
    uploadFile: vi.fn(() => Promise.resolve('F')),
    download: vi.fn(() => Promise.resolve(new Response(''))),
  };
  return { client, calls };
}

/** A workspace with channels and a client that answers only `users.info`. */
export const workspace = (
  account: string,
  channels: MemberChannel[],
  over: Partial<Workspace> = {},
): Workspace => ({
  account,
  channels,
  // Its bot knows every user (a preview's read-only owner lookup).
  client: scriptedSlack({ 'users.info': () => ({ user: {} }) }).client,
  ...over,
});

/** A field plan with nothing to do. */
export const FRESH: FieldPlan = { action: 'skip', reason: 'fresh' };

/** Channel content a report or summary must never carry. */
export const SECRETS = [
  'SECRET PURPOSE',
  'SECRET TOPIC',
  'SECRET META',
  'SECRET MESSAGE',
];

/** Every scope the job needs. */
export const ALL_SCOPES = [
  'channels:read',
  'groups:read',
  'channels:write.topic',
  'groups:write.topic',
];

/** A channel's facts, its content made of {@link SECRETS}. */
export const reportFacts = (
  id: string,
  over: Partial<ChannelFacts> = {},
): ChannelFacts => ({
  channel: channel(id, { purpose: 'SECRET PURPOSE', topic: 'SECRET TOPIC' }),
  homeDir: `/h/${id}`,
  homeDirExists: true,
  meta: { file: 'm', content: 'SECRET META' },
  recent: [human(1, 'SECRET MESSAGE')],
  plans: { description: FRESH, topic: FRESH },
  next: {},
  ...over,
});

/** Report inputs: one workspace, one fresh channel. */
export const reportInput = (over: Partial<ReportInput> = {}): ReportInput => ({
  date: '2026-10-22',
  preview: false,
  workspaces: [
    workspace('default', [channel('C1')], {
      team: 'Acme & Co',
      scopes: ALL_SCOPES,
    }),
  ],
  facts: [reportFacts('C1')],
  outcomes: [],
  enabled: { description: true, topic: true },
  textAccounts: new Set(['default']),
  ...over,
});
