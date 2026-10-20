/**
 * @module cli/commands Subcommands of `golfo-lint`, one per analysis tool. Each one forwards its arguments to
 * the tool; without arguments it analyzes the current directory with the shared defaults.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { createJscpdArguments } from "../jscpd/create-jscpd-arguments.js";
import { createLizardArguments, LIZARD_VERSION } from "../lizard/create-lizard-arguments.js";
import { findLizardCommand } from "../lizard/find-lizard-command.js";
import { resolvePackageBin } from "../shared/resolve-package-bin.js";
import { DEFAULT_ANALYZED_PATH, EXIT_CODE_TOOL_UNAVAILABLE, JSCPD_PROJECT_CONFIG_FILE } from "./constants.js";

/** @typedef {import("./spawn-tool.js").ToolInvocation} ToolInvocation */

/**
 * @typedef {object} CommandContext
 * @property {string[]} toolArguments - Arguments given after the subcommand, forwarded to the tool.
 * @property {string} cwd - Folder to analyze.
 * @property {(invocation: ToolInvocation) => Promise<number>} runTool - Runs the tool and returns its exit code.
 * @property {(message: string) => void} warn - Receives failure messages.
 */

/**
 * @typedef {object} LintCommand
 * @property {string} description - One-line summary for the usage message.
 * @property {(context: CommandContext) => Promise<number>} run - Runs the check and returns its exit code.
 */

/**
 * Paths to analyze: the given arguments, or the current directory when there are none.
 * @param {string[]} toolArguments - Arguments given after the subcommand.
 * @returns {string[]} Arguments that end with at least one path.
 */
function withDefaultPath(toolArguments) {
  return toolArguments.length > 0 ? toolArguments : [DEFAULT_ANALYZED_PATH];
}

/** @type {LintCommand} */
const duplicatesCommand = {
  description: "Busca código duplicado con jscpd.",
  run({ toolArguments, cwd, runTool }) {
    // A project `.jscpd.json` owns the configuration; the shared defaults would override it.
    const hasProjectConfig = existsSync(path.join(cwd, JSCPD_PROJECT_CONFIG_FILE));
    const defaultArguments = hasProjectConfig ? [] : createJscpdArguments();
    return runTool({
      command: process.execPath,
      arguments: [resolvePackageBin("jscpd", "jscpd"), ...defaultArguments, ...withDefaultPath(toolArguments)],
      cwd,
    });
  },
};

/** @type {LintCommand} */
const unusedCommand = {
  description: "Busca archivos, exports y dependencias sin uso con knip.",
  run({ toolArguments, cwd, runTool }) {
    return runTool({
      command: process.execPath,
      arguments: [resolvePackageBin("knip", "knip"), ...toolArguments],
      cwd,
    });
  },
};

/** @type {LintCommand} */
const complexityCommand = {
  description: "Busca funciones demasiado complejas, largas o con muchos parámetros con lizard.",
  async run({ toolArguments, cwd, runTool, warn }) {
    const lizard = findLizardCommand();
    if (lizard === undefined) {
      warn(
        `golfo-lint complexity: lizard no está disponible. Instalá uv (https://docs.astral.sh/uv/) para que se ` +
          `ejecute con uvx, o instalalo con: pip install lizard==${LIZARD_VERSION}`,
      );
      return EXIT_CODE_TOOL_UNAVAILABLE;
    }
    return runTool({
      command: lizard.command,
      arguments: [...lizard.prefixArguments, ...createLizardArguments(), ...withDefaultPath(toolArguments)],
      cwd,
    });
  },
};

/** @type {Record<string, LintCommand>} */
const TOOL_COMMANDS = {
  duplicates: duplicatesCommand,
  unused: unusedCommand,
  complexity: complexityCommand,
};

/** @type {LintCommand} */
const allCommand = {
  description: "Ejecuta duplicates, unused y complexity, y falla si alguno falla.",
  async run(context) {
    /** @type {number[]} */
    const exitCodes = [];
    for (const command of Object.values(TOOL_COMMANDS)) {
      // Sequential on purpose: the tools write to the same terminal.
      exitCodes.push(await command.run({ ...context, toolArguments: [] }));
    }
    return Math.max(...exitCodes);
  },
};

/** @type {Record<string, LintCommand>} */
export const LINT_COMMANDS = { ...TOOL_COMMANDS, all: allCommand };
