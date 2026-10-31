/**
 * @module punch-list/messages
 *
 * The Slack messages the jobs post, as pure functions
 * of what happened: milestone transitions, a harvest summary and the
 * pinned quick-links message. Posting is `slack.ts`'s job.
 */

import type { ReportItem } from './harvest/report.js';
import type { Transitions } from './status/refresh.js';

/** A Slack link, or the bare label when there is no URL. */
export const slackLink = (url: string | undefined, label: string): string =>
  url ? `<${url}|${label}>` : label;

/** How a reported item is attributed. */
export const attribution = (
  item: Pick<ReportItem, 'kind' | 'requester'>,
): string =>
  item.kind === 'requested'
    ? `requested by ${item.requester ?? 'unknown'}`
    : 'inferred';

/** The status checker's post for milestone transitions, linking today's file. */
export const transitionMessage = (
  t: Transitions,
  fileUrl: string | undefined,
): string =>
  [
    `*${slackLink(fileUrl, 'Punch list')} update*`,
    ...t.done.map((d) => `• \`${d.slug}\` is *Done*: ${d.releases}`),
    ...t.installed.map(
      (s) => `• \`${s}\` is installed ✅ (ready to integrate)`,
    ),
    ...t.reopened.map(
      (s) =>
        `• \`${s}\` is back in *TODO* (an issue was reopened or is awaiting release)`,
    ),
  ].join('\n');

/** The harvester's post for the items it added. */
export const harvestMessage = (
  added: ReportItem[],
  summary: string,
  fileUrl: string | undefined,
): string =>
  [
    `*Punch list harvest:* ${String(added.length)} new backlog item(s) in today's ${slackLink(fileUrl, 'punch list')}`,
    ...added.map((a) => `• ${a.title} (${attribution(a)})`),
    ...(summary ? [`_${summary}_`] : []),
  ].join('\n');

/** The pinned quick-links message. */
export const quickLinksText = (
  today: string,
  todayUrl: string | undefined,
  specUrl: string | undefined,
): string =>
  [
    '*Punch list quick links*',
    `• Today's punch list (${today}): ${todayUrl ? slackLink(todayUrl, 'open') : 'not yet written'}`,
    ...(specUrl ? [`• Spec: ${slackLink(specUrl, 'punch-list-spec.md')}`] : []),
    '_Updated each morning by `punch-list-harvest`._',
  ].join('\n');
