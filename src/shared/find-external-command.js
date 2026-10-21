/**
 * @module shared/find-external-command Finds how to run a tool that npm cannot install (Python and Go
 * binaries): the installed executable first, then a pinned version through `uvx`, then other launchers.
 */
import { spawnSync } from "node:child_process";

/** Flag every candidate answers when it can run the tool. */
const VERSION_FLAG = "--version";

/**
 * @typedef {object} ToolCommand
 * @property {string} command - Executable to spawn.
 * @property {string[]} prefixArguments - Arguments that go before the tool's own.
 */

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
 * Returns the first way to run a tool that works on this machine.
 * @param {ToolCommand[]} candidates - Ways to run the tool, in order of preference.
 * @param {(candidate: ToolCommand) => boolean} [canRun] - Checks a candidate; replaceable for tests.
 * @returns {ToolCommand | undefined} Command to run, or `undefined` when the tool is not available.
 */
export function findExternalCommand(candidates, canRun = candidateRuns) {
  return candidates.find((candidate) => canRun(candidate));
}
