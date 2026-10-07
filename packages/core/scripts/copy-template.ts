/**
 * Copies the private `packages/template` workspace (without `node_modules`,
 * build output or local-only dotfiles) into `packages/core/template/`, which
 * is listed in core's `files` and therefore published inside the core npm
 * package (Decision 20).
 *
 * Run as the last step of `npm run build` in this package.
 *
 * @module scripts/copy-template
 */

import { fileURLToPath } from 'node:url';

import fs from 'fs-extra';

const coreDir = fileURLToPath(new URL('..', import.meta.url));
const templateSrc = fileURLToPath(new URL('../../template', import.meta.url));
const templateDest = `${coreDir}/template`;

const filter = (src: string): boolean => {
  const base = src.split(/[/\\]/).pop() ?? '';
  return (
    base !== 'node_modules' &&
    base !== 'dist' &&
    base !== 'coverage' &&
    base !== '.rollup.cache' &&
    base !== '.tsbuildinfo'
  );
};

await fs.remove(templateDest);
await fs.copy(templateSrc, templateDest, { filter });

console.info(`[copy-template] copied ${templateSrc} -> ${templateDest}`);
