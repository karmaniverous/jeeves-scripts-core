/**
 * @module respond/reply-contract
 *
 * Parses the worker's final text for the email-respond output contract
 * that `buildRespondTask` (respond/task) asks for: one
 * `email-reply` block, or one `email-no-reply` block when declining is
 * allowed, optionally followed by one `email-slack-channel` block after
 * a reply. Pure, no dependencies.
 */

import {
  NO_REPLY_FENCE_INFO,
  REPLY_FENCE_INFO,
  SLACK_CHANNEL_FENCE_INFO,
} from './task.js';

/** Info strings of the main (reply or decline) contract block. */
const MAIN_FENCES = `${REPLY_FENCE_INFO}|${NO_REPLY_FENCE_INFO}`;

/**
 * A fenced block with one of `infos` (a regex alternation): group 1 is
 * the info string, group 2 the content.
 */
function fencePattern(infos: string, flags = 'g'): RegExp {
  return new RegExp(`\`\`\`(${infos})\\r?\\n([\\s\\S]*?)\`\`\``, flags);
}

/** One fenced contract block found in worker output. */
interface ContractBlock {
  kind: 'reply' | 'no-reply';
  content: string;
}

/** Extract every `email-reply` / `email-no-reply` fenced block. */
function extractBlocks(text: string): ContractBlock[] {
  const pattern = fencePattern(MAIN_FENCES);
  const blocks: ContractBlock[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    blocks.push({
      kind: match[1] === NO_REPLY_FENCE_INFO ? 'no-reply' : 'reply',
      content: match[2] ?? '',
    });
  }
  return blocks;
}

/** Result of {@link parseReplyContract}. */
export type ReplyContractResult =
  | { ok: true; kind: 'reply'; body: string; slackChannel?: string }
  | { ok: true; kind: 'no-reply'; reason: string }
  | { ok: false; reason: string };

/**
 * Parse the worker's final text for the output contract: exactly one
 * `email-reply` block, or (only when `allowNoReply`) exactly one
 * `email-no-reply` block, with non-empty content and nothing around it.
 */
export function parseReplyContract(
  text: string,
  options: { allowNoReply: boolean },
): ReplyContractResult {
  const split = splitSlackChannel(text);
  if (!split.ok) return split;
  const result = parseMainContract(split.rest, options);
  if (!result.ok || split.channel === undefined) return result;
  if (result.kind === 'no-reply') {
    return {
      ok: false,
      reason: `${SLACK_CHANNEL_FENCE_INFO} is only allowed with a reply`,
    };
  }
  return { ...result, slackChannel: split.channel };
}

const SLACK_BLOCK = fencePattern(SLACK_CHANNEL_FENCE_INFO);

/** Slack channel names and ids: optional `#`, no whitespace. */
const SLACK_CHANNEL_VALUE = /^#?[a-z0-9][a-z0-9._-]{0,79}$/i;

/**
 * Detach an optional trailing `email-slack-channel` block from the
 * worker's final text.
 */
function splitSlackChannel(
  text: string,
):
  { ok: true; rest: string; channel?: string } | { ok: false; reason: string } {
  const trimmed = text.trim();
  const matches = [...trimmed.matchAll(SLACK_BLOCK)];
  if (matches.length === 0) return { ok: true, rest: trimmed };
  if (matches.length > 1) {
    return {
      ok: false,
      reason: `more than one ${SLACK_CHANNEL_FENCE_INFO} block in worker reply`,
    };
  }
  const [match] = matches;
  if (!match || match.index + match[0].length !== trimmed.length) {
    return {
      ok: false,
      reason: `${SLACK_CHANNEL_FENCE_INFO} block must come last`,
    };
  }
  const channel = (match[2] ?? '').trim();
  if (!SLACK_CHANNEL_VALUE.test(channel)) {
    return {
      ok: false,
      reason: `${SLACK_CHANNEL_FENCE_INFO} block must hold one channel name or id`,
    };
  }
  return { ok: true, rest: trimmed.slice(0, match.index), channel };
}

/** Parse the reply / decline block (the Slack block already removed). */
function parseMainContract(
  text: string,
  options: { allowNoReply: boolean },
): ReplyContractResult {
  const blocks = extractBlocks(text);
  if (blocks.length === 0) {
    return { ok: false, reason: 'no email-reply fenced block in worker reply' };
  }
  if (blocks.length > 1) {
    return {
      ok: false,
      reason: `${String(blocks.length)} contract fenced blocks in worker reply; expected exactly one`,
    };
  }
  // The whole final reply must be the block: text around it means the
  // worker didn't follow the contract.
  const [only] = text.trim().match(fencePattern(MAIN_FENCES, '')) ?? [''];
  if (only !== text.trim()) {
    return {
      ok: false,
      reason: 'worker reply has text outside the contract fenced block',
    };
  }
  const [block] = blocks;
  if (!block) {
    return { ok: false, reason: 'no email-reply fenced block in worker reply' };
  }
  const content = block.content.trim();
  if (block.kind === 'no-reply') {
    if (!options.allowNoReply) {
      return {
        ok: false,
        reason:
          'email-no-reply is not allowed: the mailbox is the sole To addressee',
      };
    }
    if (!content) {
      return { ok: false, reason: 'email-no-reply block reason is empty' };
    }
    return { ok: true, kind: 'no-reply', reason: content };
  }
  if (!content) {
    return { ok: false, reason: 'email-reply block body is empty' };
  }
  return { ok: true, kind: 'reply', body: content };
}
