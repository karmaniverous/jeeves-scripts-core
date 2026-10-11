/**
 * @module config/imap-secrets
 *
 * Resolves IMAP passwords. In the config an account's `imap.password` is
 * always `{ "secretRef": "<name>" }` (Decision 19). A secretRef names a
 * file in `paths().imapSecretsDir` (`<credentialsDir>/imap/<name>`), which
 * the IMAP poller reads when it connects. Password values are never
 * logged or included in error messages.
 *
 * Ported from `jeeves-scripts-template` `src/lib/imap-secrets.ts`
 * (template `main` at `322054c`).
 */

import fs from 'node:fs';
import path from 'node:path';

import { paths } from './paths.js';
import { isSafeSecretRef, UNSAFE_SECRET_REF_MESSAGE } from './secret-ref.js';

export { isSafeSecretRef, UNSAFE_SECRET_REF_MESSAGE } from './secret-ref.js';

/** `imap.password` in pipeline config: a secret reference. */
export interface ImapPassword {
  /** Name of the secret file. */
  secretRef: string;
}

/**
 * Path of the file holding the secret named `ref`.
 *
 * @param ref - Secret name.
 * @param dir - Secrets directory. Default: `paths().imapSecretsDir`.
 * @throws When `ref` is not a safe file name.
 */
export const imapSecretPath = (
  ref: string,
  dir: string = paths().imapSecretsDir,
): string => {
  if (!isSafeSecretRef(ref))
    throw new Error(`IMAP secretRef "${ref}": ${UNSAFE_SECRET_REF_MESSAGE}`);
  return path.join(dir, ref);
};

/**
 * Resolve an `imap.password` secretRef to the password itself, read from
 * its file with trailing newlines removed.
 *
 * @param password - The account's `imap.password`.
 * @param dir - Secrets directory. Default: `paths().imapSecretsDir`.
 * @throws When the file is missing, unreadable or empty. The message
 *   names the ref and the path, never the value.
 */
export const resolveImapPassword = (
  password: ImapPassword,
  dir?: string,
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
