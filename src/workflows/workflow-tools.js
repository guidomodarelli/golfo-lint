/**
 * @module workflows/workflow-tools How to run the GitHub Actions linters: actionlint (syntax, expressions,
 * shell scripts) and zizmor (security: injections, unpinned actions, leaked credentials). Both ship as Python
 * packages, so `uvx` runs pinned versions when they are not installed.
 */

/** @typedef {import("../shared/find-external-command.js").ToolCommand} ToolCommand */

/**
 * actionlint version run through `uvx`, from the `actionlint-py` package that bundles its binary. The package
 * adds a fourth number for its own releases, so the requirement takes any of them for actionlint 1.7.12.
 */
const ACTIONLINT_PY_REQUIREMENT = "actionlint-py~=1.7.12.0";

/** zizmor version run through `uvx`. */
const ZIZMOR_VERSION = "1.31.1";

/** Folder that holds the GitHub Actions workflows. */
export const WORKFLOWS_DIRECTORY = ".github/workflows";

/**
 * Lowest zizmor severity that fails the check. Lower ones (`help`, `informational`, `low`) are hardening
 * advice whose fix depends on the workflow, such as tags pushed with persisted credentials.
 */
const ZIZMOR_MIN_SEVERITY = "medium";

/** Ways to run actionlint, in order of preference. */
export const ACTIONLINT_CANDIDATES = /** @type {ToolCommand[]} */ ([
  { command: "actionlint", prefixArguments: [] },
  { command: "uvx", prefixArguments: ["--from", ACTIONLINT_PY_REQUIREMENT, "actionlint"] },
]);

/** Ways to run zizmor, in order of preference. */
export const ZIZMOR_CANDIDATES = /** @type {ToolCommand[]} */ ([
  { command: "zizmor", prefixArguments: [] },
  { command: "uvx", prefixArguments: [`zizmor@${ZIZMOR_VERSION}`] },
]);

/**
 * Builds the zizmor flags that fail on medium or higher findings.
 * @returns {string[]} Flags to pass before the path.
 */
export function createZizmorArguments() {
  return ["--no-progress", "--min-severity", ZIZMOR_MIN_SEVERITY];
}
