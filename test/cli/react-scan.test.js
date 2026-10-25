import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { EXIT_CODE_SETUP_NOT_DETECTED, EXIT_CODE_SUCCESS } from "../../src/cli/constants.js";
import { createReactScanInstallInvocation, REACT_SCAN_VERSION } from "../../src/cli/react-scan/install-react-scan.js";
import { runCli } from "../../src/cli/run-cli.js";

/** @typedef {import("../../src/cli/spawn-tool.js").ToolInvocation} ToolInvocation */

/** Line that `golfo-lint react-scan` adds to import the helper. */
const HELPER_IMPORT = 'import { startReactScan } from "@golfo/lint/react-scan";';

/** Exit code of a package manager that could not install. */
const EXIT_CODE_INSTALL_FAILED = 1;

/** Temporary projects created by the tests, removed at the end. */
const temporaryFolders = /** @type {string[]} */ ([]);

after(() => {
  for (const folder of temporaryFolders) {
    rmSync(folder, { recursive: true, force: true });
  }
});

/**
 * Creates a temporary project with the given files.
 * @param {Record<string, string | object>} files - Contents by relative path; objects are written as JSON.
 * @returns {string} Project folder.
 */
function createProject(files) {
  const folder = mkdtempSync(path.join(tmpdir(), "golfo-lint-react-scan-"));
  temporaryFolders.push(folder);
  for (const [relativePath, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(folder, relativePath)), { recursive: true });
    writeFileSync(path.join(folder, relativePath), typeof content === "string" ? content : JSON.stringify(content));
  }
  return folder;
}

/**
 * Runs `golfo-lint react-scan` on a project, recording the tools it would run instead of installing from the
 * registry: `runTool` is the CLI's own boundary for spawning tools.
 * @param {string} cwd - Project folder.
 * @param {number} [installExitCode] - Exit code the package manager returns.
 * @returns {Promise<{ exitCode: number; messages: string[]; invocations: ToolInvocation[] }>} Result.
 */
async function runReactScan(cwd, installExitCode = EXIT_CODE_SUCCESS) {
  /** @type {string[]} */
  const messages = [];
  /** @type {ToolInvocation[]} */
  const invocations = [];
  /** @param {string} message */
  const collect = (message) => {
    messages.push(message);
  };
  const exitCode = await runCli(["react-scan"], {
    cwd,
    log: collect,
    warn: collect,
    runTool: async (invocation) => {
      invocations.push(invocation);
      return installExitCode;
    },
  });
  return { exitCode, messages, invocations };
}

/** Vite project that already declares react-scan. */
const VITE_PROJECT = {
  "package.json": { dependencies: { react: "19.0.0" }, devDependencies: { vite: "8.0.0", "react-scan": REACT_SCAN_VERSION } },
  "index.html": '<html><body><script type="module" src="/src/main.tsx"></script></body></html>',
  "src/main.tsx": 'import { createRoot } from "react-dom/client";\n\ncreateRoot(document.body).render(null);\n',
};

describe("golfo-lint react-scan", () => {
  it("conecta el helper al principio del entry de Vite y muestra el diff", async () => {
    const cwd = createProject(VITE_PROJECT);
    const { exitCode, messages, invocations } = await runReactScan(cwd);
    assert.equal(exitCode, EXIT_CODE_SUCCESS);
    assert.deepEqual(invocations, []);
    const entry = readFileSync(path.join(cwd, "src/main.tsx"), "utf8");
    assert.ok(entry.startsWith("// react-scan"));
    assert.ok(entry.includes(`${HELPER_IMPORT}\n\nstartReactScan();\n\nimport { createRoot }`));
    assert.ok(messages.some((message) => message.includes(`+${HELPER_IMPORT}`) && message.includes("+++ b/src/main.tsx")));
  });

  it("no duplica nada si ya está conectado", async () => {
    const cwd = createProject(VITE_PROJECT);
    await runReactScan(cwd);
    const connected = readFileSync(path.join(cwd, "src/main.tsx"), "utf8");
    const { exitCode, messages } = await runReactScan(cwd);
    assert.equal(exitCode, EXIT_CODE_SUCCESS);
    assert.equal(readFileSync(path.join(cwd, "src/main.tsx"), "utf8"), connected);
    assert.ok(messages.some((message) => message.includes("ya inicia react-scan")));
  });

  it("no toca un entry que ya carga react-scan por su cuenta", async () => {
    const entry = 'import { scan } from "react-scan";\n\nscan();\n';
    const cwd = createProject({ ...VITE_PROJECT, "src/main.tsx": entry });
    const { exitCode } = await runReactScan(cwd);
    assert.equal(exitCode, EXIT_CODE_SUCCESS);
    assert.equal(readFileSync(path.join(cwd, "src/main.tsx"), "utf8"), entry);
  });

  it("crea instrumentation-client.ts en Next.js, para App y Pages Router", async () => {
    const cwd = createProject({
      "package.json": { dependencies: { next: "16.0.0", react: "19.0.0" }, devDependencies: { "react-scan": REACT_SCAN_VERSION } },
      "tsconfig.json": "{}",
      "pages/index.tsx": "export default function Home() { return null; }\n",
    });
    const { exitCode, messages } = await runReactScan(cwd);
    assert.equal(exitCode, EXIT_CODE_SUCCESS);
    assert.ok(readFileSync(path.join(cwd, "instrumentation-client.ts"), "utf8").includes(HELPER_IMPORT));
    assert.ok(messages.some((message) => message.includes("--- /dev/null")));
  });

  it("usa src/ y el instrumentation-client existente en Next.js con src/app", async () => {
    const cwd = createProject({
      "package.json": { dependencies: { next: "^15.3.0", react: "19.0.0" }, devDependencies: { "react-scan": REACT_SCAN_VERSION } },
      "src/app/layout.tsx": "export default function Layout() { return null; }\n",
      "src/instrumentation-client.js": "console.log('client');\n",
    });
    assert.equal((await runReactScan(cwd)).exitCode, EXIT_CODE_SUCCESS);
    const instrumentation = readFileSync(path.join(cwd, "src/instrumentation-client.js"), "utf8");
    assert.ok(instrumentation.includes(HELPER_IMPORT));
    assert.ok(instrumentation.endsWith("console.log('client');\n"));
    assert.ok(!existsSync(path.join(cwd, "instrumentation-client.js")));
  });

  it("instala react-scan con versión exacta y el package manager del proyecto antes de conectarlo", async () => {
    const cwd = createProject({ ...VITE_PROJECT, "package.json": { dependencies: { react: "19.0.0", vite: "8.0.0" } }, "pnpm-lock.yaml": "" });
    const { exitCode, invocations } = await runReactScan(cwd);
    assert.equal(exitCode, EXIT_CODE_SUCCESS);
    assert.deepEqual(
      invocations.map((invocation) => [invocation.command, ...invocation.arguments]),
      [["pnpm", "add", "--save-dev", "--save-exact", `react-scan@${REACT_SCAN_VERSION}`]],
    );
  });

  it("no conecta nada si la instalación falla", async () => {
    const cwd = createProject({
      ...VITE_PROJECT,
      "package.json": { dependencies: { react: "19.0.0", vite: "8.0.0" } },
      "package-lock.json": "{}",
    });
    const { exitCode, messages } = await runReactScan(cwd, EXIT_CODE_INSTALL_FAILED);
    assert.equal(exitCode, EXIT_CODE_INSTALL_FAILED);
    assert.ok(!readFileSync(path.join(cwd, "src/main.tsx"), "utf8").includes(HELPER_IMPORT));
    assert.match(messages.at(-1) ?? "", /npm install --save-dev --save-exact react-scan@.* falló/);
  });

  it("termina con error y explica cómo conectarlo a mano si no detecta el framework, sin instalar", async () => {
    const cwd = createProject({ "package.json": { dependencies: { react: "19.0.0" } } });
    const { exitCode, messages, invocations } = await runReactScan(cwd);
    assert.equal(exitCode, EXIT_CODE_SETUP_NOT_DETECTED);
    assert.deepEqual(invocations, []);
    assert.ok(messages[0].includes("no encontré Next.js ni Vite"));
    assert.ok(messages[0].includes(HELPER_IMPORT));
  });

  it("no conecta Next.js anterior a 15.3, que no tiene instrumentation-client", async () => {
    const cwd = createProject({ "package.json": { dependencies: { next: "14.2.0", react: "18.3.0" } } });
    const { exitCode } = await runReactScan(cwd);
    assert.equal(exitCode, EXIT_CODE_SETUP_NOT_DETECTED);
    assert.ok(!existsSync(path.join(cwd, "instrumentation-client.js")));
  });

  it("no aplica a proyectos sin React", async () => {
    const cwd = createProject({ "package.json": { dependencies: { vite: "8.0.0" } } });
    const { exitCode, messages } = await runReactScan(cwd);
    assert.equal(exitCode, EXIT_CODE_SUCCESS);
    assert.match(messages[0], /no aplica \(el proyecto no depende de react\)/);
  });

  it("toma el package manager del campo packageManager, o del lockfile del monorepo", () => {
    const workspace = createProject({ "yarn.lock": "", "packages/app/package.json": "{}" });
    const appFolder = path.join(workspace, "packages/app");
    assert.equal(createReactScanInstallInvocation(appFolder, {}).command, "yarn");
    assert.equal(createReactScanInstallInvocation(appFolder, { packageManager: "bun@1.2.0" }).command, "bun");
  });
});
