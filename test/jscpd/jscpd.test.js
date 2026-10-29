import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createJscpdArguments, JSCPD_DEFAULTS } from "../../src/jscpd/index.js";

describe("createJscpdArguments", () => {
  it("falla por encima del umbral de duplicación compartido", () => {
    const jscpdArguments = createJscpdArguments();
    assert.equal(jscpdArguments[jscpdArguments.indexOf("--threshold") + 1], String(JSCPD_DEFAULTS.threshold));
  });

  it("no pasa --exit-code, que haría fallar con cualquier clon aunque esté por debajo del umbral", () => {
    assert.equal(createJscpdArguments().includes("--exit-code"), false);
  });

  it("acepta valores propios del proyecto", () => {
    const jscpdArguments = createJscpdArguments({ minTokens: 80, reporters: ["console", "json"] });
    assert.equal(jscpdArguments[jscpdArguments.indexOf("--min-tokens") + 1], "80");
    assert.equal(jscpdArguments[jscpdArguments.indexOf("--reporters") + 1], "console,json");
  });
});
