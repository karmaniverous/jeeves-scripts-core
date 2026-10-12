/**
 * This instance's plugin (design §3, §7): the runnables it adds to core,
 * its declared overrides of core runnables, and the schema of its `local`
 * config block. The CLI loads it with tsx; nothing runs at import.
 *
 * @packageDocumentation
 */

import { definePlugin } from '@karmaniverous/jeeves-scripts-core';

import sayHello from './src/example/say-hello.js';

export default definePlugin({ jobs: [sayHello] });
