/**
 * The template's sample runnable, `example-say-hello` (domain `example`):
 * prints a greeting naming this instance, read from `jeeves-scripts.json`.
 * Offline and side-effect free; replace it with real runnables.
 *
 * Run it with `node bin/jeeves-scripts.js run example-say-hello [name]`.
 *
 * @packageDocumentation
 */

import { defineJob, loadConfig } from '@karmaniverous/jeeves-scripts-core';

export default defineJob({
  id: 'example-say-hello',
  domain: 'example',
  description: 'Print a greeting from this instance (the template sample).',
  run: ({ args }) => {
    const [name = 'world'] = args;
    console.log(`Hello, ${name}, from ${loadConfig().instance.name}!`);
  },
});
