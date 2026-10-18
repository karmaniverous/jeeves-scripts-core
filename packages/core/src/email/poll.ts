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
 * Trims old JSONL logs after 7 days (trim-jsonl.ts).
 *
 * Depends on EMAIL_EVENTS_DIR, emailConfig.reportOnly, and bucket domain
 * config from the `pipeline` block. Missing config causes classification to
 * return null buckets (labels skipped). When reportOnly is true, threads
 * are still ingested but no Gmail label actions (classification or
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
} from '../config/index.js';
import { defineJob } from '../jobs/define-job.js';
import { constants } from '../lib/constants.js';
import { requireGogCredentials } from '../lib/gog-credentials.js';
import { pollGogAccount } from './google-workspace/gog-poll.js';
import { pollImapAccount } from './imap/poll.js';
import { trimJsonlFiles } from './trim-jsonl.js';

/** What {@link pollEmail} reads and calls. */
export interface EmailPollDeps {
  /** Accounts and `emailConfig.reportOnly` (the `pipeline` block). */
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

/** Poll each IMAP account, logging a run line per account; errors are logged, not thrown. */
async function pollImapAccounts(
  accounts: readonly AccountConfig[],
  client: RunnerClient,
  deps: EmailPollDeps,
): Promise<void> {
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
      console.error(
        `[imap] ${account.email} error: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
}

/** Poll every polling-enabled account (IMAP first, then gog), then trim old logs. */
export async function pollEmail(deps: EmailPollDeps): Promise<void> {
  const config = deps.config();
  const allAccounts = config.accounts.filter((a) => a.emailPolling);
  const gogAccounts = allAccounts.filter((a) => !a.imap);
  const imapAccounts = allAccounts.filter((a) => a.imap);
  const reportOnly = config.emailConfig.reportOnly;
  const client = deps.runner();

  try {
    ensureDir(deps.eventsDir);
    await pollImapAccounts(imapAccounts, client, deps);

    // Throws (failed run) when Gmail accounts exist but gog has neither
    // an OAuth client nor service-account mailboxes.
    const hasGog = deps.requireGog(gogAccounts.length);
    if (reportOnly && hasGog)
      console.log('[gog] reportOnly: no Gmail label actions will be enqueued');

    for (const acctCfg of hasGog ? gogAccounts : [])
      deps.pollGog({
        account: acctCfg.email,
        client,
        reportOnly,
        query: 'in:anywhere',
        max: 100,
      });

    trimJsonlFiles(deps.eventsDir, 7);
  } finally {
    client.close();
  }
}

export default defineJob({
  id: 'email-poll',
  domain: 'email',
  flags: {},
  name: 'email/poll',
  crashDir: () => constants().EMAIL_EVENTS_DIR,
  run: () => pollEmail(emailPollDeps()),
});
