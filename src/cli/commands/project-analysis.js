/**
 * @module cli/commands/project-analysis Subcommands that analyze the project around the code: the published
 * package (publint, attw), the GitHub Actions workflows (actionlint, zizmor), committed secrets (gitleaks) and
 * monorepo consistency (sherif).
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { selectAttwProfile } from "../../package/select-attw-profile.js";
import {
  createGitleaksArguments,
  GITLEAKS_CANDIDATES,
  GITLEAKS_PROJECT_CONFIG_FILE,
  GITLEAKS_VERSION,
} from "../../secrets/gitleaks-tool.js";
import {
  ACTIONLINT_CANDIDATES,
  createZizmorArguments,
  WORKFLOWS_DIRECTORY,
  ZIZMOR_CANDIDATES,
} from "../../workflows/workflow-tools.js";
import { findExternalCommand } from "../../shared/find-external-command.js";
import { rewriteBackgroundSteps, usesBackgroundSteps } from "../../workflows/background-steps.js";
import { hasAnyPath, readProjectManifest, runExternalTool, runPackageBin, runSequentially } from "../command-helpers.js";
import { EXIT_CODE_TOOL_UNAVAILABLE } from "../constants.js";

/** @typedef {import("../command-helpers.js").LintCommand} LintCommand */
/** @typedef {import("../../shared/find-external-command.js").ToolCommand} ToolCommand */

/** How to get uv, which runs the Python-packaged linters. */
const UV_INSTALL_HINT = "Instalá uv (https://docs.astral.sh/uv/) para ejecutarlo con uvx.";

/** File where pnpm declares workspaces, and also settings that have nothing to do with them. */
const PNPM_WORKSPACE_FILE = "pnpm-workspace.yaml";

/** Top-level `packages:` key of `pnpm-workspace.yaml`, the one that lists workspaces. */
const PNPM_WORKSPACE_PACKAGES_KEY = /^packages:/mu;

/**
 * sherif rule that only asks to sort dependencies alphabetically: ordering, not quality.
 */
const SHERIF_ORDERING_RULE = "unordered-dependencies";

/**
 * Why a project publishes no package, or `undefined` when it does.
 * @param {string} cwd - Project folder.
 * @returns {string | undefined} Reason to skip the package checks.
 */
function packageSkipReason(cwd) {
  const manifest = readProjectManifest(cwd);
  if (manifest === undefined) {
    return "no hay package.json";
  }
  return manifest.private === true ? "el paquete es privado y no se publica" : undefined;
}

/**
 * Why a project is not a monorepo, or `undefined` when it is.
 * @param {string} cwd - Project folder.
 * @returns {string | undefined} Reason to skip the monorepo checks.
 */
function monorepoSkipReason(cwd) {
  const pnpmWorkspacePath = path.join(cwd, PNPM_WORKSPACE_FILE);
  const declaresPnpmWorkspaces =
    existsSync(pnpmWorkspacePath) && PNPM_WORKSPACE_PACKAGES_KEY.test(readFileSync(pnpmWorkspacePath, "utf8"));
  const declaresWorkspaces = readProjectManifest(cwd)?.workspaces !== undefined || declaresPnpmWorkspaces;
  return declaresWorkspaces ? undefined : "no declara workspaces";
}

/** @type {LintCommand} */
export const packageCommand = {
  description: "Paquete publicado: exports, archivos y tipos (publint y Are the Types Wrong).",
  skipReason: packageSkipReason,
  run(context) {
    const manifest = readProjectManifest(context.cwd) ?? {};
    return runSequentially([
      () => runPackageBin(context, { packageName: "publint", binName: "publint", arguments: ["run", "--strict"] }),
      () =>
        runPackageBin(context, {
          packageName: "@arethetypeswrong/cli",
          binName: "attw",
          arguments: ["--pack", ".", "--profile", selectAttwProfile(manifest), "--no-emoji"],
        }),
    ]);
  },
};

/** Exit code of actionlint when it finds problems. */
const ACTIONLINT_PROBLEMS_EXIT_CODE = 1;

/** actionlint output format: one JSON array with every error. */
const ACTIONLINT_JSON_FORMAT = "{{json .}}";

/**
 * @typedef {object} ActionlintError
 * @property {string} message - What is wrong.
 * @property {string} filepath - Workflow file.
 * @property {number} line - 1-based line.
 * @property {number} column - 1-based column.
 * @property {string} kind - Check that found it.
 */

/**
 * Lists the workflow files of a project.
 * @param {string} cwd - Project folder.
 * @returns {string[]} Paths relative to the project, with `/`.
 */
function listWorkflowFiles(cwd) {
  return readdirSync(path.join(cwd, WORKFLOWS_DIRECTORY))
    .filter((fileName) => /\.ya?ml$/u.test(fileName))
    .map((fileName) => `${WORKFLOWS_DIRECTORY}/${fileName}`);
}

/**
 * Runs actionlint on one workflow rewritten without background steps, and maps its errors back to the original.
 * @param {ToolCommand} launcher - How to run actionlint.
 * @param {string} cwd - Project folder, where actionlint finds local actions and its config.
 * @param {string} workflowPath - Workflow file, relative to the project.
 * @returns {{ errors: ActionlintError[]; failure?: string }} Errors in the original workflow, or why actionlint failed.
 */
function lintRewrittenWorkflow(launcher, cwd, workflowPath) {
  const { text, columnShifts } = rewriteBackgroundSteps(readFileSync(path.join(cwd, workflowPath), "utf8"));
  const result = spawnSync(
    launcher.command,
    [...launcher.prefixArguments, "-format", ACTIONLINT_JSON_FORMAT, "-stdin-filename", workflowPath, "-"],
    { cwd, input: text, encoding: "utf8" },
  );
  if (result.status !== 0 && result.status !== ACTIONLINT_PROBLEMS_EXIT_CODE) {
    return { errors: [], failure: result.stderr || String(result.error ?? result.status) };
  }
  const errors = /** @type {ActionlintError[] | null} */ (JSON.parse(result.stdout.trim() || "[]")) ?? [];
  return {
    errors: errors.map((error) => ({ ...error, column: error.column + (columnShifts.get(error.line) ?? 0) })),
  };
}

/**
 * Runs actionlint. Workflows with background steps go through {@link rewriteBackgroundSteps}, because actionlint
 * reports `background`, `wait` and `parallel` as syntax errors; the rest run as they are.
 * @param {import("../command-helpers.js").CommandContext} context - Where and how to run it.
 * @returns {Promise<number>} Exit code.
 */
async function runActionlint(context) {
  const launcher = findExternalCommand(ACTIONLINT_CANDIDATES);
  if (launcher === undefined) {
    context.warn(`golfo-lint: actionlint no está disponible. ${UV_INSTALL_HINT}`);
    return EXIT_CODE_TOOL_UNAVAILABLE;
  }
  const workflowFiles = listWorkflowFiles(context.cwd);
  const rewrittenFiles = workflowFiles.filter((workflowPath) =>
    usesBackgroundSteps(readFileSync(path.join(context.cwd, workflowPath), "utf8")),
  );
  if (context.toolArguments.length > 0 || rewrittenFiles.length === 0) {
    return runExternalTool(context, {
      name: "actionlint",
      candidates: ACTIONLINT_CANDIDATES,
      installHint: UV_INSTALL_HINT,
      arguments: context.toolArguments,
    });
  }
  const plainFiles = workflowFiles.filter((workflowPath) => !rewrittenFiles.includes(workflowPath));
  const plainExitCode =
    plainFiles.length === 0
      ? 0
      : await context.runTool({
          command: launcher.command,
          arguments: [...launcher.prefixArguments, ...plainFiles],
          cwd: context.cwd,
        });
  const results = rewrittenFiles.map((workflowPath) => lintRewrittenWorkflow(launcher, context.cwd, workflowPath));
  const failures = results.flatMap((result) => (result.failure === undefined ? [] : [result.failure]));
  if (failures.length > 0) {
    context.warn(`golfo-lint: actionlint no pudo analizar los workflows: ${failures.join("\n")}`);
    return EXIT_CODE_TOOL_UNAVAILABLE;
  }
  const errors = results.flatMap((result) => result.errors);
  for (const error of errors) {
    context.warn(`${error.filepath}:${String(error.line)}:${String(error.column)}: ${error.message} [${error.kind}]`);
  }
  return Math.max(plainExitCode, errors.length > 0 ? ACTIONLINT_PROBLEMS_EXIT_CODE : 0);
}

/** @type {LintCommand} */
export const workflowsCommand = {
  description: "Workflows de GitHub Actions: errores (actionlint) y riesgos de seguridad (zizmor).",
  skipReason: (cwd) => (hasAnyPath(cwd, [WORKFLOWS_DIRECTORY]) ? undefined : `no hay ${WORKFLOWS_DIRECTORY}`),
  run(context) {
    return runSequentially([
      () => runActionlint(context),
      () =>
        runExternalTool(context, {
          name: "zizmor",
          candidates: ZIZMOR_CANDIDATES,
          installHint: UV_INSTALL_HINT,
          arguments: [...createZizmorArguments(), WORKFLOWS_DIRECTORY],
        }),
    ]);
  },
};

/** @type {LintCommand} */
export const secretsCommand = {
  description: "Secretos commiteados o en archivos (gitleaks).",
  run(context) {
    return runExternalTool(context, {
      name: "gitleaks",
      candidates: GITLEAKS_CANDIDATES,
      installHint:
        `Instalá gitleaks ${GITLEAKS_VERSION} desde https://github.com/gitleaks/gitleaks/releases ` +
        "(o con winget install Gitleaks.Gitleaks / brew install gitleaks).",
      arguments: createGitleaksArguments({
        isGitRepository: hasAnyPath(context.cwd, [".git"]),
        hasProjectConfig: hasAnyPath(context.cwd, [GITLEAKS_PROJECT_CONFIG_FILE]),
        path: ".",
      }),
    });
  },
};

/** @type {LintCommand} */
export const monorepoCommand = {
  description: "Monorepo: versiones de dependencias y package.json consistentes (sherif).",
  skipReason: monorepoSkipReason,
  run(context) {
    return runPackageBin(context, {
      packageName: "sherif",
      binName: "sherif",
      arguments: ["--ignore-rule", SHERIF_ORDERING_RULE, ...context.toolArguments],
    });
  },
};
