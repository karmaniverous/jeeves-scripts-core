/**
 * @module cli/bin
 *
 * The package `bin` (`jeeves-scripts …` installed globally, or
 * `npx jeeves-scripts …`): the hand-off (`cli/hand-off`), which finds the
 * scripts repo and runs its launcher. Runner jobs use the instance's
 * launcher (Decision 16) directly, which passes its own root.
 */

import { handOff } from './hand-off.js';

process.exitCode = await handOff(process.argv.slice(2));
