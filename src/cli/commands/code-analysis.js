/**
 * @module cli/commands/code-analysis Subcommands that analyze source code: duplication (jscpd), unused code
 * (knip), styles (Stylelint), architecture (dependency-cruiser) and React (react-doctor).
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createJscpdArguments } from "../../jscpd/create-jscpd-arguments.js";
import {
  dependsOnReact,
  hasAnyPath,
  readProjectManifest,
  runPackageBin,
  withDefaultPath,
} from "../command-helpers.js";
import { formatDiagnostics, isReportedDiagnostic } from "../../react-doctor/react-doctor-report.js";
import {
  EXIT_CODE_PROBLEMS_FOUND,
  EXIT_CODE_SUCCESS,
  EXIT_CODE_TOOL_UNAVAILABLE,
  JSCPD_PROJECT_CONFIG_FILE,
} from "../constants.js";

/** @typedef {import("../command-helpers.js").LintCommand} LintCommand */

/** Files where a project keeps its own Stylelint config, which then replaces the shared one. */
const STYLELINT_PROJECT_CONFIG_FILES = [
  ".stylelintrc",
  ".stylelintrc.json",
  ".stylelintrc.yaml",
  ".stylelintrc.yml",
  ".stylelintrc.js",
  ".stylelintrc.cjs",
  ".stylelintrc.mjs",
  "stylelint.config.js",
  "stylelint.config.cjs",
  "stylelint.config.mjs",
  "stylelint.config.ts",
];

/** Files where a project keeps its own knip config, which then replaces the shared one. */
const KNIP_PROJECT_CONFIG_FILES = [
  "knip.json",
  "knip.jsonc",
  ".knip.json",
  ".knip.jsonc",
  "knip.js",
  "knip.ts",
  "knip.config.js",
  "knip.config.ts",
  "knip.config.mjs",
  "knip.config.mts",
  "knip.config.cjs",
];

/** Style files analyzed when `styles` gets no arguments. */
const DEFAULT_STYLE_GLOB = "**/*.{css,scss}";

/** Files where a project keeps its own dependency-cruiser config, which then replaces the shared one. */
const DEPENDENCY_CRUISER_PROJECT_CONFIG_FILES = [
  ".dependency-cruiser.js",
  ".dependency-cruiser.cjs",
  ".dependency-cruiser.mjs",
  ".dependency-cruiser.json",
];

/** Folders that hold code in the golfo projects, cruised when `architecture` gets no arguments. */
const SOURCE_FOLDERS = ["src", "app", "components", "lib", "hooks", "bin"];

/**
 * Resolves a shared config file that ships with this package.
 * @param {string} relativePath - Path relative to `src`.
 * @returns {string} Absolute path.
 */
function sharedConfigPath(relativePath) {
  return fileURLToPath(new URL(`../../${relativePath}`, import.meta.url));
}

/** @type {LintCommand} */
export const duplicatesCommand = {
  description: "Código duplicado (jscpd).",
  run(context) {
    // A project `.jscpd.json` owns the configuration; the shared defaults would override it.
    const defaultArguments = hasAnyPath(context.cwd, [JSCPD_PROJECT_CONFIG_FILE]) ? [] : createJscpdArguments();
    return runPackageBin(context, {
      packageName: "jscpd",
      binName: "jscpd",
      arguments: [...defaultArguments, ...withDefaultPath(context.toolArguments)],
    });
  },
};

/** @type {LintCommand} */
export const unusedCommand = {
  description: "Archivos, exports y dependencias sin uso (knip).",
  skipReason: (cwd) => (readProjectManifest(cwd) === undefined ? "no hay package.json" : undefined),
  run(context) {
    // A project config owns the configuration; without one, knip gets the shared defaults instead of its own.
    const hasProjectConfig =
      hasAnyPath(context.cwd, KNIP_PROJECT_CONFIG_FILES) || readProjectManifest(context.cwd)?.knip !== undefined;
    const configArguments = hasProjectConfig ? [] : ["--config", sharedConfigPath("knip/default.config.js")];
    return runPackageBin(context, {
      packageName: "knip",
      binName: "knip",
      arguments: [...configArguments, ...context.toolArguments],
    });
  },
};

/** @type {LintCommand} */
export const stylesCommand = {
  description: "CSS y SCSS inválido o frágil (Stylelint, sin reglas de formato).",
  run(context) {
    const configArguments = hasAnyPath(context.cwd, STYLELINT_PROJECT_CONFIG_FILES)
      ? []
      : ["--config", sharedConfigPath("stylelint/default.config.js")];
    const inputs = context.toolArguments.length > 0 ? context.toolArguments : [DEFAULT_STYLE_GLOB];
    return runPackageBin(context, {
      packageName: "stylelint",
      binName: "stylelint",
      arguments: [...inputs, ...configArguments, "--allow-empty-input"],
    });
  },
};

/** @type {LintCommand} */
export const architectureCommand = {
  description: "Ciclos, paquetes no declarados y límites entre capas (dependency-cruiser).",
  skipReason: (cwd) => (hasAnyPath(cwd, SOURCE_FOLDERS) ? undefined : `no hay ${SOURCE_FOLDERS.join(", ")}`),
  run(context) {
    const projectConfig = DEPENDENCY_CRUISER_PROJECT_CONFIG_FILES.find((fileName) => hasAnyPath(context.cwd, [fileName]));
    const sources =
      context.toolArguments.length > 0
        ? context.toolArguments
        : SOURCE_FOLDERS.filter((folder) => hasAnyPath(context.cwd, [folder]));
    return runPackageBin(context, {
      packageName: "dependency-cruiser",
      binName: "depcruise",
      arguments: ["--config", projectConfig ?? sharedConfigPath("dependency-cruiser/default.config.js"), ...sources],
      // dependency-cruiser would use the project's TypeScript, and skip every `.ts` file when it is 7 or newer.
      nodeArguments: ["--import", pathToFileURL(sharedConfigPath("dependency-cruiser/typescript-resolution-hook.js")).href],
    });
  },
};

/**
 * react-doctor version golfo-lint is tested with. It is an optional peer dependency (it brings Playwright, Sentry and
 * its own TypeScript), so only React projects install it.
 */
export const REACT_DOCTOR_VERSION = "0.9.18";

/**
 * react-doctor flags for agents: warnings fail, inline suppressions are neutralized, and nothing leaves the
 * machine (no telemetry, no score API, no dependency list sent to Socket.dev).
 */
const REACT_DOCTOR_ARGUMENTS = [
  "--yes",
  "--blocking",
  "warning",
  "--no-respect-inline-disables",
  "--no-telemetry",
  "--no-supply-chain",
];

/**
 * Reads the JSON report react-doctor wrote.
 * @param {string} reportPath - Path of the report.
 * @returns {import("../../react-doctor/react-doctor-report.js").ReactDoctorReport | undefined} Parsed report, or
 * `undefined` when react-doctor did not write one.
 */
function readReactDoctorReport(reportPath) {
  if (!existsSync(reportPath)) {
    return undefined;
  }
  return /** @type {import("../../react-doctor/react-doctor-report.js").ReactDoctorReport} */ (
    JSON.parse(readFileSync(reportPath, "utf8"))
  );
}

/** @type {LintCommand} */
export const reactCommand = {
  description: "React: estado y efectos, rendimiento, seguridad y accesibilidad (react-doctor).",
  skipReason: (cwd) => (dependsOnReact(cwd) ? undefined : "el proyecto no depende de react"),
  async run(context) {
    // react-doctor writes a JSON report that golfo-lint filters: its own output repeats ESLint findings.
    const reportDirectory = mkdtempSync(path.join(os.tmpdir(), "golfo-lint-react-doctor-"));
    const reportPath = path.join(reportDirectory, "report.json");
    try {
      const exitCode = await runPackageBin(context, {
        packageName: "react-doctor",
        binName: "react-doctor",
        arguments: [...REACT_DOCTOR_ARGUMENTS, "--json", "--json-out", reportPath, ...context.toolArguments],
        installedByProject: true,
        installHint: `Es opcional: instalalo en el proyecto con pnpm add -D --save-exact react-doctor@${REACT_DOCTOR_VERSION}`,
      });
      if (exitCode === EXIT_CODE_TOOL_UNAVAILABLE) {
        return exitCode;
      }
      const report = readReactDoctorReport(reportPath);
      if (report?.diagnostics === undefined || (report.error !== undefined && report.error !== null)) {
        context.warn(`golfo-lint: react-doctor no pudo analizar el proyecto: ${JSON.stringify(report?.error ?? "no escribió el reporte")}`);
        return EXIT_CODE_TOOL_UNAVAILABLE;
      }
      const diagnostics = report.diagnostics.filter((diagnostic) => isReportedDiagnostic(diagnostic));
      if (diagnostics.length === 0) {
        context.log("react-doctor: sin problemas.");
        return EXIT_CODE_SUCCESS;
      }
      context.warn(formatDiagnostics(diagnostics));
      return EXIT_CODE_PROBLEMS_FOUND;
    } finally {
      rmSync(reportDirectory, { recursive: true, force: true });
    }
  },
};
