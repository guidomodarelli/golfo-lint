/** @module cli/run-cli Parses the `golfo-lint` arguments and runs one analysis subcommand. */
import process from "node:process";
import { LINT_COMMANDS, runApplicableCommand } from "./commands/index.js";
import { CLI_NAME, EXIT_CODE_SUCCESS, EXIT_CODE_USAGE_ERROR, HELP_FLAGS } from "./constants.js";
import { spawnTool } from "./spawn-tool.js";

/** @typedef {import("./command-helpers.js").LintCommand} LintCommand */
/** @typedef {import("./spawn-tool.js").ToolInvocation} ToolInvocation */

/**
 * @typedef {object} CliOptions
 * @property {string} [cwd] - Folder to analyze; defaults to the current one.
 * @property {Record<string, LintCommand>} [commands] - Available subcommands, replaceable for tests.
 * @property {(invocation: ToolInvocation) => Promise<number>} [runTool] - Runs a tool; replaceable for tests.
 * @property {(message: string) => void} [log] - Receives the usage message and informational messages.
 * @property {(message: string) => void} [warn] - Receives failure and usage messages.
 */

/** Width of the first column of the usage message. */
const USAGE_COLUMN_WIDTH = 14;

/**
 * Builds the usage message from the available subcommands.
 * @param {Record<string, LintCommand>} commands - Available subcommands.
 * @returns {string} Usage message.
 */
export function formatUsage(commands) {
  const commandLines = Object.entries(commands).map(
    ([commandName, command]) => `  ${commandName.padEnd(USAGE_COLUMN_WIDTH)}${command.description}`,
  );
  return [
    `Uso: ${CLI_NAME} <análisis> [argumentos de la herramienta...]`,
    "",
    "Análisis:",
    ...commandLines,
    "",
    "Sin argumentos analiza la carpeta actual con los valores compartidos; los argumentos se pasan tal cual",
    "a la herramienta.",
  ].join("\n");
}

/**
 * Runs `golfo-lint` with the given arguments.
 * @param {string[]} cliArguments - Arguments after the binary name.
 * @param {CliOptions} [options] - Dependencies, replaceable for tests.
 * @returns {Promise<number>} Exit code for the process.
 */
export async function runCli(cliArguments, options = {}) {
  /** @type {Required<CliOptions>} */
  const defaults = { cwd: process.cwd(), commands: LINT_COMMANDS, runTool: spawnTool, log: console.log, warn: console.error };
  const { cwd, commands, runTool, log, warn } = { ...defaults, ...options };
  const [commandName, ...toolArguments] = cliArguments;

  if (commandName === undefined || HELP_FLAGS.includes(commandName)) {
    log(formatUsage(commands));
    return commandName === undefined ? EXIT_CODE_USAGE_ERROR : EXIT_CODE_SUCCESS;
  }

  const command = Object.hasOwn(commands, commandName) ? commands[commandName] : undefined;
  if (command === undefined) {
    warn(`${CLI_NAME}: análisis desconocido "${commandName}".\n\n${formatUsage(commands)}`);
    return EXIT_CODE_USAGE_ERROR;
  }

  return runApplicableCommand(commandName, command, { toolArguments, cwd, runTool, log, warn });
}
