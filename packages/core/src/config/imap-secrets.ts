/**
 * @module config/imap-secrets
 *
 * Resolves IMAP passwords. In the config an account's `imap.password` is
 * always `{ "secretRef": "<name>" }` (Decision 19). A secretRef names a file in `paths().imapSecretsDir`
 * (`<credentialsDir>/imap/<name>`), which the IMAP poller reads when it
 * connects. Password values are never logged or included in error
 * messages.
 *
 * Ported from `jeeves-scripts-template` `src/lib/imap-secrets.ts`
 * (template `main` at `322054c`).
 */

import fs from 'node:fs';
import path from 'node:path';

/** `imap.password` in pipeline config: a secret reference. */
export interface ImapPassword {
  secretRef: string;
}

/**
 * The jeeves-tools secret-name rule (instance config `secrets` map): 1-64
 * characters, letters, digits, `_` and `-`, starting with a letter or
 * digit. Kept identical so every secretRef accepted here can be
 * provisioned by jeeves-tools; no dots, so never `.`, `..` or a path
 * separator.
 */
const SECRET_REF_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

/**
 * True when `ref` is a valid secret name (see {@link SECRET_REF_PATTERN}),
 * and so a safe file name inside the secrets directory.
 */
export const isSafeSecretRef = (ref: string): boolean =>
  SECRET_REF_PATTERN.test(ref);

/** Message used when a secretRef is not a valid secret name. */
export const UNSAFE_SECRET_REF_MESSAGE =
  'secretRef must be a plain file name of 1-64 characters: letters, digits, "_" and "-", starting with a letter or digit (no "/", "\\", "." or "..")';

/**
 * Path of the file holding the secret named `ref`, inside `dir`.
 *
 * @throws When `ref` is not a safe file name.
 */
export const imapSecretPath = (ref: string, dir: string): string => {
  if (!isSafeSecretRef(ref))
    throw new Error(`IMAP secretRef "${ref}": ${UNSAFE_SECRET_REF_MESSAGE}`);
  return path.join(dir, ref);
};

/**
 * Resolve an `imap.password` secretRef to the password itself, read from
 * its file with trailing newlines removed.
 *
 * @throws When the file is missing, unreadable or empty. The message
 *   names the ref and the path, never the value.
 */
export const resolveImapPassword = (
  password: ImapPassword,
  dir: string,
): string => {
  const { secretRef } = password;
  const file = imapSecretPath(secretRef, dir);
  let value: string;
  try {
    value = fs.readFileSync(file, 'utf8');
  } catch (e) {
    const code =
      e instanceof Error && 'code' in e ? String(e.code) : 'read failed';
    throw new Error(
      `IMAP secret "${secretRef}" could not be read from ${file} (${code}).`,
      { cause: e },
    );
  }
  const trimmed = value.replace(/(?:\r?\n)+$/, '');
  if (!trimmed)
    throw new Error(`IMAP secret "${secretRef}" at ${file} is empty.`);
  return trimmed;
};
