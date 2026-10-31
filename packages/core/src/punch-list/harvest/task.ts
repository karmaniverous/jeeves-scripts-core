/**
 * @module punch-list/harvest/task
 *
 * Build the harvest worker's task: the standing orders from the instance's
 * `{dir}/TASK.md` when it has one, else core's bundled template
 * (`punch-list/harvest.task.md`, Decision 75), then the run's context (the
 * time window, the input paths, the spec, everything already on the list
 * for de-duplication) and the output contract, stamped with the date in
 * the configured zone. The worker searches the archive itself; the task
 * carries no harvested data. Reads the template file.
 */

import { join } from 'node:path';

import { withDateContext } from '../../lib/dates.js';
import {
  describeTaskSource,
  resolveTaskTemplate,
} from '../../lib/task-template.js';
import { getMarker } from '../model/lines.js';
import type { PunchList } from '../model/types.js';

/** Core's bundled harvest template (under `task-templates/`). */
export const HARVEST_TEMPLATE = 'punch-list/harvest.task.md';

/** Everything already on the list, for the worker's de-duplication context. */
export const backlogDigest = (list: PunchList): string[] => [
  ...list.tasks.map((e) => `- task: ${e.text}`),
  ...list.completedTasks.map(
    (e) => `- task done ${getMarker(e.text, 'done') ?? ''}: ${e.text}`,
  ),
  ...list.backlog.map((e) => `- open: ${e.text}`),
  ...list.processedBacklog.map(
    (e) => `- processed ${getMarker(e.text, 'processed') ?? ''}: ${e.text}`,
  ),
  ...(['todo', 'done', 'integrated'] as const).flatMap((key) =>
    list[key].map((m) => `- milestone (${key}): ${m.slug} — ${m.title}`),
  ),
];

/** The output contract the script validates (`report.ts`), for a run writing to `reportFile`. */
export const outputContract = (
  reportFile: string,
): string => `## Output contract

Write ONE JSON object, and nothing else, to \`${reportFile}\` with the \`write\` tool. Your final reply is just \`DONE\`.

{"items":[{"title":"…","why":"…","kind":"requested"|"inferred","requester":"…","sources":["<absolute file_path>","runner:<job>#<run>"]}],"summary":"…"}

- title: 3–120 characters; why: one or two sentences (max 600 characters).
- kind "requested": someone asked for it; set requester to their name. kind "inferred": you judged it is needed; omit requester.
- sources: at least one. File sources are the exact absolute file_path of the watcher hits you used. Telemetry sources are runner:<job>#<run>, watcher:<path> or meta:<path>.
- summary: one short paragraph on what you looked at and what you found.
- No items is a valid result: {"items":[],"summary":"…"}.
- If a tool you need fails, write only HARVEST_FAILED: <tool and error> to that file instead.
- Write no other file and post nothing.`;

/** What {@link buildTask} needs. */
export interface BuildTaskOptions {
  /** The punch-list directory (holds an optional `TASK.md`). */
  dir: string;
  /** Where the worker writes its report. */
  reportFile: string;
  /** Today's list, for the de-duplication digest. */
  list: PunchList;
  /** The window start. */
  since: Date;
  /** The run start (the window end and the date line). */
  now: Date;
  /** The zone of the date line. */
  timeZone: string;
  /** The input paths the pre-check watches. */
  inputRoots: readonly string[];
  /** The punch-list spec, when configured. */
  specPath?: string;
}

/** The worker's task and the line naming where its standing orders came from. */
export interface HarvestTask {
  /** The full task text. */
  text: string;
  /** `task from the instance file …` or `task from core template …`. */
  source: string;
}

/** The full task text, and where its standing orders came from. */
export const buildTask = (options: BuildTaskOptions): HarvestTask => {
  const resolved = resolveTaskTemplate(
    join(options.dir, 'TASK.md'),
    HARVEST_TEMPLATE,
  );
  const digest = backlogDigest(options.list);
  const body = [
    resolved.text.trim(),
    '## This run',
    [
      `- Window: ${options.since.toISOString()} to ${options.now.toISOString()}. Look at what was added or changed in it.`,
      `- Input paths: ${options.inputRoots.join(', ')}`,
      ...(options.specPath ? [`- Punch-list spec: ${options.specPath}`] : []),
    ].join('\n'),
    `- Earlier punch-list files and harvest reports: ${options.dir}`,
    '- Already on the list (do not propose these again, or near-duplicates of them):',
    ...(digest.length ? digest : ['- (nothing yet)']),
    outputContract(options.reportFile),
  ].join('\n\n');
  return {
    text: withDateContext(body, options.now, options.timeZone),
    source: describeTaskSource(resolved),
  };
};
