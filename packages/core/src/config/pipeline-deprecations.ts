/**
 * @module config/pipeline-deprecations
 *
 * Once-per-process `pipeline:` deprecation warnings, shared by the
 * pipeline config schemas. Ported from `jeeves-scripts-template`
 * `src/lib/pipeline-config-deprecations.ts` (template `main` at
 * `322054c`).
 */

const warnedDeprecations = new Set<string>();

/**
 * Log a one-line `pipeline:` deprecation warning, at most once per
 * process for each message (cleared by {@link clearDeprecationWarnings}).
 */
export const warnDeprecated = (message: string): void => {
  if (warnedDeprecations.has(message)) return;
  warnedDeprecations.add(message);
  console.warn(`pipeline: ${message}`);
};

/** Forget which warnings were logged (config reset, tests). */
export const clearDeprecationWarnings = (): void => {
  warnedDeprecations.clear();
};
