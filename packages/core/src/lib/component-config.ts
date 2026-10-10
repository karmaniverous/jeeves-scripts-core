/**
 * @module lib/component-config
 *
 * Locate and read another Jeeves component's own config file, so scripts
 * pull a component's settings (the runner's port, the watcher's Qdrant
 * URL) from the component instead of copying them into
 * `jeeves-scripts.json`. The layout is the platform's
 * (`@karmaniverous/jeeves`): `{configRoot}/jeeves-<name>/config.json`.
 * The platform config root is core's `paths().configDir`.
 */

import fs from 'node:fs';
import path from 'node:path';

import { COMPONENT_CONFIG_PREFIX, CONFIG_FILE } from '@karmaniverous/jeeves';
import { z } from 'zod';

import { paths } from '../config/paths.js';

/**
 * Path of a component's config file.
 *
 * @param name - Component name without the `jeeves-` prefix (`runner`, `watcher`).
 * @param configRoot - Platform config root. Default: `paths().configDir`.
 */
export const componentConfigPath = (
  name: string,
  configRoot: string = paths().configDir,
): string =>
  path.join(configRoot, `${COMPONENT_CONFIG_PREFIX}${name}`, CONFIG_FILE);

/**
 * Read and validate a component's config file.
 *
 * @param name - Component name, used in error messages.
 * @param schema - Zod schema for the parts of the file the caller reads.
 * @param file - Config file. Default: {@link componentConfigPath}.
 * @returns The parsed config, or `undefined` when the file does not exist.
 * @throws When the file is not JSON or does not match `schema`.
 */
export const readComponentConfig = <S extends z.ZodType>(
  name: string,
  schema: S,
  file: string = componentConfigPath(name),
): z.output<S> | undefined => {
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw err;
  }
  const parsed = schema.safeParse(JSON.parse(text));
  if (!parsed.success)
    throw new Error(
      `Invalid jeeves-${name} config at ${file}: ${z.prettifyError(parsed.error)}`,
    );
  return parsed.data;
};
