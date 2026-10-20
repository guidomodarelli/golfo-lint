import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { EXIT_CODE_SUCCESS } from "../../src/cli/constants.js";
import { runCli } from "../../src/cli/run-cli.js";
import { spawnTool } from "../../src/cli/spawn-tool.js";
import { GITLEAKS_CANDIDATES } from "../../src/secrets/gitleaks-tool.js";
import { findExternalCommand } from "../../src/shared/find-external-command.js";
import { ACTIONLINT_CANDIDATES } from "../../src/workflows/workflow-tools.js";

/** Characters of a GitHub personal access token after its `ghp_` prefix. */
const GITHUB_TOKEN_BODY_LENGTH = 36;

/**
 * Resolves a fixture folder.
 * @param {string} name - Folder under `test/fixtures`.
 * @returns {string} Absolute path.
 */
function fixturePath(name) {
  return fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url));
}

/**
 * Runs a subcommand on a folder without printing the tool's output.
 * @param {string} commandName - Subcommand.
 * @param {string} cwd - Folder to analyze.
 * @returns {Promise<{ exitCode: number; messages: string[] }>} Exit code and `golfo-lint` messages.
 */
async function runSilently(commandName, cwd) {
  /** @type {string[]} */
  const messages = [];
  /** @param {string} message */
  const collect = (message) => {
    messages.push(message);
  };
  const exitCode = await runCli([commandName], {
    cwd,
    log: collect,
    warn: collect,
    runTool: (invocation) => spawnTool({ ...invocation, stdio: "ignore" }),
  });
  return { exitCode, messages };
}

/**
 * Builds a GitHub token that looks real, at runtime, so no secret-looking string is committed.
 * @returns {string} Fake token.
 */
function createFakeGithubToken() {
  const alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const body = [...randomBytes(GITHUB_TOKEN_BODY_LENGTH)].map((byte) => alphabet[byte % alphabet.length]).join("");
  return `ghp_${body}`;
}

/** Temporary folders created by the tests, removed at the end. */
const temporaryFolders = /** @type {string[]} */ ([]);

/**
 * Creates an empty temporary folder.
 * @returns {string} Its path.
 */
function createTemporaryFolder() {
  const folder = mkdtempSync(path.join(tmpdir(), "golfo-lint-"));
  temporaryFolders.push(folder);
  return folder;
}

after(() => {
  for (const folder of temporaryFolders) {
    rmSync(folder, { recursive: true, force: true });
  }
});

describe("golfo-lint architecture", () => {
  it("detecta ciclos con la configuración compartida", async () => {
    const { exitCode } = await runSilently("architecture", fixturePath("cycle"));
    assert.notEqual(exitCode, EXIT_CODE_SUCCESS);
  });

  it("detecta que domain importa infrastructure con las reglas hexagonales", async () => {
    const { exitCode } = await runSilently("architecture", fixturePath("architecture"));
    assert.notEqual(exitCode, EXIT_CODE_SUCCESS);
  });

  it("pasa cuando las dependencias respetan las reglas", async () => {
    const { exitCode } = await runSilently("architecture", fixturePath("knip-project"));
    assert.equal(exitCode, EXIT_CODE_SUCCESS);
  });
});

describe("golfo-lint react", () => {
  it("detecta estado derivado e índices como key, aunque sean advertencias", async () => {
    const { exitCode } = await runSilently("react", fixturePath("react-project"));
    assert.notEqual(exitCode, EXIT_CODE_SUCCESS);
  });

  it("no aplica a proyectos sin React", async () => {
    const { exitCode, messages } = await runSilently("react", fixturePath("cycle"));
    assert.equal(exitCode, EXIT_CODE_SUCCESS);
    assert.match(messages[0], /no aplica \(el proyecto no depende de react\)/);
  });
});

describe("golfo-lint styles", () => {
  it("detecta propiedades desconocidas, ids e !important en SCSS", async () => {
    const { exitCode } = await runSilently("styles", fixturePath("styles"));
    assert.notEqual(exitCode, EXIT_CODE_SUCCESS);
  });

  it("pasa cuando no hay archivos de estilos", async () => {
    const { exitCode } = await runSilently("styles", fixturePath("cycle"));
    assert.equal(exitCode, EXIT_CODE_SUCCESS);
  });
});

describe("golfo-lint package", () => {
  it("detecta exports que apuntan a archivos inexistentes", async () => {
    const { exitCode } = await runSilently("package", fixturePath("broken-package"));
    assert.notEqual(exitCode, EXIT_CODE_SUCCESS);
  });

  it("no aplica a paquetes privados", async () => {
    const { exitCode, messages } = await runSilently("package", fixturePath("cycle"));
    assert.equal(exitCode, EXIT_CODE_SUCCESS);
    assert.match(messages[0], /no aplica \(el paquete es privado/);
  });
});

describe("golfo-lint monorepo", () => {
  it("detecta versiones distintas de una dependencia entre workspaces", async () => {
    const { exitCode } = await runSilently("monorepo", fixturePath("monorepo"));
    assert.notEqual(exitCode, EXIT_CODE_SUCCESS);
  });

  it("no aplica a proyectos sin workspaces", async () => {
    const { exitCode, messages } = await runSilently("monorepo", fixturePath("cycle"));
    assert.equal(exitCode, EXIT_CODE_SUCCESS);
    assert.match(messages[0], /no aplica \(no declara workspaces\)/);
  });
});

describe("golfo-lint workflows", { skip: findExternalCommand(ACTIONLINT_CANDIDATES) === undefined && "uv no está disponible" }, () => {
  it("detecta workflows inválidos o inseguros", async () => {
    const { exitCode } = await runSilently("workflows", fixturePath("workflows"));
    assert.notEqual(exitCode, EXIT_CODE_SUCCESS);
  });

  it("no aplica sin .github/workflows", async () => {
    const { exitCode, messages } = await runSilently("workflows", fixturePath("cycle"));
    assert.equal(exitCode, EXIT_CODE_SUCCESS);
    assert.match(messages[0], /no aplica/);
  });
});

describe("golfo-lint secrets", { skip: findExternalCommand(GITLEAKS_CANDIDATES) === undefined && "gitleaks no está instalado" }, () => {
  it("detecta un token en un archivo", async () => {
    const folder = createTemporaryFolder();
    writeFileSync(path.join(folder, "config.js"), `export const token = "${createFakeGithubToken()}";\n`);
    const { exitCode } = await runSilently("secrets", folder);
    assert.notEqual(exitCode, EXIT_CODE_SUCCESS);
  });

  it("pasa cuando no hay secretos", async () => {
    const folder = createTemporaryFolder();
    writeFileSync(path.join(folder, "config.js"), 'export const greeting = "hola";\n');
    const { exitCode } = await runSilently("secrets", folder);
    assert.equal(exitCode, EXIT_CODE_SUCCESS);
  });
});
