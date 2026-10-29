import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { createKnipConfig, KNIP_DEFAULTS } from "../../src/knip/index.js";

/**
 * Resolves a fixture folder.
 * @param {string} name - Folder under `test/fixtures`.
 * @returns {string} Absolute path.
 */
function fixturePath(name) {
  return fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url));
}

describe("createKnipConfig", () => {
  it("parte de los valores compartidos", () => {
    assert.deepEqual(createKnipConfig({}, { projectDirectory: fixturePath("knip-project") }), KNIP_DEFAULTS);
  });

  it("deja que el proyecto agregue y reemplace opciones", () => {
    const config = createKnipConfig(
      { ignoreDependencies: ["sharp"], ignoreExportsUsedInFile: false },
      { projectDirectory: fixturePath("knip-project") },
    );
    assert.deepEqual(config, { ...KNIP_DEFAULTS, ignoreExportsUsedInFile: false, ignoreDependencies: ["sharp"] });
  });

  it("acepta server-only sin declararlo en un proyecto de Next.js que lo importa", () => {
    const config = createKnipConfig({ ignoreDependencies: ["sharp"] }, { projectDirectory: fixturePath("next-project") });
    assert.deepEqual(config.ignoreDependencies, ["server-only", "sharp"]);
  });

  it("no los acepta fuera de Next.js", () => {
    assert.equal(createKnipConfig({}, { projectDirectory: fixturePath("knip-project") }).ignoreDependencies, undefined);
  });

  it("toma la config de @golfo/rp como entrada, porque golfo-rp lee sus exports", () => {
    const config = createKnipConfig({}, { projectDirectory: fixturePath("next-project") });
    assert.ok(config.entry?.includes("golfo-rp.config.mjs"));
  });

  it("toma como entrada los archivos que cargan otras herramientas, solo si existen", () => {
    const config = createKnipConfig({ entry: ["tests/runtime/*/index.ts"] }, { projectDirectory: fixturePath("next-project") });
    assert.deepEqual(config.entry, [
      "golfo-rp.config.mjs",
      "open-next.config.ts",
      ".golfo-rp/*.{js,cjs,mjs}",
      "scripts/**/*.{js,cjs,mjs,jsx,ts,cts,mts,tsx}",
      ".dependency-cruiser.mjs",
      "tests/runtime/*/index.ts",
    ]);
    assert.equal(createKnipConfig({}, { projectDirectory: fixturePath("knip-project") }).entry, undefined);
  });

  it("no toma la config de una herramienta como entrada cuando el proyecto depende de ella: su plugin de knip la encuentra", () => {
    const projectDirectory = mkdtempSync(path.join(tmpdir(), "golfo-knip-"));
    try {
      writeFileSync(path.join(projectDirectory, "package.json"), JSON.stringify({ devDependencies: { stylelint: "1.0.0" } }));
      writeFileSync(path.join(projectDirectory, "stylelint.config.mjs"), "export default {};\n");
      writeFileSync(path.join(projectDirectory, ".dependency-cruiser.mjs"), "export default {};\n");
      assert.deepEqual(createKnipConfig({}, { projectDirectory }).entry, [".dependency-cruiser.mjs"]);
    } finally {
      rmSync(projectDirectory, { recursive: true, force: true });
    }
  });

  it("le pasa al plugin de Playwright todas sus configs, también las de otras suites", () => {
    const config = createKnipConfig({}, { projectDirectory: fixturePath("next-project") });
    assert.deepEqual(config.playwright, { config: ["playwright.ui.config.ts"] });
  });
});
