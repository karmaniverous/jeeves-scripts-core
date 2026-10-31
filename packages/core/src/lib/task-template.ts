/**
 * @module lib/task-template
 *
 * The one TASK-template resolver (Decision 75): a worker's standing
 * orders come from the instance's own file at the configured path when it
 * exists, else from the copy core ships under `task-templates/`. Nothing
 * copies a template into the instance. Every caller reports which source
 * it used ({@link describeTaskSource}). {@link fillTaskTemplate} fills
 * `{{name}}` placeholders and `{{> core/template.md}}` includes. Reads
 * files only.
 */

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Where a worker's task text came from. */
export interface ResolvedTaskTemplate {
  /** The task text, as read (placeholders unfilled). */
  text: string;
  /** `instance`: the instance's own file; `core`: core's shipped template. */
  source: 'instance' | 'core';
  /** The file read. */
  path: string;
  /** The instance file looked for first. */
  instanceFile: string;
  /** The core template's name (relative to `task-templates/`), when one was given. */
  template?: string;
}

/**
 * The absolute path of a core template: `task-templates/<name>` at the
 * package root, two levels above this module (`src/lib/` or `dist/lib/`).
 */
export const coreTaskTemplatePath = (name: string): string =>
  fileURLToPath(new URL(`../../task-templates/${name}`, import.meta.url));

/**
 * Resolve a worker's task: `instanceFile` when it exists, else core's
 * `template`.
 *
 * @param instanceFile - The instance's own file (absolute).
 * @param template - Core template name, e.g. `punch-list/harvest.task.md`;
 *   unset: the instance file is the only source.
 * @returns The task; `undefined` only when there is no instance file and
 *   no core template was given (the caller skips).
 * @throws When the named core template does not exist (a core packaging error).
 */
export function resolveTaskTemplate(
  instanceFile: string,
  template: string,
): ResolvedTaskTemplate;
export function resolveTaskTemplate(
  instanceFile: string,
  template?: string,
): ResolvedTaskTemplate | undefined;
export function resolveTaskTemplate(
  instanceFile: string,
  template?: string,
): ResolvedTaskTemplate | undefined {
  if (fs.existsSync(instanceFile))
    return {
      text: fs.readFileSync(instanceFile, 'utf8'),
      source: 'instance',
      path: instanceFile,
      instanceFile,
      ...(template === undefined ? {} : { template }),
    };
  if (template === undefined) return undefined;
  const file = coreTaskTemplatePath(template);
  if (!fs.existsSync(file))
    throw new Error(`core task template ${template} is missing (${file})`);
  return {
    text: fs.readFileSync(file, 'utf8'),
    source: 'core',
    path: file,
    instanceFile,
    template,
  };
}

/**
 * One line naming the source, for a caller's log or `--print-task`:
 * `task from the instance file <path>`, or
 * `task from core template <name> (no instance file at <path>)`.
 */
export const describeTaskSource = (resolved: ResolvedTaskTemplate): string =>
  resolved.source === 'instance'
    ? `task from the instance file ${resolved.path}`
    : `task from core template ${resolved.template ?? resolved.path} (no instance file at ${resolved.instanceFile})`;

/** `{{> name}}`: include core template `name`. */
const INCLUDE_RE = /\{\{>\s*([^}\s]+)\s*\}\}/g;
/** `{{name}}`: a placeholder. */
const PLACEHOLDER_RE = /\{\{\s*([A-Za-z][\w]*)\s*\}\}/g;

/**
 * Fill a task's includes and placeholders: each `{{> name}}` becomes core
 * template `name` (one level: an included template's own includes are
 * left as they are), then each `{{key}}` becomes `vars[key]`.
 *
 * @throws When a placeholder has no value (naming every missing key), or an
 *   included core template does not exist.
 */
export const fillTaskTemplate = (
  text: string,
  vars: Readonly<Record<string, string>> = {},
): string => {
  const included = text.replace(INCLUDE_RE, (_, name: string) => {
    const file = coreTaskTemplatePath(name);
    if (!fs.existsSync(file))
      throw new Error(`task includes core template ${name}, which is missing`);
    return fs.readFileSync(file, 'utf8').trim();
  });
  const missing = new Set<string>();
  const filled = included.replace(PLACEHOLDER_RE, (match, key: string) => {
    const value = Object.hasOwn(vars, key) ? vars[key] : undefined;
    if (value === undefined) {
      missing.add(key);
      return match;
    }
    return value;
  });
  if (missing.size)
    throw new Error(
      `task template needs a value for ${[...missing].map((k) => `{{${k}}}`).join(', ')}`,
    );
  return filled;
};
