/**
 * @module drain-updates
 *
 * Dequeue label-change actions from `email-updates` and apply them to
 * Gmail threads via `gog gmail thread modify`.
 *
 * Scheduled runner job. Pre-creates any missing
 * Gmail labels, then processes addLabel/removeLabel/archive/trash/markRead
 * actions with rate limiting (MAX_CALLS_PER_MINUTE). Updates the thread
 * cache provenance on each successful action. Logs run stats to
 * `EMAIL_EVENTS_DIR`.
 *
 * Rate limit is hardcoded
 * via MAX_CALLS_PER_MINUTE constant. Skips when no gog accounts are
 * configured (getGmailAccounts(): polled Gmail accounts plus
 * emailConfig.backfill.accounts). Fails when there are some but gog has
 * no OAuth client and no service-account mailboxes, whether or not
 * reportOnly is set. Applies nothing (and dequeues nothing) when
 * emailConfig.reportOnly is true. See label-actions.ts planDrain().
 */

import path from 'node:path';

import { appendJsonl, nowIso, sleepMs } from '@karmaniverous/jeeves';
import {
  getRunnerClient,
  type RunnerClient,
} from '@karmaniverous/jeeves-runner';

import { getGmailAccounts, pipeline } from '../../config/index.js';
import { defineJob } from '../../jobs/define-job.js';
import { constants } from '../../lib/constants.js';
import { type GogRunner, gogWithRetry } from '../../lib/gog.js';
import { loadCache, saveCache } from '../email-cache.js';
import {
  EMAIL_UPDATES_QUEUE,
  type LabelChanges,
  labelChangesFor,
  planDrain,
  threadModifyArgs,
} from './label-actions.js';

/** Gmail modify calls per minute. */
export const MAX_CALLS_PER_MINUTE = 60;

/** What {@link drainUpdates} reads and calls. */
export interface DrainUpdatesDeps {
  /** `emailConfig.reportOnly`. */
  reportOnly: boolean;
  /** Configured Gmail accounts (polled plus backfill). */
  gmailAccounts: number;
  /** gog. */
  gog: GogRunner;
  /** Runner queue. */
  runner: () => Pick<RunnerClient, 'dequeue' | 'done' | 'fail' | 'close'>;
  /** `EMAIL_EVENTS_DIR`. */
  eventsDir: string;
  /** ISO timestamp. */
  now: () => string;
  /** Rate-limit pause (synchronous). */
  sleep: (ms: number) => void;
}

/** The live collaborators, from config. */
export const drainUpdatesDeps = (): DrainUpdatesDeps => ({
  reportOnly: pipeline().emailConfig.reportOnly,
  gmailAccounts: getGmailAccounts().length,
  gog: gogWithRetry,
  runner: () => getRunnerClient(),
  eventsDir: constants().EMAIL_EVENTS_DIR,
  now: nowIso,
  sleep: sleepMs,
});

interface UpdateEntry {
  account: string;
  threadId: string;
  messageId: string;
  action: string;
  label?: string;
  source: string;
}

function applyLabelUpdate(entry: UpdateEntry, gog: GogRunner): LabelChanges {
  const changes = labelChangesFor(entry.action, entry.label);
  gog(threadModifyArgs(entry.account, entry.threadId, changes), {
    retries: 1,
    backoffMs: 3000,
  });
  return changes;
}

function processEntry(
  entry: UpdateEntry,
  deps: Pick<DrainUpdatesDeps, 'gog' | 'now'>,
): {
  success: boolean;
  error?: string;
} {
  try {
    const changes = applyLabelUpdate(entry, deps.gog);
    const cache = loadCache(entry.account, entry.threadId);
    if (cache) {
      const val =
        changes.addLabels.length > 0
          ? `+${changes.addLabels.join(',')}`
          : `-${changes.removeLabels.join(',')}`;
      cache.provenance.push({
        field: 'labels',
        messageId: entry.messageId,
        value: val,
        by: 'jeeves',
        source: entry.source,
        at: deps.now(),
      });
      const msg = cache.messages?.[entry.messageId];
      if (msg) {
        const labels = new Set(msg.labels);
        for (const l of changes.addLabels) labels.add(l);
        for (const l of changes.removeLabels) labels.delete(l);
        msg.labels = Array.from(labels);
      }
      saveCache(cache);
    }
    return { success: true };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/** Apply the queued label changes (unless report-only), rate-limited, and log the run. */
export function drainUpdates(deps: DrainUpdatesDeps): void {
  const plan = planDrain(deps.reportOnly, deps.gmailAccounts);
  if (plan === 'report-only') {
    console.log(
      '[report-only] emailConfig.reportOnly is true: no Gmail changes applied; queue left untouched',
    );
    return;
  }
  if (plan === 'skip') {
    console.log('[skip] No Gmail accounts configured');
    return;
  }

  const client = deps.runner();
  try {
    const items = client.dequeue(EMAIL_UPDATES_QUEUE, 100);
    if (items.length === 0) {
      console.log('Queue is empty');
      return;
    }

    // Pre-flight: ensure labels exist
    const labelActions = items.filter(
      ({ payload }) =>
        (payload as UpdateEntry).action === 'addLabel' &&
        (payload as UpdateEntry).label,
    );
    const unique = new Map<string, { account: string; label: string }>();
    for (const { payload } of labelActions) {
      const e = payload as UpdateEntry;
      const key = `${e.account}|${e.label!}`;
      if (!unique.has(key))
        unique.set(key, { account: e.account, label: e.label! });
    }
    for (const { account, label } of unique.values()) {
      try {
        const raw = deps.gog(
          ['gmail', 'labels', 'list', '--json', '--account', account],
          { retries: 1, backoffMs: 3000 },
        );
        const parsed = raw
          ? (JSON.parse(raw) as { labels?: { name: string }[] })
          : {};
        const existing = (parsed.labels ?? []).map((l) => l.name);
        if (!existing.includes(label)) {
          console.log(`Creating label "${label}" for ${account}`);
          deps.gog(['gmail', 'labels', 'create', label, '--account', account], {
            retries: 1,
            backoffMs: 3000,
          });
        }
      } catch (e) {
        console.error(
          `Failed label check "${label}" for ${account}:`,
          e instanceof Error ? e.message : String(e),
        );
      }
    }

    const delay = Math.ceil(60000 / MAX_CALLS_PER_MINUTE);
    let processed = 0,
      succeeded = 0,
      failed = 0;

    for (const { id, payload } of items) {
      processed++;
      const entry = payload as UpdateEntry;
      console.log(
        `Processing ${String(processed)}: ${entry.action} ${entry.label ?? ''} on ${entry.messageId}`,
      );
      const result = processEntry(entry, deps);
      if (result.success) {
        client.done(id);
        succeeded++;
      } else {
        client.fail(id, result.error);
        failed++;
      }
      if (processed < items.length) deps.sleep(delay);
    }

    const stats = {
      at: deps.now(),
      kind: 'drain_updates',
      processed,
      succeeded,
      failed,
    };
    appendJsonl(path.join(deps.eventsDir, '_runs.jsonl'), stats);
    console.log(JSON.stringify(stats, null, 2));
  } finally {
    client.close();
  }
}

export default defineJob({
  id: 'email-drain-updates',
  domain: 'email',
  flags: {},
  name: 'email/drain-updates',
  crashDir: () => constants().EMAIL_EVENTS_DIR,
  run: () => {
    drainUpdates(drainUpdatesDeps());
  },
});
