/**
 * @module convert/lib/page-list
 *
 * Page selection for convert/pdf-to-png (Decision 83.1): parses a 1-based
 * page list such as `1-3,7` and resolves it against a document's page
 * count. Pure; no I/O.
 */

/** An inclusive, 1-based page range. */
export type PageRange = readonly [first: number, last: number];

/** A page list item: one page, or an inclusive range. */
const ITEM = /^(\d+)(?:-(\d+))?$/;

/**
 * Parse a 1-based page list (`1-3,7`): comma-separated pages and inclusive
 * ranges, whitespace around items ignored.
 *
 * @param list - The page list.
 * @returns The ranges, in the order given.
 * @throws When an item is not a page or a range, a page is 0, or a range
 *   runs backwards.
 */
export function parsePageList(list: string): PageRange[] {
  return list.split(',').map((item) => {
    const match = ITEM.exec(item.trim());
    const first = Number(match?.[1]);
    const last = match?.[2] === undefined ? first : Number(match[2]);
    if (!match || first < 1 || last < first)
      throw new Error(
        `Invalid page list "${list}": use 1-based pages and ranges, e.g. 1-3,7`,
      );
    return [first, last] as const;
  });
}

/**
 * Resolve page ranges against a document's page count.
 *
 * @param ranges - Selected ranges; `undefined` selects every page.
 * @param total - The document's page count.
 * @param label - How to name the selection in the error (the page list).
 * @returns The pages to render, ascending, without duplicates.
 * @throws When a selected page is outside the document.
 */
export function selectPages(
  ranges: readonly PageRange[] | undefined,
  total: number,
  label: string,
): number[] {
  if (ranges === undefined)
    return Array.from({ length: total }, (_, i) => i + 1);
  if (ranges.some(([first, last]) => first < 1 || last > total))
    throw new Error(
      `Page list ${label} is outside the document (${String(total)} page${total === 1 ? '' : 's'})`,
    );
  const pages = new Set<number>();
  for (const [first, last] of ranges)
    for (let page = first; page <= last; page++) pages.add(page);
  return [...pages].sort((a, b) => a - b);
}
