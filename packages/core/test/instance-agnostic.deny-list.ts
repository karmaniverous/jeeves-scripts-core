/**
 * @module test/instance-agnostic.deny-list
 *
 * The one place that defines what counts as instance-identifying text in
 * core (Decisions 18, 36). `instance-agnostic.test.ts` scans core's
 * source, guides, skills, tests, scripts and README, and the template
 * package, and fails on any line that matches a rule here.
 *
 * Adding a rule: give it an `id`, a pattern and the reason. Patterns must
 * not themselves contain private data: core is public, so this list names
 * only what is already public (the package author, the instance names the
 * guard has always carried) and otherwise matches by shape (Slack, Notion
 * and Google Drive ids). Never add a private person's name, a private id
 * or a private host here; match its shape instead.
 *
 * There is no per-line allow mechanism, by design (like `eslint-disable`,
 * it would become the way around the guard). Examples in core use neutral
 * values: Jane Doe, `example.com`, `acme`, `/base`, `D:/`, and Slack ids
 * that say what they are (`C000EXAMPLE1`, `U0JANE0001`, `C0123456789`).
 */

/** One deny rule. */
export interface DenyRule {
  /** Stable rule id, printed with each hit. */
  id: string;
  /** Matches instance-identifying text on one line. */
  pattern: RegExp;
  /** Optional second check on each match; return `false` to let it pass. */
  accept?: (match: string) => boolean;
  /** Why the text identifies an instance. */
  reason: string;
}

/** Words that mark a Slack-shaped id as a placeholder, not a real id. */
const PLACEHOLDER =
  /EXAMPLE|XXX|JANE|UNKNOWN|MAPPED|ENTERPRISE|NAMED|TEST|FAKE|ABCDEF|OTHER|SOMEONE/;

/**
 * Whether a Slack-shaped token looks like a real id: after the type letter
 * it mixes letters and digits and carries no placeholder word. All-digit
 * bodies (`C0123456789`, `C0000000000`) are placeholders.
 */
export const looksLikeRealSlackId = (token: string): boolean => {
  const body = token.slice(1);
  if (PLACEHOLDER.test(token)) return false;
  return /\d/.test(body) && /[A-Z]/.test(body);
};

/** The deny list. */
export const denyRules: readonly DenyRule[] = [
  {
    id: 'instance-name',
    pattern: /\bjgs\b/i,
    reason: 'names a particular instance (and its bot account)',
  },
  {
    id: 'instance-drive',
    pattern: /\bj:[\\/]/i,
    reason: "an instance host's data drive; use /base, D:/ or /srv/jeeves",
  },
  {
    id: 'client-name',
    pattern: /veterancrowd/i,
    reason: "names an instance's client organisation",
  },
  {
    id: 'instance-domain',
    pattern: /johngalt/i,
    reason: "an instance owner's domain; use example.com",
  },
  {
    id: 'tenant-project',
    pattern: /tinypoe|tyinlife/i,
    reason: "names an instance's tenant project or account",
  },
  {
    id: 'owner-account',
    // The org's repos and packages (`karmaniverous/<repo>`,
    // `@karmaniverous/<pkg>`, `github.com/karmaniverous`) are fine; the
    // bare name used as an account or handle in data is not.
    pattern: /(?<![@\w/.-])karmaniverous(?![\w/-])/i,
    reason: "an instance owner's account used as data; use acme",
  },
  {
    id: 'person-name',
    pattern: /\bjason\b|williscroft/i,
    reason: 'a real person; examples use Jane Doe',
  },
  {
    id: 'slack-id',
    pattern: /\b[CDGTUW][A-Z0-9]{8,10}\b/,
    accept: looksLikeRealSlackId,
    reason: 'a real Slack id; use a placeholder such as C000EXAMPLE1',
  },
  {
    id: 'notion-id',
    pattern: /\b[0-9a-f]{32}\b/,
    reason: 'a real Notion page or database id',
  },
  {
    id: 'google-drive-id',
    pattern: /\b1[A-Za-z0-9_-]{32,43}\b/,
    reason: 'a real Google Drive file or folder id',
  },
];
