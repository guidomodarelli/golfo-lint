/** @module knip/create-knip-config Defaults for knip, the unused files, exports and dependencies finder. */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

/**
 * @typedef {object} KnipConfig
 * @property {Record<string, boolean> | boolean} [ignoreExportsUsedInFile] - Export kinds that may stay exported
 * while only their own file uses them.
 * @property {string[]} [ignore] - Files to leave out of the report.
 * @property {string[]} [ignoreDependencies] - Dependencies to leave out of the report.
 * @property {string[]} [ignoreBinaries] - Executables to leave out of the report.
 * @property {string[]} [entry] - Entry files, when knip's plugins do not find them.
 * @property {string[]} [project] - Files that make up the project.
 */

/** Folders and names of the entry files knip uses when a config sets none: `{index,cli,main}` in the root and `src`. */
const KNIP_DEFAULT_ENTRY_FOLDERS = ["", "src"];
const KNIP_DEFAULT_ENTRY_NAMES = ["index", "cli", "main"];

/** Extensions of JavaScript and TypeScript modules. */
const MODULE_EXTENSIONS = ["js", "cjs", "mjs", "jsx", "ts", "cts", "mts", "tsx"];

/** Folders that hold the code of the golfo projects, searched for imports of the Next.js built-in packages. */
const SOURCE_FOLDERS = ["app", "pages", "src", "components", "lib", "hooks"];

/** Folders never searched: dependencies and build output. */
const SKIPPED_FOLDERS = new Set(["node_modules", ".next", "dist", "build", "out", "coverage"]);

/**
 * Configs of `@golfo/rp`, which knip has no plugin for: `golfo-rp create-version` imports the file and reads its
 * exports (`ci`, the default config).
 */
const GOLFO_RP_CONFIG_FILES = ["golfo-rp.config.js", "golfo-rp.config.cjs", "golfo-rp.config.mjs", "golfo-rp.config.ts"];

/**
 * Packages Next.js resolves by itself: `server-only` and `client-only` work without installing them, and the
 * Next.js docs make installing them optional.
 */
const NEXT_BUILT_IN_PACKAGES = ["server-only", "client-only"];

/** Package that makes a project a Next.js app. */
const NEXT_PACKAGE = "next";

/** Package of the Playwright test runner. */
const PLAYWRIGHT_PACKAGE = "@playwright/test";

/**
 * Playwright configs: the default `playwright.config.ts` and the ones a project keeps for other suites
 * (`playwright.ui.config.ts`), which a script passes with `--config` and knip's Playwright plugin does not find.
 */
const PLAYWRIGHT_CONFIG_PATTERN = /^playwright(?:\.[\w-]+)?\.config\.[cm]?[jt]s$/u;

/**
 * Entry files that tools other than knip's plugins load, kept only when they exist:
 * - `open-next.config.ts`, read by OpenNext when it builds a Next.js app for Cloudflare;
 * - the scripts `@golfo/rp` writes to `.golfo-rp/` (`vercel.json` runs `.golfo-rp/vercel-ignore-build.mjs`);
 * - `scripts/`, Node.js scripts that people and CI jobs run by path (`node scripts/configure-cors.mjs`).
 */
const TOOL_ENTRY_FILES = [
  { path: "open-next.config.ts", pattern: "open-next.config.ts" },
  { path: ".golfo-rp", pattern: ".golfo-rp/*.{js,cjs,mjs}" },
  { path: "scripts", pattern: `scripts/**/*.{${MODULE_EXTENSIONS.join(",")}}` },
];

/** Dependency fields where a project declares the packages it uses. */
const DEPENDENCY_FIELDS = ["dependencies", "devDependencies", "peerDependencies"];

/**
 * Defaults of the shared knip config. Types and interfaces may be exported from the file that uses them,
 * since exporting them documents a contract; any other unused export is reported.
 * @type {KnipConfig}
 */
export const KNIP_DEFAULTS = {
  ignoreExportsUsedInFile: { interface: true, type: true },
};

/**
 * Reads the packages a project declares in any dependency field.
 * @param {string} projectDirectory - Folder with the project's `package.json`.
 * @returns {Set<string>} Declared package names.
 */
function readDeclaredPackages(projectDirectory) {
  const manifestPath = path.join(projectDirectory, "package.json");
  if (!existsSync(manifestPath)) {
    return new Set();
  }
  const manifest = /** @type {Record<string, unknown>} */ (JSON.parse(readFileSync(manifestPath, "utf8")));
  return new Set(
    DEPENDENCY_FIELDS.flatMap((field) => {
      const dependencies = manifest[field];
      return typeof dependencies === "object" && dependencies !== null ? Object.keys(dependencies) : [];
    }),
  );
}

/**
 * Lists the entry files a project needs besides the ones knip's plugins find: its `@golfo/rp` config and the files
 * of `TOOL_ENTRY_FILES` that exist, along with knip's own defaults, which an `entry` option would otherwise replace.
 * @param {string} projectDirectory - Folder of the project.
 * @param {string[]} projectEntries - Entry patterns the project adds.
 * @returns {string[] | undefined} Entry patterns, or `undefined` to keep knip's defaults.
 */
function listEntryFiles(projectDirectory, projectEntries) {
  const golfoRpConfig = GOLFO_RP_CONFIG_FILES.find((fileName) => existsSync(path.join(projectDirectory, fileName)));
  const toolEntries = TOOL_ENTRY_FILES.filter((entry) => existsSync(path.join(projectDirectory, entry.path))).map(
    (entry) => entry.pattern,
  );
  const extraEntries = [...(golfoRpConfig === undefined ? [] : [golfoRpConfig]), ...toolEntries, ...projectEntries];
  if (extraEntries.length === 0) {
    return undefined;
  }
  // Only the default entries that exist: knip hints to remove patterns that match nothing.
  const defaultEntries = KNIP_DEFAULT_ENTRY_FOLDERS.flatMap((folder) =>
    KNIP_DEFAULT_ENTRY_NAMES.flatMap((name) =>
      MODULE_EXTENSIONS.map((extension) => path.posix.join(folder, `${name}.${extension}`)),
    ),
  ).filter((entryFile) => existsSync(path.join(projectDirectory, entryFile)));
  return [...defaultEntries, ...extraEntries];
}

/**
 * Lists the Playwright configs in the root of a project that uses Playwright.
 * @param {string} projectDirectory - Folder of the project.
 * @param {Set<string>} declaredPackages - Packages the project declares.
 * @returns {string[]} Config files, empty when there are none or the project does not use Playwright.
 */
function listPlaywrightConfigs(projectDirectory, declaredPackages) {
  if (!declaredPackages.has(PLAYWRIGHT_PACKAGE)) {
    return [];
  }
  return readdirSync(projectDirectory).filter((fileName) => PLAYWRIGHT_CONFIG_PATTERN.test(fileName));
}

/**
 * Lists the module files under a folder, skipping dependencies and build output.
 * @param {string} folder - Folder to walk.
 * @returns {string[]} Absolute paths.
 */
function listModuleFiles(folder) {
  if (!existsSync(folder)) {
    return [];
  }
  return readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(folder, entry.name);
    if (entry.isDirectory()) {
      return SKIPPED_FOLDERS.has(entry.name) ? [] : listModuleFiles(entryPath);
    }
    return MODULE_EXTENSIONS.includes(path.extname(entry.name).slice(1)) ? [entryPath] : [];
  });
}

/**
 * Lists the Next.js built-in packages the project imports. Only those are ignored: knip hints to remove an ignored
 * dependency that nothing uses.
 * @param {string} projectDirectory - Folder of the project.
 * @returns {string[]} Imported built-in packages.
 */
function listImportedBuiltInPackages(projectDirectory) {
  const sources = SOURCE_FOLDERS.flatMap((folder) => listModuleFiles(path.join(projectDirectory, folder))).map(
    (filePath) => readFileSync(filePath, "utf8"),
  );
  return NEXT_BUILT_IN_PACKAGES.filter((packageName) =>
    sources.some((source) => source.includes(`"${packageName}"`) || source.includes(`'${packageName}'`)),
  );
}

/**
 * Builds a knip config from the shared defaults, to export from `knip.config.js`. It adds as entries the `@golfo/rp`
 * config, the files other tools load (`TOOL_ENTRY_FILES`) and every Playwright config; in a Next.js project, it
 * accepts `server-only` and `client-only` without declaring them.
 * @param {KnipConfig & Record<string, unknown>} [overrides] - Project values that replace the defaults; `entry`
 * and `ignoreDependencies` add to the defaults instead.
 * @param {{ projectDirectory?: string }} [options] - Folder of the project (default: the current one).
 * @returns {KnipConfig & Record<string, unknown>} knip config.
 */
export function createKnipConfig(overrides = {}, options = {}) {
  const projectDirectory = options.projectDirectory ?? process.cwd();
  const declaredPackages = readDeclaredPackages(projectDirectory);
  const builtInPackages = declaredPackages.has(NEXT_PACKAGE) ? listImportedBuiltInPackages(projectDirectory) : [];
  const ignoreDependencies = [...builtInPackages, ...(overrides.ignoreDependencies ?? [])];
  const entry = listEntryFiles(projectDirectory, overrides.entry ?? []);
  const playwrightConfigs = listPlaywrightConfigs(projectDirectory, declaredPackages);
  return {
    ...KNIP_DEFAULTS,
    ...(playwrightConfigs.length > 0 ? { playwright: { config: playwrightConfigs } } : {}),
    ...overrides,
    ...(entry === undefined ? {} : { entry }),
    ...(ignoreDependencies.length > 0 ? { ignoreDependencies } : {}),
  };
}
