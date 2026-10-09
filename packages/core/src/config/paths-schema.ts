/**
 * @module config/paths-schema
 *
 * Zod schema for the `paths` block of `jeeves-scripts.json`: explicit
 * overrides of paths derived from `instance.baseDir` (Decision 3). Every
 * field is optional; unset fields are derived (see `config/paths.ts`).
 */

import { z } from 'zod';

/** The `paths` block: overrides for paths otherwise derived from `instance.baseDir`. */
export const pathsSchema = z.object({
  /** Config directory. Default: `{baseDir}/config`. */
  configDir: z.string().optional(),
  /** Content directory, the default silo's base path. Default: `{baseDir}/content`. */
  contentDir: z.string().optional(),
  /** The instance repo. Default: `{baseDir}/jeeves-scripts`. */
  scriptsDir: z.string().optional(),
  /** Credential files. Default: `{configDir}/credentials`. */
  credentialsDir: z.string().optional(),
  /** Service state. Default: `{baseDir}/state`. */
  stateDir: z.string().optional(),
  /**
   * gog home (service-account keys, OAuth client credentials, file
   * keyring). Its own key because it does not sit under `configDir` on
   * every instance (J8: JGS keeps it under its credentials dir).
   * Default: `{configDir}/gogcli`; `GOG_HOME` wins.
   */
  gogHome: z.string().optional(),
  /** Token metrics output. Default: under `stateDir`; `TOKEN_METRICS_DIR` wins. */
  tokenMetricsDir: z.string().optional(),
});

/** The `paths` block as written in the config file. */
export type PathsConfigInput = z.infer<typeof pathsSchema>;
