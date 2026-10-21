/**
 * @module cli/commands Subcommands of `golfo-lint`, one per analysis, plus `all`. Each one forwards its arguments
 * to its tool; without arguments it analyzes the current directory with the shared defaults.
 */
import { runSequentially } from "../command-helpers.js";
import {
  architectureCommand,
  complexityCommand,
  duplicatesCommand,
  reactCommand,
  stylesCommand,
  unusedCommand,
} from "./code-analysis.js";
import { monorepoCommand, packageCommand, secretsCommand, workflowsCommand } from "./project-analysis.js";

/** @typedef {import("../command-helpers.js").LintCommand} LintCommand */
/** @typedef {import("../command-helpers.js").CommandContext} CommandContext */

/** @type {Record<string, LintCommand>} */
const ANALYSIS_COMMANDS = {
  duplicates: duplicatesCommand,
  unused: unusedCommand,
  complexity: complexityCommand,
  styles: stylesCommand,
  react: reactCommand,
  architecture: architectureCommand,
  package: packageCommand,
  workflows: workflowsCommand,
  secrets: secretsCommand,
  monorepo: monorepoCommand,
};

/**
 * Runs a subcommand unless it does not apply to the project, in which case it says why and passes.
 * @param {string} commandName - Subcommand name, for the message.
 * @param {LintCommand} command - Subcommand to run.
 * @param {CommandContext} context - Where and how to run it.
 * @returns {Promise<number>} Exit code.
 */
export async function runApplicableCommand(commandName, command, context) {
  const skipReason = command.skipReason?.(context.cwd);
  if (skipReason !== undefined) {
    context.log(`golfo-lint ${commandName}: no aplica (${skipReason}).`);
    return 0;
  }
  return command.run(context);
}

/** @type {LintCommand} */
const allCommand = {
  description: "Todos los análisis que apliquen al proyecto; falla si alguno falla.",
  run(context) {
    return runSequentially(
      Object.entries(ANALYSIS_COMMANDS).map(
        ([commandName, command]) =>
          () =>
            runApplicableCommand(commandName, command, { ...context, toolArguments: [] }),
      ),
    );
  },
};

/** @type {Record<string, LintCommand>} */
export const LINT_COMMANDS = { ...ANALYSIS_COMMANDS, all: allCommand };
