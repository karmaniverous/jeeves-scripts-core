import jeevesScripts from '@karmaniverous/jeeves-scripts-core/presets/eslint.js';

export default [
  ...jeevesScripts(import.meta.dirname),
  // At most 300 code lines per file: the core repo's rule (R34), kept here
  // because ESLint lints this package with this config, not core's.
  {
    rules: {
      'max-lines': [
        'error',
        { max: 300, skipBlankLines: true, skipComments: true },
      ],
    },
  },
];
