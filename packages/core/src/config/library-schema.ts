/**
 * @module config/library-schema
 *
 * Zod schema for the top-level `library` block (spec 2.9, #35): the public
 * repo subdirectories `library-sync-mirrors` mirrors into the content tree.
 * Field rules are checked per mirror; the array checks that ids are
 * unique and that no two mirrors share a destination (one `dest` equal to,
 * or inside, another's), so an invalid block fails `config check` and
 * every run (Decision 76).
 */

import { z } from 'zod';

import { pathSegments as segments, relativePath } from './relative-path.js';

/** The `{name}` placeholder of `siteLinks.pattern`. */
export const LIBRARY_LINK_NAME = '{name}';
/** The `{dir}` placeholder of `siteLinks.target`. */
export const LIBRARY_LINK_DIR = '{dir}';

/** How many times `token` occurs in `s`. */
const count = (s: string, token: string): number => s.split(token).length - 1;

/**
 * Site-relative links to rewrite (Decision 74): a fixed two-placeholder
 * template, never a free regex. A Markdown link `](<pattern>)` whose
 * `{name}` names exactly one file matching `target` becomes a relative
 * link to that file.
 */
export const librarySiteLinksSchema = z.object({
  /** The site-relative link, with exactly one `{name}` (e.g. `/skill/{name}`). */
  pattern: z
    .string()
    .refine(
      (p) =>
        count(p, LIBRARY_LINK_NAME) === 1 && count(p, LIBRARY_LINK_DIR) === 0,
      { message: 'pattern must contain exactly one {name} and no {dir}' },
    ),
  /** The linked file, with exactly one `{dir}` (e.g. `{dir}/SKILL.md`); `{name}` is the dir's last segment. */
  target: z
    .string()
    .refine(
      (t) =>
        count(t, LIBRARY_LINK_DIR) === 1 && count(t, LIBRARY_LINK_NAME) === 0,
      { message: 'target must contain exactly one {dir} and no {name}' },
    ),
});

/** One mirrored repo subdirectory. */
export const libraryMirrorSchema = z.object({
  /** Mirror id: a lowercase slug, unique across `mirrors`; names its state dir and log lines. */
  id: z
    .string()
    .regex(
      /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
      'id: lowercase words separated by dashes',
    ),
  /** Public GitHub repo, `owner/repo`, cloned anonymously over HTTPS. */
  repo: z
    .string()
    .regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/, 'repo must be owner/repo'),
  /** Branch or tag to track (default `main`). */
  ref: z
    .string()
    .min(1)
    .refine((r) => !r.startsWith('-'), { message: 'ref must not start with -' })
    .default('main'),
  /** Subdirectory of the repo to mirror (default `''`, the whole repo). */
  subdir: relativePath('subdir').default(''),
  /**
   * Destination, relative to `paths.contentDir`; never the content dir
   * itself or under `.meta` (in any case: case-insensitive filesystems
   * would put `.Meta` there).
   */
  dest: relativePath('dest')
    .refine((d) => segments(d).length > 0, {
      message: 'dest must name a directory under the content dir',
    })
    .refine((d) => !segments(d).some((s) => s.toLowerCase() === '.meta'), {
      message: 'dest must not be under .meta',
    }),
  /** rsync filter patterns, source-relative, left out of the mirror (`.git/` always is). */
  exclude: z.array(z.string().min(1)).default([]),
  /** Fail rather than shrink the mirror below this share of its current file count (default 0.5). */
  minRatio: z.number().gt(0).lte(1).default(0.5),
  /** Site-relative links to rewrite; unset, mirrored files are copied unchanged. */
  siteLinks: librarySiteLinksSchema.optional(),
  /**
   * Take over an existing `dest` this mirror did not write, on the next
   * live run (default false: such a `dest` is refused). Once a publish is
   * recorded the flag has no further effect and can be removed.
   */
  adopt: z.boolean().default(false),
});

/** A mirror's `dest`, normalised for comparison. */
const destKey = (dest: string): string => segments(dest).join('/');

/** The `library` block. */
export const librarySchema = z.object({
  /** The mirrors, run in order (default none: `library-sync-mirrors` skips). */
  mirrors: z
    .array(libraryMirrorSchema)
    .default([])
    .superRefine((mirrors, ctx) => {
      mirrors.forEach((m, i) => {
        if (mirrors.findIndex((o) => o.id === m.id) !== i)
          ctx.addIssue({
            code: 'custom',
            message: `duplicate mirror id "${m.id}"`,
            path: [i, 'id'],
          });
        const key = destKey(m.dest);
        const other = mirrors.find((o, j) => {
          const k = destKey(o.dest);
          return (
            j < i &&
            (`${key}/`.startsWith(`${k}/`) || `${k}/`.startsWith(`${key}/`))
          );
        });
        if (other)
          ctx.addIssue({
            code: 'custom',
            message: `dest "${m.dest}" overlaps mirror "${other.id}"'s dest "${other.dest}"`,
            path: [i, 'dest'],
          });
      });
    }),
});

/** Site-relative link rewriting for one mirror. */
export type LibrarySiteLinks = z.infer<typeof librarySiteLinksSchema>;
/** One configured mirror (defaults applied). */
export type LibraryMirror = z.infer<typeof libraryMirrorSchema>;
/** The `library` block (defaults applied). */
export type LibraryConfig = z.infer<typeof librarySchema>;
