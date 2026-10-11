/**
 * @module config/account-key
 *
 * The key a person's channel account is matched on (Decision 34): used by
 * the `people` schema's uniqueness check and by `lib/people` lookups.
 * Internal.
 */

import type { PersonAccount } from './people-schema.js';

/** The key an account is matched on. */
export const accountKey = (a: PersonAccount): string =>
  JSON.stringify([a.channel, a.account, a.id]);
