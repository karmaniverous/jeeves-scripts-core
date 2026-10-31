/**
 * @module punch-list/links
 *
 * Source links: a watcher `file_path` becomes its jeeves-server browse
 * URL, `{publicUrl}/browse/{root}/{rest}` with every path segment
 * URL-encoded, as `server_resolve_path` does. The roots and public URL
 * come from the jeeves-server config (`{configDir}/jeeves-server/config.json`,
 * read like every other component config). A path outside every root, or
 * not an existing file, is rejected.
 */

import { existsSync, statSync } from 'node:fs';
import path from 'node:path';

import { z } from 'zod';

import { readComponentConfig } from '../lib/component-config.js';

const serverConfigSchema = z.looseObject({
  publicUrl: z.url(),
  roots: z.record(z.string(), z.string()),
});

/** What {@link browseUrl} needs from the jeeves-server config. */
export type ServerLinks = z.infer<typeof serverConfigSchema>;

/**
 * Read `publicUrl` and `roots` from the jeeves-server config file.
 *
 * @throws When the file is missing, is not JSON, or lacks either field.
 */
export const readServerLinks = (configPath: string): ServerLinks => {
  const links = readComponentConfig('server', serverConfigSchema, configPath);
  if (!links)
    throw new Error(
      `jeeves-server config not found at ${configPath}: the punch list links its files through jeeves-server`,
    );
  return links;
};

/**
 * The jeeves-server URL of `filePath`, or `undefined` when no root holds
 * it (including a file on another Windows drive, where `relative` returns
 * an absolute path).
 *
 * @param p - Path rules; default this host's (tests pass `path.win32`).
 */
export const browseUrl = (
  links: ServerLinks,
  filePath: string,
  p: typeof path = path,
): string | undefined => {
  // `relative` resolves both paths itself.
  const matches = Object.entries(links.roots)
    .map(([name, root]) => ({ name, rel: p.relative(root, filePath) }))
    .filter(
      ({ rel }) => rel !== '' && !rel.startsWith('..') && !p.isAbsolute(rel),
    )
    .sort((a, b) => a.rel.length - b.rel.length);
  const best = matches[0];
  if (!best) return undefined;
  const segments = [best.name, ...best.rel.split(p.sep)].map(
    encodeURIComponent,
  );
  return `${links.publicUrl.replace(/\/+$/, '')}/browse/${segments.join('/')}`;
};

/** {@link browseUrl}, but only for an existing file. */
export const fileLink = (
  links: ServerLinks,
  filePath: string,
  exists: (p: string) => boolean = (p) => existsSync(p) && statSync(p).isFile(),
): string | undefined =>
  exists(filePath) ? browseUrl(links, filePath) : undefined;

/** A Markdown link labelled with the file name (without its extension). */
export const markdownLink = (url: string, filePath: string): string => {
  const name = filePath.split(/[\\/]/).at(-1) ?? filePath;
  const label = name.replace(/\.[^.]+$/, '').replace(/[[\]]/g, '');
  return `[${label}](${url.replace(/\)/g, '%29').replace(/\(/g, '%28')})`;
};
