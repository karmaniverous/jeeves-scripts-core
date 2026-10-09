/**
 * Sample local code for a `jeeves-scripts` instance repo. Real instance code
 * is written config-driven from the start (Decision 26): it resolves content
 * paths through core's silo resolver (Decision 28) instead of joining
 * absolute roots itself. This sample becomes a real sample job
 * (`defineJob`) once the job registry lands (Dev Plan 5 / 30).
 *
 * @packageDocumentation
 */

import {
  type LoadConfigOptions,
  siloPath,
} from '@karmaniverous/jeeves-scripts-core';

/**
 * Where the sample job keeps its task file: `<silo>/sample/TASK.md`,
 * proving the template consumes core as a real, workspace-linked
 * dependency (Decision 20).
 *
 * @param silo - Silo name; the default silo when omitted.
 * @param options - Config location (the instance repo root in practice).
 * @returns The task file path inside the silo.
 */
export const sampleTaskFile = (
  silo: string | undefined,
  options: LoadConfigOptions,
): string => siloPath(silo, ['sample', 'TASK.md'], options);
