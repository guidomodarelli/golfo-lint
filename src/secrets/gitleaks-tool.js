/**
 * @module secrets/gitleaks-tool How to run gitleaks, the secret scanner. It ships only as a Go binary (no npm or
 * PyPI package), so it has to be installed; CI downloads a pinned release.
 */

/** @typedef {import("../shared/find-external-command.js").ToolCommand} ToolCommand */

/** gitleaks release the CI of this package installs. */
export const GITLEAKS_VERSION = "8.30.1";

/** Ways to run gitleaks. */
export const GITLEAKS_CANDIDATES = /** @type {ToolCommand[]} */ ([{ command: "gitleaks", prefixArguments: [] }]);

/**
 * Builds the gitleaks arguments: the whole git history inside a repository, the files of the folder otherwise.
 * Findings are redacted so the secret never reaches the terminal or CI logs.
 * @param {{ isGitRepository: boolean; path: string }} target - What to scan.
 * @returns {string[]} Arguments for gitleaks.
 */
export function createGitleaksArguments(target) {
  const mode = target.isGitRepository ? "git" : "dir";
  return [mode, "--redact", "--no-banner", "--verbose", target.path];
}
