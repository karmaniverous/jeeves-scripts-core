/**
 * @module config/paths-schema
 *
 * Zod schema for the `paths` block of `jeeves-scripts.json`: explicit
 * overrides of paths derived from `instance.baseDir` (Decision 3). Every
 * field is optional; unset fields are derived — see `config/paths.ts`.
 */

import { z } from 'zod';

export const pathsSchema = z.object({
  configDir: z.string().optional(),
  contentDir: z.string().optional(),
  scriptsDir: z.string().optional(),
  credentialsDir: z.string().optional(),
  stateDir: z.string().optional(),
  /**
   * gog home (service-account keys, OAuth client credentials, file
   * keyring). Not derived from `configDir` by default on every instance
   * (J8: JGS's gog home lives under its credentials dir, not its config
   * dir), so it is its own key.
   */
  gogHome: z.string().optional(),
  tokenMetricsDir: z.string().optional(),
});

export type PathsConfigInput = z.infer<typeof pathsSchema>;
