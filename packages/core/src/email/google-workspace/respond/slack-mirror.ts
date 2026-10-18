/**
 * @module respond/slack-mirror
 *
 * Mirrors a sent email-respond reply into Slack, so work done by email
 * is also visible in Slack. Pure decisions plus an injected directory
 * and poster; respond.ts wires the real Slack Web API and gateway.
 *
 * Target rules (owner decision, 2026-10-16):
 * - Default: the sender's DM with the assistant (only the sender sees it).
 * - A channel only when the worker reports the email explicitly asked for
 *   one (`email-slack-channel` block), and only when the channel resolves,
 *   the assistant is a member, and the sender is a member. Otherwise the
 *   DM is used instead.
 * - No Slack user for the sender's email (or no lookup scope): no post.
 * - Declined messages are never mirrored (process.ts only calls this
 *   after a sent reply).
 *
 * Bcc addressees are never shown in the post: a channel audience must not
 * learn who was blind-copied.
 */

import type { ReplyRecipients } from './recipients.js';

/** A resolved Slack channel. */
export interface ResolvedChannel {
  id: string;
  /** Whether the assistant's bot user is a member. */
  isMember: boolean;
}

/** Slack lookups the mirror needs (real implementation in slack-directory.ts). */
export interface SlackDirectory {
  /** Slack user id for an email address; null when no such user. */
  lookupUserByEmail: (email: string) => Promise<string | null>;
  /** Resolve a channel id (`C…`/`G…`) or name (`#name`); null when unknown. */
  resolveChannel: (nameOrId: string) => Promise<ResolvedChannel | null>;
  /** Whether `userId` is a member of `channelId`. */
  isChannelMember: (channelId: string, userId: string) => Promise<boolean>;
}

/** Where to post, or why not. */
export type MirrorTarget =
  | { post: true; target: string; note?: string }
  | { post: false; reason: string };

/**
 * Choose the Slack target for one reply.
 *
 * @param requestedChannel - Channel the worker reported the email asked
 *   for, if any.
 */
export async function chooseMirrorTarget(
  dir: SlackDirectory,
  senderEmail: string,
  requestedChannel?: string,
): Promise<MirrorTarget> {
  const userId = await dir.lookupUserByEmail(senderEmail);
  if (!userId) {
    return { post: false, reason: `no Slack user for ${senderEmail}` };
  }
  const dm = `user:${userId}`;
  if (!requestedChannel) return { post: true, target: dm };
  const toDm = (why: string): MirrorTarget => ({
    post: true,
    target: dm,
    note: `${why}; posted to DM`,
  });

  // The DM is already known: a failed channel check must degrade to it,
  // never to no post at all.
  try {
    const channel = await dir.resolveChannel(requestedChannel);
    if (!channel) {
      return toDm(`requested channel ${requestedChannel} not found`);
    }
    if (!channel.isMember) {
      return toDm(`assistant is not in ${requestedChannel}`);
    }
    if (!(await dir.isChannelMember(channel.id, userId))) {
      return toDm(`sender is not in ${requestedChannel}`);
    }
    return { post: true, target: `channel:${channel.id}` };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return toDm(`could not verify ${requestedChannel} (${msg})`);
  }
}

/** Longest reply body included in the post before truncation. */
export const MAX_MIRROR_BODY = 3000;

/** Inputs for {@link formatMirrorPost}. */
export interface MirrorPostInput {
  subject: string;
  senderEmail: string;
  recipients: ReplyRecipients;
  body: string;
}

/**
 * Format the Slack post: subject, who the reply went to (To/Cc only,
 * never Bcc), then the reply body (truncated past {@link MAX_MIRROR_BODY}).
 */
export function formatMirrorPost(input: MirrorPostInput): string {
  const subject = input.subject.trim() || '(no subject)';
  const lines = [
    `**Email reply:** ${subject}`,
    `From ${input.senderEmail} · reply to: ${input.recipients.to.join(', ')}`,
  ];
  if (input.recipients.cc.length) {
    lines.push(`Cc: ${input.recipients.cc.join(', ')}`);
  }
  const body =
    input.body.length > MAX_MIRROR_BODY
      ? `${input.body.slice(0, MAX_MIRROR_BODY).trimEnd()}\n\n…(truncated; the full reply is in the email thread)`
      : input.body;
  return `${lines.join('\n')}\n\n${body}`;
}

/**
 * Mirror one sent reply: choose the target, format, post.
 *
 * @param send - Posts text to a gateway target (`user:…` / `channel:…`).
 * @returns A one-line outcome for the job log.
 */
export async function mirrorReply(
  dir: SlackDirectory,
  send: (target: string, text: string) => Promise<unknown>,
  input: MirrorPostInput & { slackChannel?: string },
): Promise<string> {
  const { slackChannel, ...post } = input;
  const choice = await chooseMirrorTarget(dir, post.senderEmail, slackChannel);
  if (!choice.post) return `not posted: ${choice.reason}`;
  await send(choice.target, formatMirrorPost(post));
  return `posted to ${choice.target}${choice.note ? ` (${choice.note})` : ''}`;
}

/**
 * Build the mirror's directory without letting Slack setup block email:
 * a disabled mirror, a missing token (factory returns null) or a factory
 * error (e.g. a malformed OpenClaw config) all yield null, logged.
 */
export function initSlackDirectory(
  enabled: boolean,
  factory: () => SlackDirectory | null,
  log: (line: string) => void,
): SlackDirectory | null {
  if (!enabled) return null;
  try {
    const dir = factory();
    if (!dir) log('[email-respond] no Slack bot token; Slack mirror disabled');
    return dir;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`[email-respond] Slack mirror disabled: setup failed: ${msg}`);
    return null;
  }
}
