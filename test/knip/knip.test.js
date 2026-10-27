import assert from "node:assert/strict";
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
});
