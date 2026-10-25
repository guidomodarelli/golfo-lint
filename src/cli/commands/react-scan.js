/**
 * @module cli/commands/react-scan `golfo-lint react-scan`: installs react-scan and connects it to the app through
 * `@golfo/lint/react-scan`, so it highlights re-renders in development. It measures instead of failing, so it is not
 * part of `golfo-lint all`.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { declaresDependency, dependsOnReact, readProjectManifest } from "../command-helpers.js";
import { EXIT_CODE_SETUP_NOT_DETECTED, EXIT_CODE_SUCCESS } from "../constants.js";
import { findReactScanEntry } from "../react-scan/find-react-scan-entry.js";
import { formatFileDiff } from "../react-scan/format-file-diff.js";
import { createReactScanInstallInvocation, REACT_SCAN_PACKAGE, REACT_SCAN_VERSION } from "../react-scan/install-react-scan.js";

/** @typedef {import("../command-helpers.js").LintCommand} LintCommand */
/** @typedef {import("../command-helpers.js").CommandContext} CommandContext */
/** @typedef {import("../react-scan/find-react-scan-entry.js").ReactScanEntry} ReactScanEntry */

/** Entry of `@golfo/lint` that starts react-scan only in development. */
const REACT_SCAN_HELPER_MODULE = "@golfo/lint/react-scan";

/** Lines that connect react-scan, added at the start of the app's client entry. */
const REACT_SCAN_ENTRY_LINES = [
  "// react-scan resalta los componentes que se re-renderizan, solo en desarrollo (golfo-lint react-scan).",
  `import { startReactScan } from "${REACT_SCAN_HELPER_MODULE}";`,
  "",
  "startReactScan();",
];

/** File whose dependencies the package manager changes. */
const PACKAGE_MANIFEST_FILE = "package.json";

/**
 * Explains how to connect react-scan by hand, when the command cannot find where.
 * @param {string} missing - What the command did not find.
 * @returns {string} Message for `warn`.
 */
function formatManualSetup(missing) {
  return [
    `golfo-lint react-scan: no encontré ${missing}, así que no cambié nada.`,
    `Instalalo con --save-exact ${REACT_SCAN_PACKAGE}@${REACT_SCAN_VERSION} como devDependency y agregá al principio del`,
    "archivo que arranca la app en el navegador (instrumentation-client.ts en Next.js 15.3 o posterior, el entry",
    "que carga index.html en Vite, o el entry del bundler):",
    "",
    ...REACT_SCAN_ENTRY_LINES.map((line) => `  ${line}`),
  ].join("\n");
}

/**
 * Installs react-scan as an exact devDependency when the project does not declare it, and shows the change.
 * @param {CommandContext} context - Project and output.
 * @param {Record<string, unknown>} manifest - Parsed `package.json`.
 * @returns {Promise<number>} Exit code of the package manager, or success when there was nothing to install.
 */
async function installReactScanIfMissing(context, manifest) {
  if (declaresDependency(manifest, REACT_SCAN_PACKAGE)) {
    context.log(`golfo-lint react-scan: ${REACT_SCAN_PACKAGE} ya está en ${PACKAGE_MANIFEST_FILE}.`);
    return EXIT_CODE_SUCCESS;
  }
  const manifestPath = path.join(context.cwd, PACKAGE_MANIFEST_FILE);
  const manifestBefore = readFileSync(manifestPath, "utf8");
  const invocation = createReactScanInstallInvocation(context.cwd, manifest);
  const exitCode = await context.runTool(invocation);
  if (exitCode !== EXIT_CODE_SUCCESS) {
    const command = [invocation.command, ...invocation.arguments].join(" ");
    context.warn(`golfo-lint react-scan: "${command}" falló (exit ${String(exitCode)}); no conecté react-scan.`);
    return exitCode;
  }
  context.log(formatFileDiff(PACKAGE_MANIFEST_FILE, manifestBefore, readFileSync(manifestPath, "utf8")));
  return EXIT_CODE_SUCCESS;
}

/**
 * Adds the lines that start react-scan at the top of the entry file, unless it already loads react-scan.
 * @param {CommandContext} context - Project and output.
 * @param {ReactScanEntry} entry - File to connect.
 */
function connectEntry(context, entry) {
  const entryPath = path.join(context.cwd, entry.relativePath);
  const before = existsSync(entryPath) ? readFileSync(entryPath, "utf8") : undefined;
  if (before?.includes(REACT_SCAN_HELPER_MODULE)) {
    context.log(`golfo-lint react-scan: ${entry.relativePath} ya inicia react-scan; no cambié nada.`);
    return;
  }
  if (before?.includes(REACT_SCAN_PACKAGE)) {
    context.log(`golfo-lint react-scan: ${entry.relativePath} ya carga react-scan por su cuenta; no lo cambié.`);
    return;
  }
  const newline = before?.includes("\r\n") ? "\r\n" : "\n";
  const addedText = `${REACT_SCAN_ENTRY_LINES.join(newline)}${newline}`;
  const after = before === undefined ? addedText : `${addedText}${newline}${before}`;
  mkdirSync(path.dirname(entryPath), { recursive: true });
  writeFileSync(entryPath, after);
  context.log(
    [
      formatFileDiff(entry.relativePath, before, after),
      "",
      `golfo-lint react-scan: conecté react-scan en ${entry.relativePath} (${entry.framework}). Solo corre en desarrollo;`,
      `para sacarlo, borrá esas líneas${before === undefined ? " (o el archivo)" : ""} y desinstalá ${REACT_SCAN_PACKAGE}.`,
    ].join("\n"),
  );
}

/** @type {LintCommand} */
export const reactScanCommand = {
  description: "Conecta react-scan para ver re-renders en desarrollo (Next.js y Vite); no corre en all.",
  skipReason: (cwd) => (dependsOnReact(cwd) ? undefined : "el proyecto no depende de react"),
  async run(context) {
    const manifest = readProjectManifest(context.cwd) ?? {};
    const entry = findReactScanEntry(context.cwd, manifest);
    if ("failure" in entry) {
      context.warn(formatManualSetup(entry.failure));
      return EXIT_CODE_SETUP_NOT_DETECTED;
    }
    const installExitCode = await installReactScanIfMissing(context, manifest);
    if (installExitCode !== EXIT_CODE_SUCCESS) {
      return installExitCode;
    }
    connectEntry(context, entry);
    return EXIT_CODE_SUCCESS;
  },
};
