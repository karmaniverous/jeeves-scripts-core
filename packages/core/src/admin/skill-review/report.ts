/**
 * @module admin/skill-review/report
 *
 * The report's output contract. The worker writes its report to the run
 * directory; {@link validateReport} checks it has exactly one
 * `### <proposal id>` section per pending proposal, each with a
 * `**Disposition:**` line starting with one of {@link DISPOSITION_LABELS}
 * plus non-empty `**Short description:**` and `**Recommendation:**` lines
 * (the fields the script needs to build the Slack post itself, without
 * trusting the model to compose it). Delivery to
 * `<outputDir>/<YYYY-MM-DD>.md` is the shared `lib/dated-report`.
 */

/** The dispositions a proposal section may carry. */
export const DISPOSITION_LABELS = [
  'Approve as is',
  'Approve with modifications',
  'Reject or decline',
  'Not reviewed',
] as const;

/** A disposition category. */
export type Disposition = (typeof DISPOSITION_LABELS)[number];

/** Dispositions counted per category. */
export type DispositionCounts = Record<Disposition, number>;

/** One proposal's validated report fields. */
export interface ReportEntry {
  /** The reviewer's call. */
  disposition: Disposition;
  /** One line: what the proposal does. */
  shortDescription: string;
  /** One line: exactly what to do about it. */
  recommendation: string;
}

/** A validated report. */
export interface ValidReport {
  /** Entry per proposal id. */
  entries: Record<string, ReportEntry>;
  /** Counts per category. */
  counts: DispositionCounts;
}

const escapeRe = (s: string): string =>
  s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Strip one matching pair of outer emphasis markers (`*x*` or `**x**`)
 * and surrounding whitespace; asterisks inside the value (globs, code)
 * are kept.
 */
const plain = (s: string): string => {
  const t = s.trim();
  return (/^(\*{1,2})(.+)\1$/.exec(t)?.[2] ?? t).trim();
};

/**
 * Every section body under `### <id>`, each up to the next `##`/`###`
 * heading.
 */
const sectionsOf = (report: string, id: string): string[] => {
  const heading = new RegExp(`^###\\s+\`?${escapeRe(id)}\`?\\s*$`, 'gm');
  return [...report.matchAll(heading)].map((match) => {
    const rest = report.slice(match.index + match[0].length);
    const next = /^#{2,3}\s/m.exec(rest);
    return next ? rest.slice(0, next.index) : rest;
  });
};

/** Pull one `**Label:** value` line's value, plain text, or `undefined`. */
const fieldOf = (section: string, label: string): string | undefined => {
  // `[ \t]*` and `.*` stay on the label's line: an empty field must not
  // capture the next line's label.
  const re = new RegExp(`^\\*\\*${escapeRe(label)}:\\*\\*[ \\t]*(.*)$`, 'm');
  const value = plain(re.exec(section)?.[1] ?? '');
  return value === '' ? undefined : value;
};

/**
 * Validate a report against the pending proposals.
 *
 * @param report - The report text.
 * @param proposalIds - Every pending proposal id.
 * @returns The entries and counts.
 * @throws Error listing every missing section or field.
 */
export function validateReport(
  report: string,
  proposalIds: readonly string[],
): ValidReport {
  const problems: string[] = [];
  const entries: Record<string, ReportEntry> = {};
  const counts: DispositionCounts = Object.fromEntries(
    DISPOSITION_LABELS.map((d) => [d, 0]),
  ) as DispositionCounts;
  if (report.trim() === '') problems.push('the report is empty');
  for (const id of proposalIds) {
    const sections = sectionsOf(report, id);
    const [section] = sections;
    if (section === undefined) {
      problems.push(`no "### ${id}" section`);
      continue;
    }
    if (sections.length > 1) {
      problems.push(`${String(sections.length)} "### ${id}" sections`);
      continue;
    }
    const word = fieldOf(section, 'Disposition')?.toLowerCase();
    const disposition = DISPOSITION_LABELS.find(
      (d) => d.toLowerCase() === word,
    );
    const shortDescription = fieldOf(section, 'Short description');
    const recommendation = fieldOf(section, 'Recommendation');
    if (!disposition)
      problems.push(
        `${id}: no "**Disposition:** ${DISPOSITION_LABELS.join('|')}" line`,
      );
    if (!shortDescription)
      problems.push(`${id}: no "**Short description:**" line`);
    if (!recommendation) problems.push(`${id}: no "**Recommendation:**" line`);
    if (!disposition || !shortDescription || !recommendation) continue;
    entries[id] = { disposition, shortDescription, recommendation };
    counts[disposition] += 1;
  }
  if (problems.length)
    throw new Error(`Invalid review report: ${problems.join('; ')}`);
  return { entries, counts };
}
