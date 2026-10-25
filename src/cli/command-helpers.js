/** @module cli/command-helpers Pieces the `golfo-lint` subcommands share to find and run their tools. */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { findExternalCommand } from "../shared/find-external-command.js";
import { resolvePackageBin } from "../shared/resolve-package-bin.js";
import { DEFAULT_ANALYZED_PATH, EXIT_CODE_TOOL_UNAVAILABLE } from "./constants.js";

/** @typedef {import("./spawn-tool.js").ToolInvocation} ToolInvocation */
/** @typedef {import("../shared/find-external-command.js").ToolCommand} ToolCommand */

/**
 * @typedef {object} CommandContext
 * @property {string[]} toolArguments - Arguments given after the subcommand, forwarded to the tool.
 * @property {string} cwd - Folder to analyze.
 * @property {(invocation: ToolInvocation) => Promise<number>} runTool - Runs the tool and returns its exit code.
 * @property {(message: string) => void} log - Receives informational messages.
 * @property {(message: string) => void} warn - Receives failure messages.
 */

/**
 * @typedef {object} LintCommand
 * @property {string} description - One-line summary for the usage message.
 * @property {(cwd: string) => string | undefined} [skipReason] - Why the check does not apply to a project, or
 * `undefined` when it does.
 * @property {(context: CommandContext) => Promise<number>} run - Runs the check and returns its exit code.
 */

/** File that describes a Node.js package. */
const PACKAGE_MANIFEST_FILE = "package.json";

/**
 * Paths to analyze: the given arguments, or the current directory when there are none.
 * @param {string[]} toolArguments - Arguments given after the subcommand.
 * @returns {string[]} Arguments that end with at least one path.
 */
export function withDefaultPath(toolArguments) {
  return toolArguments.length > 0 ? toolArguments : [DEFAULT_ANALYZED_PATH];
}

/**
 * Checks whether a project has any of some files or folders.
 * @param {string} cwd - Project folder.
 * @param {string[]} relativePaths - Paths relative to the project.
 * @returns {boolean} Whether at least one exists.
 */
export function hasAnyPath(cwd, relativePaths) {
  return relativePaths.some((relativePath) => existsSync(path.join(cwd, relativePath)));
}

/**
 * Reads the project's `package.json`.
 * @param {string} cwd - Project folder.
 * @returns {Record<string, unknown> | undefined} Parsed manifest, or `undefined` when there is none.
 */
export function readProjectManifest(cwd) {
  const manifestPath = path.join(cwd, PACKAGE_MANIFEST_FILE);
  if (!existsSync(manifestPath)) {
    return undefined;
  }
  return /** @type {Record<string, unknown>} */ (JSON.parse(readFileSync(manifestPath, "utf8")));
}

/** Dependency fields where a project declares the packages it uses. */
const DEPENDENCY_FIELDS = ["dependencies", "devDependencies", "peerDependencies"];

/**
 * Checks whether a manifest declares a package in any dependency field.
 * @param {Record<string, unknown> | undefined} manifest - Parsed `package.json`.
 * @param {string} packageName - Package to look for.
 * @returns {boolean} Whether it is declared.
 */
export function declaresDependency(manifest, packageName) {
  return DEPENDENCY_FIELDS.some((field) => {
    const dependencies = manifest?.[field];
    return typeof dependencies === "object" && dependencies !== null && packageName in dependencies;
  });
}

/**
 * Checks whether a project depends on React.
 * @param {string} cwd - Project folder.
 * @returns {boolean} Whether `package.json` declares `react` in any dependency field.
 */
export function dependsOnReact(cwd) {
  return declaresDependency(readProjectManifest(cwd), "react");
}

/**
 * Runs an executable that a dependency of `@golfo/lint` ships, with the same Node.js that runs `golfo-lint`.
 * @param {CommandContext} context - Where and how to run it.
 * @param {{ packageName: string; binName: string; arguments: string[]; installedByProject?: boolean; installHint?: string }} tool
 *   What to run. `installedByProject` searches the project first, for optional tools the project installs; `installHint`
 *   says how to install the package when it is missing.
 * @returns {Promise<number>} Exit code of the tool.
 */
export async function runPackageBin(context, tool) {
  const binPath = resolvePackageBin(tool.packageName, tool.binName, {
    projectDirectory: tool.installedByProject === true ? context.cwd : undefined,
  });
  if (binPath === undefined) {
    context.warn(`golfo-lint: ${tool.packageName} no está instalado. ${tool.installHint ?? "Reinstalá @golfo/lint."}`);
    return EXIT_CODE_TOOL_UNAVAILABLE;
  }
  return context.runTool({ command: process.execPath, arguments: [binPath, ...tool.arguments], cwd: context.cwd });
}

/**
 * Runs a tool that npm cannot install, through the first launcher that works.
 * @param {CommandContext} context - Where and how to run it.
 * @param {{ name: string; candidates: ToolCommand[]; installHint: string; arguments: string[] }} tool - What to
 * run, and how to install it when no launcher works.
 * @returns {Promise<number>} Exit code of the tool, or `EXIT_CODE_TOOL_UNAVAILABLE` when it is not available.
 */
export async function runExternalTool(context, tool) {
  const launcher = findExternalCommand(tool.candidates);
  if (launcher === undefined) {
    context.warn(`golfo-lint: ${tool.name} no está disponible. ${tool.installHint}`);
    return EXIT_CODE_TOOL_UNAVAILABLE;
  }
  return context.runTool({
    command: launcher.command,
    arguments: [...launcher.prefixArguments, ...tool.arguments],
    cwd: context.cwd,
  });
}

/**
 * Runs several tools one after the other and keeps the worst exit code.
 * @param {(() => Promise<number>)[]} steps - Tools to run, in order.
 * @returns {Promise<number>} Highest exit code, or 0 when there are no steps.
 */
export async function runSequentially(steps) {
  let worstExitCode = 0;
  for (const step of steps) {
    // Sequential on purpose: the tools write to the same terminal.
    worstExitCode = Math.max(worstExitCode, await step());
  }
  return worstExitCode;
}
