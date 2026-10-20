import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { selectAttwProfile } from "../../src/package/select-attw-profile.js";

describe("selectAttwProfile", () => {
  it("usa esm-only para paquetes ESM sin entrada require", () => {
    assert.equal(selectAttwProfile({ type: "module", exports: { ".": { types: "./a.d.ts", default: "./a.js" } } }), "esm-only");
  });

  it("usa node16 cuando el paquete ofrece require", () => {
    assert.equal(
      selectAttwProfile({ type: "module", exports: { ".": { import: "./a.js", require: "./a.cjs" } } }),
      "node16",
    );
  });

  it("usa node16 para paquetes CommonJS", () => {
    assert.equal(selectAttwProfile({ exports: "./index.js" }), "node16");
  });
});
