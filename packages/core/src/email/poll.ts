/**
 * @module poll
 *
 * Unified email poller: dispatches by account type. Accounts without an
 * `imap` block are polled via the gog CLI (Gmail via OAuth client or
 * service-account mailboxes). Accounts with an
 * `imap` block are polled via direct IMAP connection.
 *
 * Scheduled runner job. For gog accounts: searches
 * via `gog gmail search`, runs triage classification, enqueues for download
 * (google-workspace/gog-poll.ts).
 * For IMAP accounts: connects, fetches, parses MIME, writes directly to disk.
 * Trims old JSONL logs after 7 days (trim-jsonl.ts), whatever happens.
 *
 * One failing account never stops the others (#66): each account's error
 * is logged and recorded (kind `imap-poll` or `gog-poll`, account, error)
 * in its `_runs-*.jsonl`, the remaining accounts are polled, and the run
 * then fails with one error naming every failed account.
 *
 * Depends on EMAIL_EVENTS_DIR, the report-only flags (`reportOnlyFor`), and
 * bucket domain config from the `pipeline` block. Missing config causes
 * classification to return null buckets (labels skipped). For a report-only
 * account (`emailConfig.reportOnly` or its own `accounts[].reportOnly`),
 * threads are still ingested but no Gmail label actions (classification or
 * curation-signal) are enqueued. Search output is schema-validated by
 * google-workspace/gmail-search.ts. gog
 * accounts work with an OAuth client or service-account mailboxes; if
 * gog accounts are configured and neither exists, the run fails.
 */

import path from 'node:path';

import { appendJsonl, ensureDir, nowIso } from '@karmaniverous/jeeves';
import {
  getRunnerClient,
  type RunnerClient,
} from '@karmaniverous/jeeves-runner';

import {
  type AccountConfig,
  pipeline,
  type PipelineConfig,
  reportOnlyFor,
  type ReportOnlyPolicy,
} from '../config/index.js';
import { constants } from '../lib/constants.js';
import { requireGogCredentials } from '../lib/gog-credentials.js';
import { defineRunnable } from '../runnables/define-runnable.js';
import { pollGogAccount } from './google-workspace/gog-poll.js';
import { pollImapAccount } from './imap/poll.js';
import { trimJsonlFiles } from './trim-jsonl.js';

/** What {@link pollEmail} reads and calls. */
export interface EmailPollDeps {
  /** Accounts and the report-only flags (the `pipeline` block). */
  config: () => Pick<PipelineConfig, 'accounts' | 'emailConfig'>;
  /** `EMAIL_EVENTS_DIR`. */
  eventsDir: string;
  /** Runner client. */
  runner: () => RunnerClient;
  /** Poll one IMAP account. */
  pollImap: typeof pollImapAccount;
  /** Poll one Gmail account through gog. */
  pollGog: typeof pollGogAccount;
  /** Whether gog has a credential; throws when Gmail accounts exist and it has none. */
  requireGog: (gogAccounts: number) => boolean;
  /** ISO timestamp. */
  now: () => string;
}

/** The live collaborators, from config. */
export const emailPollDeps = (): EmailPollDeps => ({
  config: pipeline,
  eventsDir: constants().EMAIL_EVENTS_DIR,
  runner: () => getRunnerClient(),
  pollImap: pollImapAccount,
  pollGog: pollGogAccount,
  requireGog: (n) => requireGogCredentials('email/poll', n),
  now: nowIso,
});

/** One account that failed to poll. */
interface AccountFailure {
  kind: 'imap-poll' | 'gog-poll';
  account: string;
  error: string;
}

const errorMessage = (e: unknown): string =>
  e instanceof Error ? e.message : String(e);

/** Log a failed account and record it in its run log; returns the failure. */
const kindTag = (kind: AccountFailure['kind']): string =>
  kind === 'imap-poll' ? 'imap' : 'gog';

const recordFailure = (
  deps: EmailPollDeps,
  runsFile: string,
  kind: AccountFailure['kind'],
  account: string,
  e: unknown,
): AccountFailure => {
  const error = errorMessage(e);
  console.error(`[${kindTag(kind)}] ${account} error: ${error}`);
  appendJsonl(path.join(deps.eventsDir, runsFile), {
    at: deps.now(),
    kind,
    account,
    error,
  });
  return { kind, account, error };
};

/** One error naming every failed account and its error's first line. */
const accountsFailedError = (failures: readonly AccountFailure[]): Error =>
  new Error(
    `email/poll: ${String(failures.length)} account(s) failed: ${failures
      .map(
        (f) =>
          `[${kindTag(f.kind)}] ${f.account}: ${f.error.split(/\r?\n/)[0] ?? ''}`,
      )
      .join('; ')}`,
  );

/** Poll each IMAP account, logging a run line per account; returns the failures. */
async function pollImapAccounts(
  accounts: readonly AccountConfig[],
  client: RunnerClient,
  deps: EmailPollDeps,
): Promise<AccountFailure[]> {
  const failures: AccountFailure[] = [];
  for (const account of accounts) {
    console.log(`[imap] Polling ${account.email}`);
    try {
      const s = await deps.pollImap(account, client);
      appendJsonl(path.join(deps.eventsDir, '_runs-imap-poll.jsonl'), {
        at: deps.now(),
        kind: 'imap-poll',
        account: account.email,
        fetched: s.fetched,
        written: s.written,
        skipped: s.skipped,
        failed: s.failed,
        folders: s.folders,
      });
    } catch (e) {
      failures.push(
        recordFailure(
          deps,
          '_runs-imap-poll.jsonl',
          'imap-poll',
          account.email,
          e,
        ),
      );
    }
  }
  return failures;
}

/** Poll each gog account; returns the failures. */
function pollGogAccounts(
  accounts: readonly AccountConfig[],
  client: RunnerClient,
  reportOnly: ReportOnlyPolicy,
  deps: EmailPollDeps,
): AccountFailure[] {
  const failures: AccountFailure[] = [];
  for (const acctCfg of accounts) {
    if (reportOnly(acctCfg.email))
      console.log(
        `[gog] ${acctCfg.email} reportOnly: no Gmail label actions will be enqueued`,
      );
    try {
      deps.pollGog({
        account: acctCfg.email,
        client,
        reportOnly,
        query: 'in:anywhere',
        max: 100,
      });
    } catch (e) {
      failures.push(
        recordFailure(
          deps,
          `_runs-${acctCfg.email}.jsonl`,
          'gog-poll',
          acctCfg.email,
          e,
        ),
      );
    }
  }
  return failures;
}

/**
 * Poll every polling-enabled account (IMAP first, then gog), then trim old
 * logs. Rejects, after every account has been tried, when any failed.
 */
export async function pollEmail(deps: EmailPollDeps): Promise<void> {
  const config = deps.config();
  const allAccounts = config.accounts.filter((a) => a.emailPolling);
  const gogAccounts = allAccounts.filter((a) => !a.imap);
  const imapAccounts = allAccounts.filter((a) => a.imap);
  const reportOnly = reportOnlyFor(config);
  const client = deps.runner();
  const failures: AccountFailure[] = [];

  try {
    ensureDir(deps.eventsDir);
    failures.push(...(await pollImapAccounts(imapAccounts, client, deps)));

    // Throws (failed run) when Gmail accounts exist but gog has neither
    // an OAuth client nor service-account mailboxes.
    const hasGog = deps.requireGog(gogAccounts.length);

    failures.push(
      ...pollGogAccounts(hasGog ? gogAccounts : [], client, reportOnly, deps),
    );
  } finally {
    try {
      trimJsonlFiles(deps.eventsDir, 7);
    } finally {
      client.close();
    }
  }
  if (failures.length > 0) throw accountsFailedError(failures);
}

export default defineRunnable({
  id: 'email-poll',
  domain: 'email',
  flags: {},
  name: 'email/poll',
  crashDir: () => constants().EMAIL_EVENTS_DIR,
  run: () => pollEmail(emailPollDeps()),
});
