import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createKnipConfig, KNIP_DEFAULTS } from "../../src/knip/index.js";

describe("createKnipConfig", () => {
  it("parte de los valores compartidos", () => {
    assert.deepEqual(createKnipConfig(), KNIP_DEFAULTS);
  });

  it("deja que el proyecto agregue y reemplace opciones", () => {
    const config = createKnipConfig({ ignoreDependencies: ["sharp"], ignoreExportsUsedInFile: false });
    assert.deepEqual(config, { ignoreExportsUsedInFile: false, ignoreDependencies: ["sharp"] });
  });
});
