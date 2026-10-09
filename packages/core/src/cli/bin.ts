/**
 * @module cli/bin
 *
 * The package `bin` (`npx jeeves-scripts …`): runs the CLI with the
 * working directory as the instance repo root, which is where `npx` is run
 * from. Runner jobs use the instance's launcher (Decision 16) instead,
 * which passes its own root explicitly.
 */

import { main } from './index.js';

process.exitCode = await main({ root: process.cwd() });
