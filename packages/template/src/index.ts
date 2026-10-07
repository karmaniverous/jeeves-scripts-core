/**
 * Sample local job for a `jeeves-scripts` instance repo. Real instance code
 * is written config-driven from the start (Decision 26); this placeholder
 * will be replaced by a real sample job (`defineJob`) once the job registry
 * lands (Dev Plan row 5 / 30).
 *
 * @packageDocumentation
 */

import { placeholder } from '@karmaniverous/jeeves-scripts-core';

/**
 * Builds the sample job's greeting from the core placeholder export, proving
 * the template consumes core as a real, workspace-linked dependency
 * (Decision 20).
 *
 * @returns A greeting that names the consumed core package.
 */
export const sampleJobGreeting = (): string => `hello from ${placeholder()}`;
