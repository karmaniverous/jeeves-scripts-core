/**
 * @module jira/lib/jira-deps
 *
 * What the Jira runnables read and call (settings, `fetch`, the archive
 * directory, the clock, a sleep), and the live values resolved from
 * `jeeves-scripts.json` when a runnable runs (never at import).
 */

import path from 'node:path';

import { nowIso, sleepAsync } from '@karmaniverous/jeeves';

import { getBasePathForJira, integrations } from '../../config/index.js';
import type { JiraSettings } from './jira-client.js';

/** The Jira runnables' collaborators. */
export interface JiraJobDeps {
  /** Site URL, email and API token path. */
  settings: JiraSettings;
  /** The board to sort (`integrations.jira.boardId`, `JIRA_BOARD_ID` wins). */
  boardId: number | undefined;
  /** HTTP. */
  fetch: typeof fetch;
  /** The `{silo}/jira` archive directory. */
  domainDir: string;
  /** `_fields.json` file name. */
  fieldsFilename: string;
  /** ISO timestamp. */
  now: () => string;
  /** Rate-limit delay. */
  sleep: (ms: number) => Promise<void>;
}

/** The live collaborators, from config. */
export const jiraJobDeps = (): JiraJobDeps => {
  const jira = integrations().jira;
  return {
    settings: {
      siteUrl: jira.siteUrl,
      email: jira.email,
      apiTokenPath: jira.apiTokenPath,
    },
    boardId: jira.boardId,
    fetch: (input, init) => fetch(input, init),
    domainDir: path.join(getBasePathForJira(), 'jira'),
    fieldsFilename: jira.fieldsFilename,
    now: nowIso,
    sleep: sleepAsync,
  };
};
