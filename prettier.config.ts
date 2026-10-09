/**
 * Prettier configuration for the jeeves-scripts-core monorepo.
 *
 * @module prettier.config
 */

import type { Config } from 'prettier';

const config: Config = {
  embeddedLanguageFormatting: 'auto',
  endOfLine: 'lf',
  proseWrap: 'never',
  singleQuote: true,
};

export default config;
