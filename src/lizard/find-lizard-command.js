/**
 * @module lizard/find-lizard-command Finds how to run lizard, a Python tool that npm cannot install: an
 * installed `lizard`, `uvx` (which downloads a pinned version once) or a Python interpreter that has it.
 */
import { findExternalCommand } from "../shared/find-external-command.js";
import { LIZARD_VERSION } from "./create-lizard-arguments.js";

/** @typedef {import("../shared/find-external-command.js").ToolCommand} ToolCommand */

/** Ways to run lizard, in order of preference. */
export const LIZARD_CANDIDATES = /** @type {ToolCommand[]} */ ([
  { command: "lizard", prefixArguments: [] },
  { command: "uvx", prefixArguments: [`lizard@${LIZARD_VERSION}`] },
  { command: "python3", prefixArguments: ["-m", "lizard"] },
  { command: "python", prefixArguments: ["-m", "lizard"] },
  { command: "py", prefixArguments: ["-m", "lizard"] },
]);

/**
 * Returns the first way to run lizard that works on this machine.
 * @param {(candidate: ToolCommand) => boolean} [canRun] - Checks a candidate; replaceable for tests.
 * @returns {ToolCommand | undefined} Command to run, or `undefined` when lizard is not available.
 */
export function findLizardCommand(canRun) {
  return findExternalCommand(LIZARD_CANDIDATES, canRun);
}
