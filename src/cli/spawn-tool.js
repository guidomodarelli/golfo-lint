/** @module cli/spawn-tool Runs an analysis tool with the terminal attached and reports its exit code. */
import { spawn } from "node:child_process";
import { EXIT_CODE_TOOL_UNAVAILABLE } from "./constants.js";

/**
 * @typedef {object} ToolInvocation
 * @property {string} command - Executable to spawn.
 * @property {string[]} arguments - Arguments for the executable.
 * @property {string} cwd - Folder to run it in.
 * @property {"inherit" | "ignore"} [stdio] - Whether the tool writes to the terminal (default `inherit`).
 */

/**
 * Spawns a tool and waits for it. The tool writes straight to the terminal, so its colors and progress stay.
 * @param {ToolInvocation} invocation - What to run.
 * @returns {Promise<number>} Exit code of the tool, or {@link EXIT_CODE_TOOL_UNAVAILABLE} when it could not
 * start.
 */
export function spawnTool(invocation) {
  return new Promise((resolve) => {
    const child = spawn(invocation.command, invocation.arguments, { cwd: invocation.cwd, stdio: invocation.stdio ?? "inherit" });
    child.on("error", (spawnError) => {
      console.error(`golfo-lint: no se pudo ejecutar ${invocation.command}: ${spawnError.message}`);
      resolve(EXIT_CODE_TOOL_UNAVAILABLE);
    });
    child.on("close", (exitCode) => {
      resolve(exitCode ?? EXIT_CODE_TOOL_UNAVAILABLE);
    });
  });
}
