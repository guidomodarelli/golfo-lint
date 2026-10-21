/**
 * @module lizard/create-lizard-arguments Defaults for lizard, the cyclomatic complexity analyzer. It uses the
 * same limits as the ESLint preset, so both tools flag the same functions.
 */
import { MAX_CYCLOMATIC_COMPLEXITY, MAX_FUNCTION_LINES } from "../shared/thresholds.js";

/** lizard version run through `uvx` when lizard is not installed. */
export const LIZARD_VERSION = "1.24.1";

/** Languages analyzed, as lizard names them. */
const ANALYZED_LANGUAGES = ["javascript", "typescript", "tsx"];

/**
 * Paths lizard skips, as `fnmatch` patterns: dependencies, build output and tests (whose long `describe`
 * callbacks list cases, not logic).
 */
const EXCLUDED_PATH_PATTERNS = [
  "*/node_modules/*",
  "*/dist/*",
  "*/build/*",
  "*/out/*",
  "*/coverage/*",
  "*/.next/*",
  "*/test/*",
  "*/tests/*",
  "*/__tests__/*",
  "*/e2e/*",
  "*.test.*",
  "*.spec.*",
];

/**
 * Limits that `golfo-lint complexity` enforces per function. There is no parameter limit: lizard counts each
 * destructured property as a parameter, so a React component that takes one `props` object would fail. ESLint's
 * `max-params` checks parameters instead.
 */
export const LIZARD_DEFAULTS = {
  maxCyclomaticComplexity: MAX_CYCLOMATIC_COMPLEXITY,
  maxLinesOfCode: MAX_FUNCTION_LINES,
  languages: ANALYZED_LANGUAGES,
  exclude: EXCLUDED_PATH_PATTERNS,
};

/**
 * Builds the lizard flags that report only the functions above the limits and fail when there is any.
 * @param {Partial<typeof LIZARD_DEFAULTS>} [overrides] - Values that replace the defaults.
 * @returns {string[]} Flags to pass before the paths.
 */
export function createLizardArguments(overrides = {}) {
  const config = { ...LIZARD_DEFAULTS, ...overrides };
  return [
    "--warnings_only",
    "--CCN",
    String(config.maxCyclomaticComplexity),
    "--Threshold",
    `nloc=${String(config.maxLinesOfCode)}`,
    ...config.languages.flatMap((language) => ["--languages", language]),
    ...config.exclude.flatMap((pattern) => ["--exclude", pattern]),
  ];
}
