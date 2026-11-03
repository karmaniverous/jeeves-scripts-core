/**
 * @module admin/skill-review/frontmatter
 *
 * Read `name` and `description` from a SKILL.md YAML frontmatter block
 * without a YAML dependency. Handles the scalar forms skills use, as YAML
 * reads them: plain (inline `#` comments dropped, indented continuation
 * lines folded), single- and double-quoted (possibly multiline), and
 * folded (`>`) or literal (`|`) blocks with chomping and indentation
 * indicators. Values are trimmed. Anything else (nested maps, flow
 * collections, anchors, tags) is ignored. Pure.
 */

/** The frontmatter fields the review reads. */
export interface SkillFrontmatter {
  /** `name`, when present. */
  name?: string;
  /** `description`, when present. */
  description?: string;
}

/** The frontmatter block's lines, or `[]` when the text has none. */
const frontmatterLines = (text: string): string[] => {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  if (lines[0]?.trim() !== '---') return [];
  const end = lines.findIndex((line, i) => i > 0 && line.trim() === '---');
  return end > 0 ? lines.slice(1, end) : [];
};

/**
 * The lines after line `i` that continue its value (indented or blank,
 * up to the next top-level line), trailing blank lines dropped.
 */
const continuationLines = (lines: string[], i: number): string[] => {
  const out: string[] = [];
  for (let j = i + 1; j < lines.length; j++) {
    const line = lines[j] ?? '';
    if (line.trim() !== '' && !/^\s/.test(line)) break;
    out.push(line);
  }
  while (out.length && out[out.length - 1]?.trim() === '') out.pop();
  return out;
};

/**
 * Fold flow-scalar lines (already trimmed): a line break between text
 * lines becomes a space; each blank line becomes a newline.
 */
const foldLines = (lines: string[]): string => {
  let out = '';
  let breaks = 0;
  for (const line of lines) {
    if (line === '') {
      breaks += 1;
      continue;
    }
    if (out === '') out = line;
    else out += breaks ? '\n'.repeat(breaks) + line : ` ${line}`;
    breaks = 0;
  }
  return out;
};

/** A plain scalar: text up to the first comment, continuation folded. */
const readPlain = (first: string, more: string[]): string => {
  const parts: string[] = [];
  for (const line of [first, ...more]) {
    const comment = /(^|\s)#/.exec(line);
    parts.push((comment ? line.slice(0, comment.index) : line).trim());
    if (comment) break;
  }
  return foldLines(parts);
};

/** Index of the quote closing a scalar opened at 0, or -1. */
const closingQuote = (text: string, quote: string): number => {
  for (let i = 1; i < text.length; i++) {
    if (quote === '"' && text[i] === '\\') i += 1;
    else if (text[i] === quote) {
      if (quote === "'" && text[i + 1] === "'") i += 1;
      else return i;
    }
  }
  return -1;
};

/** A quoted scalar's value, or `undefined` when it is never closed. */
const readQuoted = (first: string, more: string[]): string | undefined => {
  const quote = first[0] ?? '';
  const text = [first, ...more].join('\n');
  const close = closingQuote(text, quote);
  if (close < 0) return undefined;
  const rows = text.slice(1, close).split('\n');
  const last = rows.length - 1;
  const body = foldLines(
    rows.map((row, i) =>
      i === 0 ? row.trimEnd() : i === last ? row.trimStart() : row.trim(),
    ),
  );
  if (quote === "'") return body.replaceAll("''", "'");
  try {
    const decoded: unknown = JSON.parse(`"${body.replaceAll('\n', '\\n')}"`);
    if (typeof decoded === 'string') return decoded;
  } catch {
    // Not valid JSON escapes: keep the text as written.
  }
  return body;
};

/**
 * A block scalar's lines with the block indentation removed: the
 * explicit indicator, else the first non-blank line's indentation.
 */
const blockBody = (more: string[], indicator: number): string[] => {
  const firstText = more.find((l) => l.trim() !== '') ?? '';
  const indent = indicator || firstText.length - firstText.trimStart().length;
  return more.map((l) => (l.trim() === '' ? '' : l.slice(indent)));
};

/**
 * Fold block lines: adjacent text lines join with a space, blank lines
 * become newlines, and more-indented lines keep their line breaks.
 */
const foldBlock = (lines: string[]): string => {
  let out = '';
  let prevMore: boolean | undefined;
  let breaks = 0;
  for (const line of lines) {
    if (line === '') {
      breaks += 1;
      continue;
    }
    const more = /^\s/.test(line);
    if (prevMore === undefined) out = line;
    else if (!more && !prevMore)
      out += breaks ? '\n'.repeat(breaks) + line : ` ${line}`;
    else out += '\n'.repeat(breaks + 1) + line;
    prevMore = more;
    breaks = 0;
  }
  return out;
};

/** Block scalar header: style, then chomping/indentation in either order. */
const BLOCK_HEADER = /^([>|])(?:([1-9])?[+-]?|[+-]([1-9])?)\s*(?:#.*)?$/;

/** One top-level key's value, or `undefined` when absent. */
const readKey = (lines: string[], key: string): string | undefined => {
  const prefix = `${key}:`;
  const i = lines.findIndex((line) => line.startsWith(prefix));
  if (i < 0) return undefined;
  const rest = (lines[i] ?? '').slice(prefix.length).trim();
  const more = continuationLines(lines, i);
  const header = BLOCK_HEADER.exec(rest);
  if (header) {
    const body = blockBody(more, Number(header[2] ?? header[3] ?? 0));
    return (header[1] === '>' ? foldBlock(body) : body.join('\n')).trim();
  }
  if (rest.startsWith('"') || rest.startsWith("'")) {
    const quoted = readQuoted(rest, more);
    if (quoted !== undefined) return quoted;
  }
  return readPlain(rest, more);
};

/**
 * Parse a skill's `name` and `description`.
 *
 * @param text - The SKILL.md (or PROPOSAL.md) text.
 * @returns The fields found; empty when the text has no frontmatter.
 */
export function parseSkillFrontmatter(text: string): SkillFrontmatter {
  const lines = frontmatterLines(text);
  const name = readKey(lines, 'name');
  const description = readKey(lines, 'description');
  return {
    ...(name ? { name } : {}),
    ...(description ? { description } : {}),
  };
}
