#!/usr/bin/env node
// The launcher (design §7): runner jobs, webhooks and people run
// `node <repo>/bin/jeeves-scripts.js <verb> ...`. It hands this repo's root
// to the core version pinned in package.json, so nothing depends on the
// working directory or PATH.
import process from 'node:process';
import { URL } from 'node:url';

import { main } from '@karmaniverous/jeeves-scripts-core/cli';

process.exitCode = await main({ root: new URL('..', import.meta.url) });
