/**
 * @module secrets/gitleaks-tool How to run gitleaks, the secret scanner. It ships only as a Go binary (no npm or
 * PyPI package), so it has to be installed; CI downloads a pinned release.
 */
import { fileURLToPath } from "node:url";

/** @typedef {import("../shared/find-external-command.js").ToolCommand} ToolCommand */

/** gitleaks release the CI of this package installs. */
export const GITLEAKS_VERSION = "8.30.1";

/** File where a project keeps its own gitleaks config, which gitleaks reads by itself. */
export const GITLEAKS_PROJECT_CONFIG_FILE = ".gitleaks.toml";

/** Shared config: every default rule, without the generic rule in tests and Markdown. */
const SHARED_CONFIG_PATH = fileURLToPath(new URL("gitleaks.toml", import.meta.url));

/** Ways to run gitleaks. */
export const GITLEAKS_CANDIDATES = /** @type {ToolCommand[]} */ ([{ command: "gitleaks", prefixArguments: [] }]);

/**
 * @typedef {object} GitleaksTarget
 * @property {boolean} isGitRepository - Whether to scan the git history instead of the files of the folder.
 * @property {boolean} hasProjectConfig - Whether the project has its own `.gitleaks.toml`.
 * @property {string} path - Folder to scan.
 */

/**
 * Builds the gitleaks arguments: the whole git history inside a repository, the files of the folder otherwise.
 * Findings are redacted so the secret never reaches the terminal or CI logs.
 * @param {GitleaksTarget} target - What to scan.
 * @returns {string[]} Arguments for gitleaks.
 */
export function createGitleaksArguments(target) {
  const mode = target.isGitRepository ? "git" : "dir";
  const configArguments = target.hasProjectConfig ? [] : ["--config", SHARED_CONFIG_PATH];
  return [mode, "--redact", "--no-banner", "--verbose", ...configArguments, target.path];
}
