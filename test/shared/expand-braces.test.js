import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { expandBraces } from "../../src/shared/expand-braces.js";

describe("expandBraces", () => {
  it("expande cada grupo de llaves en globs separados", () => {
    assert.deepEqual(expandBraces("**/*.{test,spec}.{js,ts}"), [
      "**/*.test.js",
      "**/*.test.ts",
      "**/*.spec.js",
      "**/*.spec.ts",
    ]);
  });

  it("deja igual un glob sin llaves", () => {
    assert.deepEqual(expandBraces("**/node_modules/**"), ["**/node_modules/**"]);
  });
});
