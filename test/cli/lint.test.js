import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import {
  EXIT_CODE_PROBLEMS_FOUND,
  EXIT_CODE_SUCCESS,
  EXIT_CODE_TOOL_UNAVAILABLE,
} from "../../src/cli/constants.js";
import { runCli } from "../../src/cli/run-cli.js";

/** Folders the tests create, removed at the end. */
const createdFolders = /** @type {string[]} */ ([]);

after(() => {
  for (const folder of createdFolders) {
    rmSync(folder, { recursive: true, force: true });
  }
});

/**
 * Creates a project with an ESLint config and a leftover oxlint config, which `bun lint` would prefer.
 * @returns {string} Project folder.
 */
function createProject() {
  const folder = mkdtempSync(path.join(tmpdir(), "golfo-lint-lint-"));
  createdFolders.push(folder);
  writeFileSync(path.join(folder, "eslint.config.js"), "export default [];\n");
  writeFileSync(path.join(folder, ".oxlintrc.json"), "{}\n");
  return folder;
}

/**
 * Runs `golfo-lint lint` with a fake `bun lint` that writes a report and exits with a given code.
 * @param {{ exitCode: number; messages: object[]; toolArguments?: string[] }} fake - What the fake reports.
 * @returns {Promise<{ exitCode: number; arguments: string[]; output: string[] }>} Result, the arguments `bun lint`
 * got and the messages of `golfo-lint`.
 */
async function runLint({ exitCode, messages, toolArguments = [] }) {
  const cwd = createProject();
  /** @type {string[]} */
  let received = [];
  /** @type {string[]} */
  const output = [];
  const result = await runCli(["lint", ...toolArguments], {
    cwd,
    log: (message) => output.push(message),
    warn: (message) => output.push(message),
    runTool: async (invocation) => {
      received = invocation.arguments;
      const reportPath = received[received.indexOf("--output-file") + 1];
      writeFileSync(reportPath, JSON.stringify([{ filePath: path.join(cwd, "index.js"), messages }]));
      return exitCode;
    },
  });
  return { exitCode: result, arguments: received, output };
}

/** A problem of a rule the filter does not touch. */
const PROBLEM = { ruleId: "eqeqeq", severity: 2, message: "Expected '==='", line: 1, column: 1 };

describe("golfo-lint lint", () => {
  it("le pasa a bun lint el eslint.config del proyecto, aunque haya un .oxlintrc.json", async () => {
    const { arguments: received } = await runLint({ exitCode: EXIT_CODE_SUCCESS, messages: [] });
    assert.deepEqual(received.slice(received.indexOf("--config"), received.indexOf("--config") + 2), [
      "--config",
      "eslint.config.js",
    ]);
  });

  it("respeta el config que elige quien lo llama", async () => {
    const { arguments: received } = await runLint({
      exitCode: EXIT_CODE_SUCCESS,
      messages: [],
      toolArguments: ["-c", "eslint.other.js"],
    });
    assert.equal(received.filter((argument) => argument === "--config").length, 0);
    assert.deepEqual(received.slice(-2), ["-c", "eslint.other.js"]);
  });

  it("falla cuando bun lint avisa que algunas reglas no corrieron, aunque no haya problemas", async () => {
    const { exitCode, output } = await runLint({ exitCode: 2, messages: [] });
    assert.equal(exitCode, EXIT_CODE_TOOL_UNAVAILABLE);
    assert.match(output.join("\n"), /algunas reglas no corrieron/u);
  });

  it("muestra los problemas y también falla cuando algunas reglas no corrieron", async () => {
    const { exitCode, output } = await runLint({ exitCode: 2, messages: [PROBLEM] });
    assert.equal(exitCode, EXIT_CODE_TOOL_UNAVAILABLE);
    assert.match(output.join("\n"), /eqeqeq/u);
  });

  it("reporta los problemas cuando corrieron todas las reglas", async () => {
    const { exitCode } = await runLint({ exitCode: EXIT_CODE_PROBLEMS_FOUND, messages: [PROBLEM] });
    assert.equal(exitCode, EXIT_CODE_PROBLEMS_FOUND);
  });
});
