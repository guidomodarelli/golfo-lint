/**
 * @module cli/react-scan/install-react-scan Adds react-scan to a project's devDependencies, at the exact version
 * golfo-lint is tested with, through the project's own package manager.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";

/** @typedef {import("../spawn-tool.js").ToolInvocation} ToolInvocation */
/** @typedef {"npm" | "pnpm" | "yarn" | "bun"} PackageManager */

/**
 * react-scan version golfo-lint is tested with. It is an optional peer dependency: only the React projects that
 * measure re-renders install it.
 */
export const REACT_SCAN_VERSION = "0.5.7";

/** Package that `golfo-lint react-scan` installs. */
export const REACT_SCAN_PACKAGE = "react-scan";

/** Lockfiles that identify the package manager, in order of precedence. */
const LOCKFILE_PACKAGE_MANAGERS = /** @type {{ lockfile: string; packageManager: PackageManager }[]} */ ([
  { lockfile: "pnpm-lock.yaml", packageManager: "pnpm" },
  { lockfile: "yarn.lock", packageManager: "yarn" },
  { lockfile: "bun.lock", packageManager: "bun" },
  { lockfile: "bun.lockb", packageManager: "bun" },
  { lockfile: "package-lock.json", packageManager: "npm" },
]);

/** Package manager of a project without `packageManager` field nor lockfile. */
const DEFAULT_PACKAGE_MANAGER = "npm";

/** Arguments that add an exact devDependency, per package manager. */
const ADD_EXACT_DEV_DEPENDENCY_ARGUMENTS = /** @type {Record<PackageManager, string[]>} */ ({
  npm: ["install", "--save-dev", "--save-exact"],
  pnpm: ["add", "--save-dev", "--save-exact"],
  yarn: ["add", "--dev", "--exact"],
  bun: ["add", "--dev", "--exact"],
});

/**
 * Checks whether a name is one of the supported package managers.
 * @param {string | undefined} name - Name to check.
 * @returns {name is PackageManager} Whether golfo-lint knows how to install with it.
 */
function isPackageManager(name) {
  return name !== undefined && Object.hasOwn(ADD_EXACT_DEV_DEPENDENCY_ARGUMENTS, name);
}

/**
 * Finds the package manager of a project: the `packageManager` field of `package.json`, or the nearest lockfile
 * from the project up to the filesystem root, so a package of a monorepo uses the workspace's one.
 * @param {string} cwd - Project folder.
 * @param {Record<string, unknown>} manifest - Parsed `package.json`.
 * @returns {PackageManager} Package manager to install with.
 */
function detectPackageManager(cwd, manifest) {
  const declaredName = typeof manifest.packageManager === "string" ? manifest.packageManager.split("@")[0] : undefined;
  if (isPackageManager(declaredName)) {
    return declaredName;
  }
  for (let folder = path.resolve(cwd); ; folder = path.dirname(folder)) {
    const match = LOCKFILE_PACKAGE_MANAGERS.find(({ lockfile }) => existsSync(path.join(folder, lockfile)));
    if (match !== undefined) {
      return match.packageManager;
    }
    if (path.dirname(folder) === folder) {
      return DEFAULT_PACKAGE_MANAGER;
    }
  }
}

/**
 * Builds the command that adds react-scan, at its exact version, to a project's devDependencies.
 * @param {string} cwd - Project folder.
 * @param {Record<string, unknown>} manifest - Parsed `package.json`.
 * @returns {ToolInvocation} Command for `runTool`. It goes through a shell on Windows, where package managers are
 * `.cmd` shims; every argument is a fixed literal.
 */
export function createReactScanInstallInvocation(cwd, manifest) {
  const packageManager = detectPackageManager(cwd, manifest);
  return {
    command: packageManager,
    arguments: [...ADD_EXACT_DEV_DEPENDENCY_ARGUMENTS[packageManager], `${REACT_SCAN_PACKAGE}@${REACT_SCAN_VERSION}`],
    cwd,
    shell: process.platform === "win32",
  };
}
