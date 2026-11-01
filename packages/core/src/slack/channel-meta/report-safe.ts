/**
 * @module slack/channel-meta/report-safe
 *
 * Errors as the report may carry them. The report file and the Slack
 * summary can go to another workspace than a channel's (`channel-meta/text-scope`),
 * so an error message must not carry a channel's text there: a parser's
 * message quotes its input, a schema's issue paths name record keys
 * (channel ids). A Slack Web API refusal is reported as its method and
 * error code, both checked to be plain tokens; anything else as
 * {@link UNEXPECTED}, its full message written to the job's stderr log
 * only.
 */

import { getErrorMessage } from '@karmaniverous/jeeves';

import { SlackApiError } from '../../lib/slack-client.js';

/** What the report says for an error that isn't a Slack code. */
export const UNEXPECTED = 'unexpected error (details in the job log)';

/** A Slack method or error code: a plain token, nothing quoted. */
const TOKEN = /^[A-Za-z0-9_.]{1,80}$/;

/** Writes a diagnostic to the job's stderr log. */
export type WarnFn = (line: string) => void;

/** {@link WarnFn} over `console.error` (the job's stderr log). */
export const stderrWarn: WarnFn = (line) => {
  console.error(line);
};

/** The Slack refusal in `e`, when it is one with plain tokens. */
const slackRefusal = (e: unknown): SlackApiError | undefined =>
  e instanceof SlackApiError && TOKEN.test(e.method) && TOKEN.test(e.code)
    ? e
    : undefined;

/** {@link UNEXPECTED}, after writing the full message to stderr. */
const unexpected = (e: unknown, context: string, warn: WarnFn): string => {
  warn(`[warn] slack/refresh-channel-meta: ${context}: ${getErrorMessage(e)}`);
  return UNEXPECTED;
};

/**
 * An error as the report may carry it, with the Slack method.
 *
 * @param e - Whatever was thrown.
 * @param context - What failed (a channel id or account, never text),
 *   for the stderr line.
 * @param warn - Where the full message goes (default stderr).
 * @returns `Slack <method> failed: <code>`, or {@link UNEXPECTED}.
 */
export const reportSafeError = (
  e: unknown,
  context: string,
  warn: WarnFn = stderrWarn,
): string => {
  const refusal = slackRefusal(e);
  return refusal === undefined
    ? unexpected(e, context, warn)
    : `Slack ${refusal.method} failed: ${refusal.code}`;
};

/**
 * An error as the report may carry it, Slack's code alone.
 *
 * @param e - Whatever was thrown.
 * @param context - What failed (a channel id or account, never text),
 *   for the stderr line.
 * @param warn - Where the full message goes (default stderr).
 * @returns Slack's error code, or {@link UNEXPECTED}.
 */
export const reportSafeCode = (
  e: unknown,
  context: string,
  warn: WarnFn = stderrWarn,
): string => slackRefusal(e)?.code ?? unexpected(e, context, warn);
