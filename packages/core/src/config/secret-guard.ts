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
 * `apiKey`, `secret`, …) holding a non-empty plain string. Nothing is
 * exempt: IMAP passwords too must be `{ secretRef }`.
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
