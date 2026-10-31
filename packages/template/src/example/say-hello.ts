/**
 * The template's sample runnable, `example-say-hello` (domain `example`):
 * prints a greeting naming this instance, read from the instance config
 * (the config directory `jeeves-scripts.json` points at).
 * Offline and side-effect free; replace it with real runnables.
 *
 * Run it with `node bin/jeeves-scripts.js run example-say-hello [name]`.
 *
 * @packageDocumentation
 */

import { defineRunnable, loadConfig } from '@karmaniverous/jeeves-scripts-core';

export default defineRunnable({
  id: 'example-say-hello',
  domain: 'example',
  description: 'Print a greeting from this instance (the template sample).',
  flags: {},
  positionals: '[name]',
  run: ({ args }) => {
    const [name = 'world'] = args;
    console.log(`Hello, ${name}, from ${loadConfig().instance.name}!`);
  },
});
