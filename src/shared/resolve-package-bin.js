/**
 * @module shared/resolve-package-bin Finds the executable of an installed package, without depending on what its
 * `exports` expose (jscpd has no importable entry, knip hides `package.json`).
 */
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** File that names a package and declares its executables. */
const PACKAGE_MANIFEST_FILE = "package.json";

/** This module, the default place to search from: the dependencies of `@golfo/lint`. */
const GOLFO_LINT_LOCATION = fileURLToPath(import.meta.url);

/**
 * @typedef {object} PackageManifest
 * @property {string} [name] - Package name.
 * @property {string | Record<string, string>} [bin] - Executables, by name or as the single one.
 */

/**
 * Reads a `package.json`.
 * @param {string} manifestPath - Path of the file.
 * @returns {PackageManifest} Parsed manifest.
 */
function readManifest(manifestPath) {
  return /** @type {PackageManifest} */ (JSON.parse(readFileSync(manifestPath, "utf8")));
}

/**
 * Finds the folder of a package installed in one of the `node_modules` folders Node.js would search from a file.
 * @param {string} packageName - Package to find.
 * @param {string} fromFile - File the search starts from.
 * @returns {string | undefined} Package folder, or `undefined` when it is not installed there.
 */
function findPackageRoot(packageName, fromFile) {
  const searchedFolders = createRequire(fromFile).resolve.paths(packageName) ?? [];
  return searchedFolders
    .map((nodeModulesFolder) => path.join(nodeModulesFolder, packageName))
    .find((packageFolder) => existsSync(path.join(packageFolder, PACKAGE_MANIFEST_FILE)));
}

/**
 * Resolves the absolute path of an executable a package declares in `bin`.
 * @param {string} packageName - Package that declares the executable.
 * @param {string} binName - Executable name, as declared in `bin`.
 * @param {{ projectDirectory?: string }} [options] - With `projectDirectory`, the project's own installation is
 * searched first: for optional tools, such as react-doctor, that the project installs itself.
 * @returns {string | undefined} Absolute path of the executable script, to run with `node`, or `undefined` when
 * the package is not installed.
 */
export function resolvePackageBin(packageName, binName, options = {}) {
  const searchOrigins = [
    ...(options.projectDirectory === undefined ? [] : [path.join(options.projectDirectory, PACKAGE_MANIFEST_FILE)]),
    GOLFO_LINT_LOCATION,
  ];
  const packageRoot = searchOrigins
    .map((origin) => findPackageRoot(packageName, origin))
    .find((root) => root !== undefined);
  if (packageRoot === undefined) {
    return undefined;
  }
  const { bin } = readManifest(path.join(packageRoot, PACKAGE_MANIFEST_FILE));
  const binPath = typeof bin === "string" ? bin : bin?.[binName];
  if (binPath === undefined) {
    throw new Error(`resolvePackageBin: ${packageName} no declara el ejecutable ${binName} en "bin".`);
  }
  return path.join(packageRoot, binPath);
}
