/**
 * @module jira/refresh-fields
 *
 * Refreshes `{silo}/jira/_fields.json`, the custom field id to name map the
 * drain uses to add readable aliases, from `GET /rest/api/3/field`. Skips
 * (exit 0) when Jira credentials are not configured.
 */

import fs from 'node:fs';
import path from 'node:path';

import { defineRunnable } from '../runnables/define-runnable.js';
import {
  hasJiraCredentials,
  jiraConnection,
  type JiraField,
  jiraGet,
} from './lib/jira-client.js';
import { type JiraJobDeps, jiraJobDeps } from './lib/jira-deps.js';

/** Fetch the field metadata and write the custom field map. */
export async function refreshJiraFields(deps: JiraJobDeps): Promise<void> {
  if (!hasJiraCredentials(deps.settings)) {
    console.log('[skip] Jira API credentials not configured');
    return;
  }
  const conn = jiraConnection(deps.settings, deps.fetch);
  console.log(`[refresh-fields] fetching field metadata from ${conn.siteUrl}`);
  const fields = await jiraGet<JiraField[]>(conn, 'field');

  const fieldMap: Record<string, string> = {};
  for (const field of fields)
    if (field.custom && field.id.startsWith('customfield_'))
      fieldMap[field.id] = field.name;

  fs.mkdirSync(deps.domainDir, { recursive: true });
  const outputPath = path.join(deps.domainDir, deps.fieldsFilename);
  fs.writeFileSync(
    outputPath,
    JSON.stringify(fieldMap, null, 2) + '\n',
    'utf8',
  );
  console.log(
    `[refresh-fields] wrote ${String(Object.keys(fieldMap).length)} custom fields to ${outputPath} at ${deps.now()}`,
  );
}

export default defineRunnable({
  id: 'jira-refresh-fields',
  domain: 'jira',
  flags: {},
  name: 'jira/refresh-fields',
  run: () => refreshJiraFields(jiraJobDeps()),
});
