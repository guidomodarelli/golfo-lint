/**
 * @module dependency-cruiser/typescript-resolution-hook Makes dependency-cruiser use the TypeScript that
 * `@golfo/lint` ships. dependency-cruiser does not declare `typescript`: it imports whichever one Node.js finds
 * from its own folder, which is the project's. When the project uses TypeScript 7, whose compiler API
 * dependency-cruiser does not support, it silently skips every `.ts` file and the architecture check passes
 * without analyzing anything. `golfo-lint architecture` loads this module with `--import` before dependency-cruiser.
 */
import { createRequire, registerHooks } from "node:module";
import { pathToFileURL } from "node:url";

/** Package whose resolution is redirected. */
const TYPESCRIPT_PACKAGE = "typescript";

/** Part of the path of every installed dependency-cruiser module, with npm and with pnpm. */
const DEPENDENCY_CRUISER_PATH_SEGMENT = "/node_modules/dependency-cruiser/";

/**
 * Checks whether an import asks for the TypeScript compiler or one of its files.
 * @param {string} specifier - What the module imports.
 * @returns {boolean} Whether it is `typescript` or `typescript/...`.
 */
function isTypescriptSpecifier(specifier) {
  return specifier === TYPESCRIPT_PACKAGE || specifier.startsWith(`${TYPESCRIPT_PACKAGE}/`);
}

/** Resolves modules from this package, whose dependencies hold the TypeScript dependency-cruiser supports. */
const resolveFromGolfoLint = createRequire(import.meta.url).resolve;

registerHooks({
  resolve(specifier, context, nextResolve) {
    const importedByDependencyCruiser = context.parentURL?.includes(DEPENDENCY_CRUISER_PATH_SEGMENT) === true;
    if (importedByDependencyCruiser && isTypescriptSpecifier(specifier)) {
      // Resolved here instead of through `nextResolve` with another parent: for `require()` (dependency-cruiser reads
      // `typescript/package.json` to check the version), Node.js ignores a changed `parentURL`.
      return { url: pathToFileURL(resolveFromGolfoLint(specifier)).href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});
