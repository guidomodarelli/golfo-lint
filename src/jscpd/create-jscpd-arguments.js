/** @module jscpd/create-jscpd-arguments Defaults for jscpd, the copy/paste detector. */
import { expandBraces } from "../shared/expand-braces.js";
import { IGNORED_PATH_GLOBS, TEST_FILE_GLOBS } from "../shared/thresholds.js";

/** Fewest tokens a repeated block needs to count as a clone: below this, repetition is idiomatic code. */
const MIN_CLONE_TOKENS = 50;

/** Fewest lines a repeated block needs to count as a clone. */
const MIN_CLONE_LINES = 5;

/**
 * Highest share of duplicated lines, in percent, before jscpd fails. Above it jscpd exits with 1; below it the
 * clones are listed and it exits with 0. jscpd's `--exit-code` is not passed: it fails on any clone, whatever the
 * threshold.
 */
const MAX_DUPLICATION_PERCENT = 1;

/** Languages checked for clones. */
const CHECKED_FORMATS = ["javascript", "typescript", "jsx", "tsx", "css", "scss"];

/** Defaults of `golfo-lint duplicates`, in the shape of a `.jscpd.json` file. */
export const JSCPD_DEFAULTS = {
  minTokens: MIN_CLONE_TOKENS,
  minLines: MIN_CLONE_LINES,
  threshold: MAX_DUPLICATION_PERCENT,
  format: CHECKED_FORMATS,
  // jscpd splits `--ignore` on commas, so brace groups have to be expanded first.
  ignore: [...IGNORED_PATH_GLOBS, ...TEST_FILE_GLOBS].flatMap((glob) => expandBraces(glob)),
  reporters: ["console"],
};

/**
 * Builds the jscpd command-line flags for the defaults, merged with project overrides.
 * @param {Partial<typeof JSCPD_DEFAULTS>} [overrides] - Values that replace the defaults.
 * @returns {string[]} Flags to pass before the paths.
 */
export function createJscpdArguments(overrides = {}) {
  const config = { ...JSCPD_DEFAULTS, ...overrides };
  return [
    "--min-tokens",
    String(config.minTokens),
    "--min-lines",
    String(config.minLines),
    "--threshold",
    String(config.threshold),
    "--format",
    config.format.join(","),
    "--ignore",
    config.ignore.join(","),
    "--reporters",
    config.reporters.join(","),
  ];
}
