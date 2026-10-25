import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

/** Helper as a project imports it. */
const HELPER_URL = new URL("../../src/react-scan/index.js", import.meta.url).href;

/**
 * Calls `startReactScan()` in a fresh Node.js process and reports what it left behind.
 * @param {Record<string, string>} environment - Extra environment variables, such as `NODE_ENV`.
 * @param {string} [setup] - Code that runs first, such as defining `document`.
 * @returns {{ status: number | null; output: string }} Exit code and what the process printed.
 */
function callStartReactScan(environment, setup = "") {
  const script = [
    setup,
    `const { startReactScan } = await import(${JSON.stringify(HELPER_URL)});`,
    "startReactScan();",
    "await new Promise((resolve) => setTimeout(resolve, 200));",
    'console.log(JSON.stringify({ reactGrabFlag: "__REACT_GRAB__" in globalThis }));',
  ].join("\n");
  const result = spawnSync(process.execPath, ["--input-type=module", "--eval", script], {
    cwd: fileURLToPath(new URL("../..", import.meta.url)),
    encoding: "utf8",
    env: { ...process.env, NODE_ENV: "", ...environment },
  });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

describe("startReactScan", () => {
  it("no hace nada fuera de desarrollo, aunque haya navegador", () => {
    const { status, output } = callStartReactScan({ NODE_ENV: "production" }, "globalThis.document = {};");
    assert.equal(status, 0);
    assert.equal(output.trim(), JSON.stringify({ reactGrabFlag: false }));
  });

  it("no hace nada en el servidor en desarrollo", () => {
    const { status, output } = callStartReactScan({ NODE_ENV: "development" });
    assert.equal(status, 0);
    assert.equal(output.trim(), JSON.stringify({ reactGrabFlag: false }));
  });

  it("en desarrollo, en el navegador, evita que react-scan consulte react-grab.com sin romper la app", () => {
    const { status, output } = callStartReactScan({ NODE_ENV: "development" }, "globalThis.document = {};");
    assert.equal(status, 0);
    assert.ok(output.includes(JSON.stringify({ reactGrabFlag: true })));
  });
});
