/**
 * @module cli/package-info
 *
 * Where the running core package is and its version: the package root is
 * two levels up from this module (`src/cli` or `dist/cli`). `doctor`,
 * `--version`, `init` (the default pin and the bundled template) and
 * `skills` (the shipped skills) read from here. Reads `package.json`.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';

/** The npm name of core. */
export const CORE_PACKAGE = '@karmaniverous/jeeves-scripts-core';

/** The running core package's root directory. */
export const corePackageDir = (): string =>
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The running core package's version, from its `package.json`. */
export const coreVersion = (): string =>
  z
    .object({ version: z.string().min(1) })
    .parse(
      JSON.parse(
        fs.readFileSync(path.join(corePackageDir(), 'package.json'), 'utf8'),
      ),
    ).version;
