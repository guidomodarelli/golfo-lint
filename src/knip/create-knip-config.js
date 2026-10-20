/** @module knip/create-knip-config Defaults for knip, the unused files, exports and dependencies finder. */

/**
 * @typedef {object} KnipConfig
 * @property {Record<string, boolean> | boolean} [ignoreExportsUsedInFile] - Export kinds that may stay exported
 * while only their own file uses them.
 * @property {string[]} [ignore] - Files to leave out of the report.
 * @property {string[]} [ignoreDependencies] - Dependencies to leave out of the report.
 * @property {string[]} [entry] - Entry files, when knip's plugins do not find them.
 * @property {string[]} [project] - Files that make up the project.
 */

/**
 * Defaults of the shared knip config. Types and interfaces may be exported from the file that uses them,
 * since exporting them documents a contract; any other unused export is reported.
 * @type {KnipConfig}
 */
export const KNIP_DEFAULTS = {
  ignoreExportsUsedInFile: { interface: true, type: true },
};

/**
 * Builds a knip config from the shared defaults, to export from `knip.config.js`.
 * @param {KnipConfig & Record<string, unknown>} [overrides] - Project values that replace the defaults.
 * @returns {KnipConfig & Record<string, unknown>} knip config.
 */
export function createKnipConfig(overrides = {}) {
  return { ...KNIP_DEFAULTS, ...overrides };
}
