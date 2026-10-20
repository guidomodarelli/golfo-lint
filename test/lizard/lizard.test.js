import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createLizardArguments, findLizardCommand, LIZARD_CANDIDATES } from "../../src/lizard/index.js";
import { MAX_CYCLOMATIC_COMPLEXITY } from "../../src/shared/thresholds.js";

describe("createLizardArguments", () => {
  it("usa el mismo límite de complejidad que ESLint", () => {
    const lizardArguments = createLizardArguments();
    assert.equal(lizardArguments[lizardArguments.indexOf("--CCN") + 1], String(MAX_CYCLOMATIC_COMPLEXITY));
  });

  it("acepta límites propios del proyecto", () => {
    const lizardArguments = createLizardArguments({ maxCyclomaticComplexity: 7, maxLinesOfCode: 40 });
    assert.equal(lizardArguments[lizardArguments.indexOf("--CCN") + 1], "7");
    assert.ok(lizardArguments.includes("nloc=40"));
  });
});

describe("findLizardCommand", () => {
  it("elige la primera forma de ejecutar lizard que funciona", () => {
    const uvx = LIZARD_CANDIDATES.find((candidate) => candidate.command === "uvx");
    assert.equal(findLizardCommand((candidate) => candidate.command !== "lizard"), uvx);
  });

  it("devuelve undefined cuando ninguna funciona", () => {
    assert.equal(findLizardCommand(() => false), undefined);
  });
});
