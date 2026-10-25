/**
 * @module cli/commands/code-analysis Subcommands that analyze source code: duplication (jscpd), unused code
 * (knip), complexity (lizard), styles (Stylelint), architecture (dependency-cruiser) and React (react-doctor).
 */
import { fileURLToPath } from "node:url";
import { createJscpdArguments } from "../../jscpd/create-jscpd-arguments.js";
import { createLizardArguments, LIZARD_VERSION } from "../../lizard/create-lizard-arguments.js";
import { LIZARD_CANDIDATES } from "../../lizard/find-lizard-command.js";
import {
  dependsOnReact,
  hasAnyPath,
  readProjectManifest,
  runExternalTool,
  runPackageBin,
  withDefaultPath,
} from "../command-helpers.js";
import { JSCPD_PROJECT_CONFIG_FILE } from "../constants.js";

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
    return runPackageBin(context, { packageName: "knip", binName: "knip", arguments: context.toolArguments });
  },
};

/** @type {LintCommand} */
export const complexityCommand = {
  description: "Funciones demasiado complejas, largas o con muchos parámetros (lizard).",
  run(context) {
    return runExternalTool(context, {
      name: "lizard",
      candidates: LIZARD_CANDIDATES,
      installHint: `Instalá uv (https://docs.astral.sh/uv/) para ejecutarlo con uvx, o: pip install lizard==${LIZARD_VERSION}`,
      arguments: [...createLizardArguments(), ...withDefaultPath(context.toolArguments)],
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
  "--verbose",
  "--blocking",
  "warning",
  "--no-respect-inline-disables",
  "--no-telemetry",
  "--no-supply-chain",
];

/** @type {LintCommand} */
export const reactCommand = {
  description: "React: estado y efectos, rendimiento, seguridad y accesibilidad (react-doctor).",
  skipReason: (cwd) => (dependsOnReact(cwd) ? undefined : "el proyecto no depende de react"),
  run(context) {
    return runPackageBin(context, {
      packageName: "react-doctor",
      binName: "react-doctor",
      arguments: [...REACT_DOCTOR_ARGUMENTS, ...context.toolArguments],
      installedByProject: true,
      installHint: `Es opcional: instalalo en el proyecto con pnpm add -D --save-exact react-doctor@${REACT_DOCTOR_VERSION}`,
    });
  },
};
