/** @module shared/resolve-package-bin Finds the executable of a package installed next to `@golfo/lint`. */
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** File that names a package and declares its executables. */
const PACKAGE_MANIFEST_FILE = "package.json";

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
 * Walks up from the entry file of a package to the folder that holds its `package.json`. Works for packages
 * whose `exports` hide `package.json`.
 * @param {string} packageName - Package to find.
 * @returns {string} Package folder.
 */
function findPackageRootFromEntry(packageName) {
  const entryPath = fileURLToPath(import.meta.resolve(packageName));
  let directory = path.dirname(entryPath);
  while (directory !== path.dirname(directory)) {
    const manifestPath = path.join(directory, PACKAGE_MANIFEST_FILE);
    if (existsSync(manifestPath) && readManifest(manifestPath).name === packageName) {
      return directory;
    }
    directory = path.dirname(directory);
  }
  throw new Error(`resolvePackageBin: no se encontró el package.json de ${packageName} desde ${entryPath}.`);
}

/**
 * Finds the folder of an installed package: through its `package.json` when `exports` allows it, through its
 * entry file otherwise (some packages, like jscpd, have no importable entry; others, like knip, hide
 * `package.json`).
 * @param {string} packageName - Package to find.
 * @returns {string} Package folder.
 */
function findPackageRoot(packageName) {
  try {
    return path.dirname(createRequire(import.meta.url).resolve(`${packageName}/${PACKAGE_MANIFEST_FILE}`));
  } catch {
    return findPackageRootFromEntry(packageName);
  }
}

/**
 * Resolves the absolute path of an executable that a dependency of `@golfo/lint` declares in `bin`.
 * @param {string} packageName - Dependency that declares the executable.
 * @param {string} binName - Executable name, as declared in `bin`.
 * @returns {string} Absolute path of the executable script, to run with `node`.
 */
export function resolvePackageBin(packageName, binName) {
  const packageRoot = findPackageRoot(packageName);
  const { bin } = readManifest(path.join(packageRoot, PACKAGE_MANIFEST_FILE));
  const binPath = typeof bin === "string" ? bin : bin?.[binName];
  if (binPath === undefined) {
    throw new Error(`resolvePackageBin: ${packageName} no declara el ejecutable ${binName} en "bin".`);
  }
  return path.join(packageRoot, binPath);
}
