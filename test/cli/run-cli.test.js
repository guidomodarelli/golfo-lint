import assert from "node:assert/strict";
import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { LINT_COMMANDS } from "../../src/cli/commands/index.js";
import { EXIT_CODE_SUCCESS, EXIT_CODE_USAGE_ERROR } from "../../src/cli/constants.js";
import { formatUsage, runCli } from "../../src/cli/run-cli.js";
import { spawnTool } from "../../src/cli/spawn-tool.js";

/** Exit code the analysis tools return when they find problems. */
const EXIT_CODE_PROBLEMS_FOUND = 1;

/**
 * Resolves a fixture folder.
 * @param {string} name - Folder under `test/fixtures`.
 * @returns {string} Absolute path.
 */
function fixturePath(name) {
  return fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url));
}

/** Collects messages sent to `log` and `warn`, and runs tools without printing their output. */
function createSilentOptions() {
  /** @type {string[]} */
  const messages = [];
  return {
    messages,
    /** @param {string} message */
    log: (message) => {
      messages.push(message);
    },
    /** @param {string} message */
    warn: (message) => {
      messages.push(message);
    },
    /** @param {import("../../src/cli/spawn-tool.js").ToolInvocation} invocation */
    runTool: (invocation) => spawnTool({ ...invocation, stdio: "ignore" }),
  };
}

describe("runCli", () => {
  it("muestra el uso con --help", async () => {
    const options = createSilentOptions();
    assert.equal(await runCli(["--help"], options), EXIT_CODE_SUCCESS);
    assert.deepEqual(options.messages, [formatUsage(LINT_COMMANDS)]);
  });

  it("falla con un análisis desconocido", async () => {
    const options = createSilentOptions();
    assert.equal(await runCli(["format"], options), EXIT_CODE_USAGE_ERROR);
    assert.match(options.messages[0], /análisis desconocido "format"/);
  });

  it("falla sin análisis", async () => {
    assert.equal(await runCli([], createSilentOptions()), EXIT_CODE_USAGE_ERROR);
  });

  it("duplicates detecta código copiado con jscpd", async () => {
    const options = createSilentOptions();
    assert.equal(await runCli(["duplicates"], { ...options, cwd: fixturePath("duplicated") }), EXIT_CODE_PROBLEMS_FOUND);
  });

  it("duplicates no cuenta los tests duplicados", async () => {
    const options = createSilentOptions();
    assert.equal(await runCli(["duplicates"], { ...options, cwd: fixturePath("duplicated-tests") }), EXIT_CODE_SUCCESS);
  });

  it("duplicates pasa cuando el código copiado queda por debajo del umbral", async () => {
    const projectDirectory = mkdtempSync(path.join(tmpdir(), "golfo-jscpd-"));
    try {
      cpSync(fixturePath("duplicated"), projectDirectory, { recursive: true });
      const uniqueLines = Array.from({ length: 3000 }, (_, index) => `export const value${index} = ${index};`);
      writeFileSync(path.join(projectDirectory, "unique.js"), `${uniqueLines.join("\n")}\n`);
      const options = createSilentOptions();
      assert.equal(await runCli(["duplicates"], { ...options, cwd: projectDirectory }), EXIT_CODE_SUCCESS);
    } finally {
      rmSync(projectDirectory, { recursive: true, force: true });
    }
  });

  it("duplicates no cuenta como copiados los bloques de imports iguales", async () => {
    const projectDirectory = mkdtempSync(path.join(tmpdir(), "golfo-jscpd-"));
    try {
      const imports = Array.from({ length: 12 }, (_, index) => `import { value${index}, other${index} } from "./module-${index}.js";`);
      writeFileSync(path.join(projectDirectory, "first.js"), `${imports.join("\n")}\nexport const first = value0 + 1;\n`);
      writeFileSync(path.join(projectDirectory, "second.js"), `${imports.join("\n")}\nexport const second = other3 * 2;\n`);
      const options = createSilentOptions();
      assert.equal(await runCli(["duplicates"], { ...options, cwd: projectDirectory }), EXIT_CODE_SUCCESS);
    } finally {
      rmSync(projectDirectory, { recursive: true, force: true });
    }
  });

  it("duplicates pasa cuando no hay código copiado", async () => {
    const options = createSilentOptions();
    assert.equal(await runCli(["duplicates"], { ...options, cwd: fixturePath("complex") }), EXIT_CODE_SUCCESS);
  });

  it("unused detecta archivos sin uso con knip", async () => {
    const options = createSilentOptions();
    assert.equal(await runCli(["unused"], { ...options, cwd: fixturePath("knip-project") }), EXIT_CODE_PROBLEMS_FOUND);
  });
});
