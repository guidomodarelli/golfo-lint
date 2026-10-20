/**
 * @module shared/thresholds Size and complexity limits shared by ESLint and lizard, so both tools flag the
 * same functions: ESLint gives feedback in the editor and lizard checks the whole repository.
 */

/** Highest cyclomatic complexity a function may have. */
export const MAX_CYCLOMATIC_COMPLEXITY = 10;

/** Highest cognitive complexity a function may have (SonarJS). */
export const MAX_COGNITIVE_COMPLEXITY = 15;

/** Most lines of code a function may span, not counting blank lines and comments. */
export const MAX_FUNCTION_LINES = 80;

/** Most parameters a function may declare; more than this calls for an options object. */
export const MAX_FUNCTION_PARAMETERS = 4;

/** Deepest nesting of blocks inside a function. */
export const MAX_NESTING_DEPTH = 4;

/** Deepest nesting of callbacks inside a function. */
export const MAX_NESTED_CALLBACKS = 3;

/** Paths that every tool skips: dependencies, build output and generated reports. */
export const IGNORED_PATH_GLOBS = [
  "**/node_modules/**",
  "**/dist/**",
  "**/build/**",
  "**/out/**",
  "**/coverage/**",
  "**/.next/**",
  "**/.turbo/**",
  "**/.vercel/**",
  "**/report/**",
];

/** Test files, which get relaxed limits: their length comes from the cases they list, not from logic. */
export const TEST_FILE_GLOBS = [
  "**/*.{test,spec}.{js,jsx,mjs,cjs,ts,tsx,mts,cts}",
  "**/test/**",
  "**/tests/**",
  "**/__tests__/**",
  "**/e2e/**",
];
