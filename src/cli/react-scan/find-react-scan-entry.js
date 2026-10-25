/**
 * @module cli/react-scan/find-react-scan-entry Finds the file that starts a React app in the browser, where
 * `golfo-lint react-scan` calls `startReactScan()`: `instrumentation-client` in Next.js (App and Pages Router) and
 * the module that `index.html` loads in Vite.
 */
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { declaresDependency, hasAnyPath } from "../command-helpers.js";

/**
 * @typedef {object} ReactScanEntry
 * @property {string} framework - Framework name, for the messages.
 * @property {string} relativePath - Entry file, relative to the project, with forward slashes.
 */

/** First Next.js version that runs `instrumentation-client` in the browser, in the App and the Pages Router. */
const NEXT_INSTRUMENTATION_CLIENT_MINIMUM_VERSION = { major: 15, minor: 3 };

/** Name of the Next.js client instrumentation file, without extension. */
const NEXT_INSTRUMENTATION_CLIENT_NAME = "instrumentation-client";

/** Extensions Next.js accepts for `instrumentation-client`, in the order they are searched. */
const NEXT_INSTRUMENTATION_CLIENT_EXTENSIONS = ["ts", "tsx", "js", "jsx", "mjs"];

/** Router folders that, under `src/`, make Next.js look for `instrumentation-client` in `src/` too. */
const NEXT_SOURCE_ROUTER_FOLDERS = ["src/app", "src/pages"];

/** File that makes a project TypeScript, so the new entry is a `.ts` file. */
const TYPESCRIPT_CONFIG_FILE = "tsconfig.json";

/** HTML page that Vite serves and builds from. */
const VITE_INDEX_HTML = "index.html";

/** Opening `<script>` tags of an HTML page. */
const SCRIPT_TAG_PATTERN = /<script\b[^>]*>/giu;

/** `type="module"` attribute of a script tag. */
const MODULE_TYPE_PATTERN = /\btype\s*=\s*["']module["']/iu;

/** `src` attribute of a script tag, captured. */
const SCRIPT_SOURCE_PATTERN = /\bsrc\s*=\s*["']([^"']+)["']/iu;

/** Script sources served from another host, which are never the app's entry. */
const REMOTE_SOURCE_PATTERN = /^(?:[a-z]+:)?\/\//iu;

/** `major.minor` at the start of a version or a version range such as `^15.3.0`. */
const VERSION_PATTERN = /(\d+)(?:\.(\d+))?/u;

/**
 * Converts a path relative to the project to forward slashes, as the messages and diffs show it.
 * @param {string} relativePath - Path relative to the project.
 * @returns {string} Same path with `/`.
 */
function toPosixPath(relativePath) {
  return relativePath.split(path.sep).join("/");
}

/**
 * Reads the Next.js version the project uses: the installed one or, before installing, the declared range.
 * @param {string} cwd - Project folder.
 * @param {Record<string, unknown>} manifest - Parsed `package.json`.
 * @returns {string | undefined} Version or range, or `undefined` when unknown.
 */
function readNextVersion(cwd, manifest) {
  try {
    const nextManifestPath = createRequire(path.join(cwd, "package.json")).resolve("next/package.json");
    return /** @type {{ version?: string }} */ (JSON.parse(readFileSync(nextManifestPath, "utf8"))).version;
  } catch {
    // Not installed yet: the declared range says which version the project will get.
    const dependencies = /** @type {Record<string, unknown>} */ ({
      .../** @type {object} */ (manifest.devDependencies),
      .../** @type {object} */ (manifest.dependencies),
    });
    return typeof dependencies.next === "string" ? dependencies.next : undefined;
  }
}

/**
 * Checks whether a Next.js version runs `instrumentation-client` in the browser.
 * @param {string | undefined} version - Version or range; unknown versions (`latest`, `canary`) are accepted.
 * @returns {boolean} Whether `instrumentation-client` is supported.
 */
function supportsInstrumentationClient(version) {
  const match = version === undefined ? undefined : VERSION_PATTERN.exec(version);
  if (match === null || match === undefined) {
    return true;
  }
  const major = Number(match[1]);
  const minor = Number(match[2] ?? 0);
  const minimum = NEXT_INSTRUMENTATION_CLIENT_MINIMUM_VERSION;
  return major > minimum.major || (major === minimum.major && minor >= minimum.minor);
}

/**
 * Finds the `instrumentation-client` file of a Next.js project, or where to create it.
 * @param {string} cwd - Project folder.
 * @returns {string} Path relative to the project.
 */
function findNextInstrumentationClient(cwd) {
  const folder = hasAnyPath(cwd, NEXT_SOURCE_ROUTER_FOLDERS) ? "src" : "";
  const candidates = NEXT_INSTRUMENTATION_CLIENT_EXTENSIONS.map((extension) =>
    path.join(folder, `${NEXT_INSTRUMENTATION_CLIENT_NAME}.${extension}`),
  );
  const existing = candidates.find((candidate) => existsSync(path.join(cwd, candidate)));
  const newExtension = hasAnyPath(cwd, [TYPESCRIPT_CONFIG_FILE]) ? "ts" : "js";
  return existing ?? path.join(folder, `${NEXT_INSTRUMENTATION_CLIENT_NAME}.${newExtension}`);
}

/**
 * Finds the module that Vite's `index.html` loads.
 * @param {string} cwd - Project folder.
 * @returns {string | undefined} Path relative to the project, or `undefined` when there is none.
 */
function findViteEntry(cwd) {
  const indexHtmlPath = path.join(cwd, VITE_INDEX_HTML);
  if (!existsSync(indexHtmlPath)) {
    return undefined;
  }
  const localSources = (readFileSync(indexHtmlPath, "utf8").match(SCRIPT_TAG_PATTERN) ?? []).flatMap((scriptTag) => {
    const source = MODULE_TYPE_PATTERN.test(scriptTag) ? SCRIPT_SOURCE_PATTERN.exec(scriptTag)?.[1] : undefined;
    // Vite resolves a leading `/` from the project root.
    return source === undefined || REMOTE_SOURCE_PATTERN.test(source) ? [] : [path.normalize(source.replace(/^\//u, ""))];
  });
  return localSources.find((source) => existsSync(path.join(cwd, source)));
}

/**
 * Finds where `golfo-lint react-scan` connects react-scan in a project.
 * @param {string} cwd - Project folder.
 * @param {Record<string, unknown>} manifest - Parsed `package.json`.
 * @returns {ReactScanEntry | { failure: string }} Entry file, or why it could not be found.
 */
export function findReactScanEntry(cwd, manifest) {
  if (declaresDependency(manifest, "next")) {
    const nextVersion = readNextVersion(cwd, manifest);
    if (!supportsInstrumentationClient(nextVersion)) {
      return { failure: `Next.js ${String(nextVersion)}, anterior a 15.3, que no tiene instrumentation-client` };
    }
    return { framework: "Next.js", relativePath: toPosixPath(findNextInstrumentationClient(cwd)) };
  }
  if (declaresDependency(manifest, "vite")) {
    const viteEntry = findViteEntry(cwd);
    return viteEntry === undefined
      ? { failure: `un <script type="module" src="..."> local en ${VITE_INDEX_HTML}` }
      : { framework: "Vite", relativePath: toPosixPath(viteEntry) };
  }
  return { failure: "Next.js ni Vite en package.json" };
}
