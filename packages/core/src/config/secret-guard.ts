/**
 * @module config/secret-guard
 *
 * Rejects literal secret values anywhere in a parsed `jeeves-scripts.json`
 * tree (Decision 19, Decision 3). Credentials stay in files under
 * `CREDENTIALS_DIR`, referenced by path or `secretRef`; the config file
 * itself never holds a secret value.
 *
 * Walks the whole parsed config object looking for a key whose exact
 * name (case-insensitive) denotes a secret value (`password`, `token`,
 * `apiKey`, `secret`, …) holding a non-empty plain string. Paths listed
 * in {@link EXEMPT_SUBTREES} are skipped because they have their own,
 * narrower validation (e.g. `pipeline.accounts[].imap.password`, which
 * accepts a deprecated literal with a warning, or a `{ secretRef }`
 * object).
 */

/** Exact (case-insensitive) key names that must never hold a literal value. */
const SECRET_KEY_NAMES = new Set(
  [
    'password',
    'token',
    'apiKey',
    'apikey',
    'secret',
    'clientSecret',
    'accessToken',
    'refreshToken',
    'privateKey',
    'secretKey',
  ].map((k) => k.toLowerCase()),
);

/**
 * Dotted/indexed path prefixes (as produced by {@link pathKey}) exempt
 * from the scan because they are validated elsewhere.
 */
const EXEMPT_SUBTREES = ['pipeline.accounts'];

const pathKey = (segments: (string | number)[]): string =>
  segments.filter((s) => typeof s === 'string').join('.');

const isExempt = (segments: (string | number)[]): boolean => {
  const key = pathKey(segments);
  return EXEMPT_SUBTREES.some(
    (prefix) => key === prefix || key.startsWith(`${prefix}.`),
  );
};

/** One literal-secret finding: the dotted path and the offending key. */
export interface SecretLiteralFinding {
  path: (string | number)[];
  key: string;
}

/**
 * Recursively scan `value` for literal secret values. Returns every
 * finding (empty when none).
 */
export const findSecretLiterals = (
  value: unknown,
  segments: (string | number)[] = [],
): SecretLiteralFinding[] => {
  if (isExempt(segments)) return [];
  if (Array.isArray(value)) {
    return value.flatMap((item, index) =>
      findSecretLiterals(item, [...segments, index]),
    );
  }
  if (value !== null && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).flatMap(
      ([key, child]) => {
        const childSegments = [...segments, key];
        if (
          typeof child === 'string' &&
          child.length > 0 &&
          SECRET_KEY_NAMES.has(key.toLowerCase())
        ) {
          return [{ path: childSegments, key }];
        }
        return findSecretLiterals(child, childSegments);
      },
    );
  }
  return [];
};
