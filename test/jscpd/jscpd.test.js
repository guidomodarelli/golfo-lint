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

  it("ignora las sentencias import, que no son código copiado", () => {
    const jscpdArguments = createJscpdArguments();
    const pattern = new RegExp(jscpdArguments[jscpdArguments.indexOf("--ignore-pattern") + 1].replace("(?m)", ""), "m");
    assert.match('import { a, b } from "./module";', pattern);
    assert.match('import type {\n  A,\n  B,\n} from "@/types";', pattern);
    assert.match('import "./side-effect.css";', pattern);
    assert.doesNotMatch("const imported = load(value);", pattern);
  });

  it("acepta valores propios del proyecto", () => {
    const jscpdArguments = createJscpdArguments({ minTokens: 80, reporters: ["console", "json"] });
    assert.equal(jscpdArguments[jscpdArguments.indexOf("--min-tokens") + 1], "80");
    assert.equal(jscpdArguments[jscpdArguments.indexOf("--reporters") + 1], "console,json");
  });
});
