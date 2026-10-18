/**
 * @module email/google-workspace/respond
 *
 * Assistant-mailbox auto-reply (runner job `email-respond`). Discovers
 * recent inbox messages in `emailConfig.respond.mailbox`, decides
 * deterministically which ones qualify (respond/qualify.ts: allowed
 * sender, mailbox in To, DKIM, not automated, under the thread cap), and
 * for each runs one LLM worker session that handles the message as a
 * request from that sender. When the mailbox shares To with others, the
 * worker first decides whether a reply is needed at all. This script, not
 * the worker, sends the reply: in the same thread, from the mailbox, to
 * every original To/Cc/Bcc addressee (respond/recipients.ts). With
 * `emailConfig.respond.slackMirror` (default off; needs the
 * `users:read.email` bot scope) each sent reply is also
 * posted to Slack (respond/slack-mirror.ts): the sender's DM, or a channel
 * the email explicitly asked for when the sender is a member. See
 * guides/email.md, "Auto-reply (email-respond)". Gmail only: the mailbox
 * must be a `gmail` account (replies go out through `gog gmail send`).
 *
 * Flags: `--dry-run` (or `emailConfig.respond.dryRun`, or
 * `emailConfig.reportOnly`): discovery and qualification only; no
 * dispatch, no send, no labels, no Slack post, no state writes.
 *
 * Exits non-zero when a message fails permanently, so the runner records
 * the run as an error.
 *
 * Known limitation: a crash between sending a reply and recording it in
 * runner state can send that reply twice on the next run.
 *
 * Config dependencies: `pipeline.emailConfig.respond` (jeeves-scripts.json),
 * `constants().SPAWN_WORKER_PATH`; runner state namespace `email-respond`.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { nowIso } from '@karmaniverous/jeeves';
import {
  dispatchSession,
  getRunnerClient,
  type RunnerClient,
} from '@karmaniverous/jeeves-runner';

import { pipeline, type PipelineConfig } from '../../config/index.js';
import { defineJob } from '../../jobs/define-job.js';
import { argFlag } from '../../lib/args.js';
import { constants } from '../../lib/constants.js';
import { gatewayInvoke } from '../../lib/gateway-client.js';
import { gatewayRpc } from '../../lib/gateway-rpc.js';
import { gogWithRetry } from '../../lib/gog.js';
import { readWorkerFinalText } from '../../lib/worker-output.js';
import { gatewaySlackIo } from '../../lib/worker-slack/slack-io.js';
import { type GogRunner } from './gmail-search.js';
import {
  type CandidateMessage,
  discoverCandidateThreadIds,
  fetchThreadCandidates,
  parseThreadForTask,
  threadFullArgs,
} from './respond/candidates.js';
import { runEmailRespond } from './respond/orchestrate.js';
import type { RunDeps } from './respond/process.js';
import { resolveDryRun } from './respond/run-mode.js';
import { LabelsListResponseSchema, parseJsonWith } from './respond/schemas.js';
import { liveSlackDirectory } from './respond/slack-directory.js';
import {
  initSlackDirectory,
  mirrorReply,
  type SlackDirectory,
} from './respond/slack-mirror.js';
import {
  getMessageState,
  recordThreadReply,
  setMessageState,
  threadReplyCountSince,
} from './respond/state.js';

/** gog with a short retry, as the other Gmail jobs use. */
const liveGog: GogRunner = (args) =>
  gogWithRetry(args, { retries: 1, backoffMs: 3000 });

/** What {@link emailRespond} reads and calls (seams for tests). */
export interface EmailRespondEnv {
  /** The `pipeline` block. */
  pipeline: () => Pick<PipelineConfig, 'emailConfig'>;
  /** gog. */
  gog: GogRunner;
  /** Runner state. */
  runnerClient: () => RunnerClient;
  /** Worker dispatch. */
  dispatch: RunDeps['dispatch'];
  /** The worker's final text. */
  readFinalText: RunDeps['readFinalText'];
  /** Slack Web API lookups for the mirror (
ull: no token). */
  slackDirectory: () => SlackDirectory | null;
  /** Slack post through the gateway. */
  slackSend: (target: string, text: string) => Promise<unknown>;
  /** Clock. */
  now: () => string;
  /** Log sink. */
  log: (line: string) => void;
}

/** The live environment. */
export const emailRespondEnv = (): EmailRespondEnv => {
  const slack = gatewaySlackIo(gatewayInvoke);
  return {
    pipeline,
    gog: liveGog,
    runnerClient: getRunnerClient,
    dispatch: (task) =>
      dispatchSession(
        task,
        { jobId: 'email-respond', thinking: 'low' },
        constants().SPAWN_WORKER_PATH,
      ),
    readFinalText: (stdout) => readWorkerFinalText(stdout, gatewayRpc),
    slackDirectory: liveSlackDirectory,
    slackSend: (target, text) => slack.send(target, text),
    now: nowIso,
    log: console.log,
  };
};

/**
 * The gog-backed side effects for `mailbox`: thread fetch, reply send
 * (explicit recipients, never `--reply-all`), label ensure and apply.
 */
export const gogRespondDeps = (
  gog: GogRunner,
  mailbox: string,
): Pick<
  RunDeps,
  'fetchThread' | 'sendReply' | 'ensureLabel' | 'applyLabel'
> => ({
  fetchThread: (threadId, messageId) =>
    parseThreadForTask(gog(threadFullArgs(mailbox, threadId)), messageId),
  sendReply: ({ to, cc, bcc, replyToMessageId, body }) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'email-respond-'));
    const file = path.join(dir, 'body.txt');
    try {
      fs.writeFileSync(file, body);
      gog([
        'gmail',
        'send',
        '--account',
        mailbox,
        '--to',
        to.join(','),
        ...(cc.length ? ['--cc', cc.join(',')] : []),
        ...(bcc.length ? ['--bcc', bcc.join(',')] : []),
        '--reply-to-message-id',
        replyToMessageId,
        '--body-file',
        file,
        '--json',
      ]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  },
  ensureLabel: (name) => {
    const raw = gog([
      'gmail',
      'labels',
      'list',
      '--json',
      '--account',
      mailbox,
    ]);
    const parsed = raw
      ? parseJsonWith(LabelsListResponseSchema, raw, 'gog gmail labels list')
      : {};
    if (!(parsed.labels ?? []).some((l) => l.name === name)) {
      gog(['gmail', 'labels', 'create', name, '--account', mailbox]);
    }
  },
  applyLabel: (threadId, name) => {
    gog([
      'gmail',
      'thread',
      'modify',
      threadId,
      '--add',
      name,
      '--account',
      mailbox,
    ]);
  },
});

/** The flags `email-respond` accepts. */
export const emailRespondFlags = {
  dryRun: argFlag(
    '--dry-run',
    'Discover and qualify only: no dispatch, send, labels, Slack post or state writes',
  ),
};

/** Run one auto-reply pass; throws when a message failed permanently. */
export async function emailRespond(
  flags: { dryRun: boolean },
  env: EmailRespondEnv = emailRespondEnv(),
): Promise<void> {
  const { emailConfig } = env.pipeline();
  const { respond } = emailConfig;
  if (!respond) {
    env.log(
      '[email-respond] emailConfig.respond is not configured; nothing to do',
    );
    return;
  }
  const dryRun = resolveDryRun({
    respondDryRun: respond.dryRun,
    reportOnly: emailConfig.reportOnly,
    dryRunFlag: flags.dryRun,
  });
  const { mailbox, label } = respond;
  const client = env.runnerClient();
  const slackDir = initSlackDirectory(
    respond.slackMirror,
    env.slackDirectory,
    env.log,
  );

  const candidates: CandidateMessage[] = [];
  for (const threadId of discoverCandidateThreadIds(env.gog, mailbox)) {
    candidates.push(...fetchThreadCandidates(env.gog, mailbox, threadId));
  }

  const summary = await runEmailRespond(
    respond,
    candidates,
    {
      getMessageState: (id) => getMessageState(client, id),
      setMessageState: (id, value) => {
        setMessageState(client, id, value);
      },
      threadReplyCountSince: (threadId, sinceMs) =>
        threadReplyCountSince(client, threadId, sinceMs),
      recordThreadReply: (threadId, at) => {
        recordThreadReply(client, threadId, at);
      },
      ...gogRespondDeps(env.gog, mailbox),
      dispatch: env.dispatch,
      readFinalText: env.readFinalText,
      ...(slackDir
        ? {
            mirrorToSlack: (args) => mirrorReply(slackDir, env.slackSend, args),
          }
        : {}),
      now: env.now,
      log: env.log,
    },
    { dryRun, mailbox, label },
  );

  env.log(`[email-respond] ${JSON.stringify(summary)}`);
  if (summary.failedPermanently.length) {
    throw new Error(
      `email-respond: ${String(summary.failedPermanently.length)} message(s) failed permanently: ${summary.failedPermanently.join(', ')}`,
    );
  }
}

export default defineJob({
  id: 'email-respond',
  domain: 'email',
  name: 'email/respond',
  flags: emailRespondFlags,
  run: ({ flags }) => emailRespond(flags),
});
