/**
 * @module lib/meta-config
 *
 * The jeeves-meta service's address, read from the meta service's own
 * config (`{configRoot}/jeeves-meta/config.json`), like
 * {@link runnerConfig} does for the runner. Only `port` is read; it
 * defaults to the platform's meta port (`META_PORT` from
 * `@karmaniverous/jeeves`) when the file or the key is absent. The service
 * binds all interfaces by default, so it is reached on loopback.
 */

import { META_PORT } from '@karmaniverous/jeeves';
import { z } from 'zod';

import {
  componentConfigPath,
  readComponentConfig,
} from './component-config.js';

/** The parts of the meta service's config scripts read. */
export const metaConfigSchema = z.looseObject({
  /** HTTP port of the meta service. */
  port: z.number().int().positive().default(META_PORT),
});

/** The meta service's validated config (defaults applied; defaults when the file does not exist). */
export const metaConfig = (
  file: string = componentConfigPath('meta'),
): z.output<typeof metaConfigSchema> =>
  readComponentConfig('meta', metaConfigSchema, file) ??
  metaConfigSchema.parse({});

/** Base URL of the meta service's HTTP API, e.g. `http://127.0.0.1:1938`. */
export const metaUrl = (file?: string): string =>
  `http://127.0.0.1:${String(metaConfig(file).port)}`;
