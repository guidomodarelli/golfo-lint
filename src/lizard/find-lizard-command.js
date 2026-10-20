/**
 * @module lizard/find-lizard-command Finds how to run lizard, a Python tool that npm cannot install: an
 * installed `lizard`, `uvx` (which downloads a pinned version once) or a Python interpreter that has it.
 */
import { spawnSync } from "node:child_process";
import { LIZARD_VERSION } from "./create-lizard-arguments.js";

/** Flag every candidate answers when it can run lizard. */
const VERSION_FLAG = "--version";

/**
 * @typedef {object} ToolCommand
 * @property {string} command - Executable to spawn.
 * @property {string[]} prefixArguments - Arguments that go before lizard's own.
 */

/** Ways to run lizard, in order of preference. */
export const LIZARD_CANDIDATES = /** @type {ToolCommand[]} */ ([
  { command: "lizard", prefixArguments: [] },
  { command: "uvx", prefixArguments: [`lizard@${LIZARD_VERSION}`] },
  { command: "python3", prefixArguments: ["-m", "lizard"] },
  { command: "python", prefixArguments: ["-m", "lizard"] },
  { command: "py", prefixArguments: ["-m", "lizard"] },
]);

/**
 * Checks whether a command runs, by asking for its version.
 * @param {ToolCommand} candidate - Command to try.
 * @returns {boolean} Whether it exited successfully.
 */
function candidateRuns(candidate) {
  const result = spawnSync(candidate.command, [...candidate.prefixArguments, VERSION_FLAG], { stdio: "ignore" });
  return result.error === undefined && result.status === 0;
}

/**
 * Returns the first way to run lizard that works on this machine.
 * @param {(candidate: ToolCommand) => boolean} [canRun] - Checks a candidate; replaceable for tests.
 * @returns {ToolCommand | undefined} Command to run, or `undefined` when lizard is not available.
 */
export function findLizardCommand(canRun = candidateRuns) {
  return LIZARD_CANDIDATES.find((candidate) => canRun(candidate));
}
