/** @module cli/spawn-tool Runs an analysis tool with the terminal attached and reports its exit code. */
import { spawn } from "node:child_process";
import { EXIT_CODE_TOOL_UNAVAILABLE } from "./constants.js";

/**
 * @typedef {object} ToolInvocation
 * @property {string} command - Executable to spawn.
 * @property {string[]} arguments - Arguments for the executable.
 * @property {string} cwd - Folder to run it in.
 * @property {"inherit" | "ignore"} [stdio] - Whether the tool writes to the terminal (default `inherit`).
 * @property {boolean} [shell] - Runs it through a shell, which Windows needs for `.cmd` shims such as npm and pnpm.
 * Only for fixed arguments, since the shell does not escape them.
 */

/**
 * Spawns a tool and waits for it. The tool writes straight to the terminal, so its colors and progress stay.
 * @param {ToolInvocation} invocation - What to run.
 * @returns {Promise<number>} Exit code of the tool, or {@link EXIT_CODE_TOOL_UNAVAILABLE} when it could not
 * start.
 */
export function spawnTool(invocation) {
  const options = { cwd: invocation.cwd, stdio: invocation.stdio ?? "inherit" };
  return new Promise((resolve) => {
    // A shell gets the whole command line: Node.js deprecates passing it an argument list it would not escape.
    const child =
      invocation.shell === true
        ? spawn([invocation.command, ...invocation.arguments].join(" "), { ...options, shell: true })
        : spawn(invocation.command, invocation.arguments, options);
    child.on("error", (spawnError) => {
      console.error(`golfo-lint: no se pudo ejecutar ${invocation.command}: ${spawnError.message}`);
      resolve(EXIT_CODE_TOOL_UNAVAILABLE);
    });
    child.on("close", (exitCode) => {
      resolve(exitCode ?? EXIT_CODE_TOOL_UNAVAILABLE);
    });
  });
}
