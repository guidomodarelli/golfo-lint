/**
 * @module cli/commands/project-analysis Subcommands that analyze the project around the code: the published
 * package (publint, attw), the GitHub Actions workflows (actionlint, zizmor), committed secrets (gitleaks) and
 * monorepo consistency (sherif).
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { selectAttwProfile } from "../../package/select-attw-profile.js";
import { createGitleaksArguments, GITLEAKS_CANDIDATES, GITLEAKS_VERSION } from "../../secrets/gitleaks-tool.js";
import {
  ACTIONLINT_CANDIDATES,
  createZizmorArguments,
  WORKFLOWS_DIRECTORY,
  ZIZMOR_CANDIDATES,
} from "../../workflows/workflow-tools.js";
import { hasAnyPath, readProjectManifest, runExternalTool, runPackageBin, runSequentially } from "../command-helpers.js";

/** @typedef {import("../command-helpers.js").LintCommand} LintCommand */

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

/** @type {LintCommand} */
export const workflowsCommand = {
  description: "Workflows de GitHub Actions: errores (actionlint) y riesgos de seguridad (zizmor).",
  skipReason: (cwd) => (hasAnyPath(cwd, [WORKFLOWS_DIRECTORY]) ? undefined : `no hay ${WORKFLOWS_DIRECTORY}`),
  run(context) {
    return runSequentially([
      () =>
        runExternalTool(context, {
          name: "actionlint",
          candidates: ACTIONLINT_CANDIDATES,
          installHint: UV_INSTALL_HINT,
          arguments: context.toolArguments,
        }),
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
      arguments: createGitleaksArguments({ isGitRepository: hasAnyPath(context.cwd, [".git"]), path: "." }),
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
