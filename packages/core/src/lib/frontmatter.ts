/**
 * @module lib/frontmatter
 *
 * YAML frontmatter blocks for generated Markdown. Every value is written
 * in JSON syntax, which is valid YAML: strings are always quoted and
 * escaped, so a value containing `: `, `#`, quotes or a newline can't
 * break the block or change its meaning.
 *
 * Used by google-drive/lib/frontmatter and convert/lib/convert-utils.
 */

/** A frontmatter value; `undefined` omits the field. */
export type FrontmatterValue = string | number | boolean | undefined;

/**
 * Build a frontmatter block (`---` lines, then a blank line).
 *
 * @param fields - Key/value pairs in output order; undefined values are skipped.
 * @returns The block, ending in `---\n\n`.
 */
export function frontmatterBlock(
  fields: Iterable<readonly [string, FrontmatterValue]>,
): string {
  const lines: string[] = [];
  for (const [key, value] of fields) {
    if (value !== undefined) lines.push(`${key}: ${JSON.stringify(value)}`);
  }
  return `---\n${lines.join('\n')}\n---\n\n`;
}
