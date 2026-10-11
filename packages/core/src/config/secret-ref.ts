/**
 * @module config/secret-ref
 *
 * The secret-name rule shared by the config schema (which validates every
 * `{ secretRef }`) and the secret readers (`config/imap-secrets.ts`). Kept
 * dependency-free so the schema can use it without importing the config
 * getters.
 */

/**
 * The jeeves-tools secret-name rule (instance config `secrets` map): 1-64
 * characters, letters, digits, `_` and `-`, starting with a letter or
 * digit. Kept identical so every secretRef accepted here can be
 * provisioned by jeeves-tools; no dots, so never `.`, `..` or a path
 * separator.
 */
const SECRET_REF_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

/**
 * True when `ref` is a valid secret name (the jeeves-tools secret-name
 * rule above), and so a safe file name inside a secrets directory.
 */
export const isSafeSecretRef = (ref: string): boolean =>
  SECRET_REF_PATTERN.test(ref);

/** Message used when a secretRef is not a valid secret name. */
export const UNSAFE_SECRET_REF_MESSAGE =
  'secretRef must be a plain file name of 1-64 characters: letters, digits, "_" and "-", starting with a letter or digit (no "/", "\\", "." or "..")';
