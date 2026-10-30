/**
 * @module inventory
 *
 * Print a summary table of thread directories, message files, and SQLite
 * thread-state item counts per account and silo.
 *
 * Run manually as an entry-point script for diagnostics. Walks each
 * account's threads directory on disk and queries jeeves-runner SQLite
 * for state item counts. Output is a formatted console table.
 *
 * Depends on silo-router for per-account paths, the `pipeline` config for
 * the account list, and email-state for the seenKey convention.
 */

import fs from 'node:fs';
import path from 'node:path';

import {
  getRunnerClient,
  type RunnerClient,
} from '@karmaniverous/jeeves-runner';

import {
  getEmailAccounts,
  getEmailBaseForAccount,
} from '../../config/index.js';
import { defineRunnable } from '../../runnables/define-runnable.js';
import { seenKey } from '../email-state.js';

function countFiles(dir: string): number {
  if (!fs.existsSync(dir)) return 0;
  let count = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isFile()) count++;
  }
  return count;
}

function countDirsAndFiles(dir: string): { dirs: number; files: number } {
  if (!fs.existsSync(dir)) return { dirs: 0, files: 0 };
  let dirs = 0;
  let files = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      dirs++;
      files += countFiles(path.join(dir, entry.name));
    }
  }
  return { dirs, files };
}

/** What {@link emailInventory} reads. */
export interface InventoryDeps {
  /** The configured email accounts. */
  accounts: () => string[];
  /** An account's `{silo}/email` directory. */
  emailBase: (account: string) => string;
  /** Runner items (thread state). */
  runner: () => Pick<RunnerClient, 'listItemKeys' | 'close'>;
}

/** The live collaborators, from config. */
export const inventoryDeps = (): InventoryDeps => ({
  accounts: getEmailAccounts,
  emailBase: getEmailBaseForAccount,
  runner: () => getRunnerClient(),
});

/** Print the per-account counts table. */
export function emailInventory(deps: InventoryDeps): void {
  const accounts = deps.accounts();
  const client = deps.runner();

  try {
    const rows: {
      silo: string;
      account: string;
      threadDirs: number;
      threadMessages: number;
      sqliteThreads: number;
    }[] = [];

    for (const account of accounts) {
      const emailBase = deps.emailBase(account);
      const silo =
        emailBase
          .replace(/[\\/]email$/, '')
          .split(/[\\/]/)
          .at(-1) ?? '';
      const threadsDir = path.join(emailBase, 'threads', account);

      const { dirs: threadDirs, files: threadMessages } =
        countDirsAndFiles(threadsDir);

      const itemKeys = client.listItemKeys('email', seenKey(account));
      const sqliteThreads = itemKeys.length;

      rows.push({
        silo,
        account,
        threadDirs,
        threadMessages,
        sqliteThreads,
      });
    }

    // Print summary table
    console.log('\n=== Email Inventory ===\n');
    console.log(
      'Silo'.padEnd(16) +
        'Account'.padEnd(42) +
        'Threads'.padStart(10) +
        'Messages'.padStart(10) +
        'SQLite'.padStart(10),
    );
    console.log('-'.repeat(88));

    let totalThreads = 0,
      totalMessages = 0,
      totalSqlite = 0;

    for (const r of rows) {
      console.log(
        r.silo.padEnd(16) +
          r.account.padEnd(42) +
          String(r.threadDirs).padStart(10) +
          String(r.threadMessages).padStart(10) +
          String(r.sqliteThreads).padStart(10),
      );
      totalThreads += r.threadDirs;
      totalMessages += r.threadMessages;
      totalSqlite += r.sqliteThreads;
    }

    console.log('-'.repeat(88));
    console.log(
      'TOTAL'.padEnd(58) +
        String(totalThreads).padStart(10) +
        String(totalMessages).padStart(10) +
        String(totalSqlite).padStart(10),
    );
    console.log();
  } finally {
    client.close();
  }
}

export default defineRunnable({
  id: 'email-inventory',
  domain: 'email',
  flags: {},
  description:
    'Print thread directory, message file and thread-state counts per email account and silo (diagnostics).',
  name: 'email/inventory',
  run: () => {
    emailInventory(inventoryDeps());
  },
});
