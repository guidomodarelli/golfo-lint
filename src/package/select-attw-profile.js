/**
 * @module package/select-attw-profile Chooses how strictly Are the Types Wrong checks a package: an ESM-only
 * package is not expected to load through `require`.
 */

/** Condition that marks an export as loadable through `require`. */
const REQUIRE_CONDITION = "require";

/** Module system Node.js gives `.js` files when `package.json` says `"type": "module"`. */
const ESM_PACKAGE_TYPE = "module";

/**
 * Checks whether an `exports` value declares a `require` condition at any depth.
 * @param {unknown} exportsValue - Value of `exports`, or one of its branches.
 * @returns {boolean} Whether CommonJS consumers get an entry.
 */
function declaresRequireCondition(exportsValue) {
  if (exportsValue === null || typeof exportsValue !== "object") {
    return false;
  }
  return Object.entries(exportsValue).some(
    ([condition, branch]) => condition === REQUIRE_CONDITION || declaresRequireCondition(branch),
  );
}

/**
 * Returns the attw profile for a package: `esm-only` when it is ESM and offers no `require` entry, `node16`
 * otherwise (which still checks both module systems of modern Node.js).
 * @param {{ type?: string; exports?: unknown }} manifest - The package's `package.json`.
 * @returns {"esm-only" | "node16"} attw `--profile` value.
 */
export function selectAttwProfile(manifest) {
  const isEsmOnly = manifest.type === ESM_PACKAGE_TYPE && !declaresRequireCondition(manifest.exports);
  return isEsmOnly ? "esm-only" : "node16";
}
