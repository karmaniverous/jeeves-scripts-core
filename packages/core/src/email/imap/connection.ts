/**
 * @module email/imap/connection
 *
 * The IMAP connection the poller uses (the slice of `imapflow`'s client it
 * calls) and the live connector. Tests pass their own connector.
 */

import { ImapFlow } from 'imapflow';

import type { AccountConfig } from '../../config/index.js';

/** The calls the poller and the account types make on a connection. */
export type ImapConnection = Pick<
  ImapFlow,
  'connect' | 'logout' | 'getMailboxLock' | 'fetchAll' | 'mailbox' | 'list'
>;

/** Opens (does not yet connect) a connection for an account. */
export type ImapConnector = (
  imap: NonNullable<AccountConfig['imap']>,
  pass: string,
) => ImapConnection;

/** The live connector: an `imapflow` client, logging off. */
export const imapFlowConnector: ImapConnector = (imap, pass) =>
  new ImapFlow({
    host: imap.host,
    port: imap.port,
    secure: imap.tls,
    auth: { user: imap.user, pass },
    logger: false,
  });
