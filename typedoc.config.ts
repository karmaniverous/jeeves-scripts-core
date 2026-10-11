/**
 * TypeDoc configuration for the jeeves-scripts-core monorepo: the API
 * reference for core's root export plus the guides as project documents,
 * written to `docs/` (design §11). TypeScript per Decision 52; TypeDoc
 * finds only JSON and JavaScript config files by itself, so `npm run docs`
 * passes this file with `--options`, and Node loads it with type stripping.
 *
 * @module typedoc.config
 */

import type { TypeDocOptions } from 'typedoc';
import type {} from 'typedoc-plugin-replace-text';

const config: Partial<TypeDocOptions> = {
  entryPoints: ['./packages/core/src/index.ts'],
  tsconfig: './packages/core/tsconfig.json',
  highlightLanguages: [
    'bash',
    'console',
    'css',
    'html',
    'ini',
    'javascript',
    'json',
    'json5',
    'jsonc',
    'md',
    'mermaid',
    'powershell',
    'tsx',
    'typescript',
    'xml',
    'yaml',
    'yml',
  ],
  intentionallyNotExported: ['src/lib/constants.ts:derive'],
  hostedBaseUrl: 'https://docs.karmanivero.us/jeeves-scripts-core',
  navigationLinks: {
    GitHub: 'https://github.com/karmaniverous/jeeves-scripts-core',
  },
  out: './docs/',
  plugin: ['typedoc-plugin-mdn-links', 'typedoc-plugin-replace-text'],
  projectDocuments: [
    './packages/core/README.md',
    './packages/core/guides/*.md',
    './packages/core/CHANGELOG.md',
  ],
  replaceText: {
    replacements: [
      {
        pattern: '<!-- TYPEDOC_EXCLUDE -->.*?<!-- /TYPEDOC_EXCLUDE -->',
        flags: 'gis',
        replace: '',
      },
    ],
  },
  searchInComments: true,
  searchInDocuments: true,
  validation: {
    notDocumented: true,
  },
  treatWarningsAsErrors: true,
};

export default config;
