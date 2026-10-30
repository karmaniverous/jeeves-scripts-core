/**
 * @module runnables/deprecated
 *
 * Names kept so instance plugins written against 0.2 keep working after the
 * runnable rename (Decision 73). The root export re-exports this module with
 * `export *`, so core's own code never names a deprecated symbol.
 */

import { defineRunnable } from './define-runnable.js';

/**
 * The pre-0.3.0 name of {@link defineRunnable}.
 *
 * @deprecated Use {@link defineRunnable}; `defineJob` is removed in a later major release.
 */
export const defineJob = defineRunnable;
