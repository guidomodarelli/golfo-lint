import assert from "node:assert/strict";
import { describe, it } from "node:test";
import stylelint from "stylelint";
import { createStylelintConfig } from "../../src/stylelint/index.js";

/**
 * Lints SCSS with the shared config.
 * @param {string} code - SCSS source.
 * @param {import("../../src/stylelint/index.js").StylelintConfigOptions} [options] - Config options.
 * @returns {Promise<string[]>} Rules that reported problems.
 */
async function lintScss(code, options) {
  const { results } = await stylelint.lint({
    code,
    codeFilename: "component.module.scss",
    config: createStylelintConfig(options),
  });
  return results.flatMap((result) => result.warnings.map((warning) => warning.rule));
}

describe("createStylelintConfig", () => {
  it("no reporta SCSS correcto aunque esté mal formateado", async () => {
    const rules = await lintScss(".Card{color:red;&__title{   font-weight:500}}\n\n\n.Card--muted   {opacity:0.5}");
    assert.deepEqual(rules, []);
  });

  it("reporta propiedades desconocidas, ids e !important", async () => {
    const rules = await lintScss("#header .Card {\n  colr: red;\n  margin: 0 !important;\n}\n");
    assert.ok(rules.includes("property-no-unknown"));
    assert.ok(rules.includes("selector-max-id"));
    assert.ok(rules.includes("declaration-no-important"));
  });

  it("ignora los comentarios que apagan reglas", async () => {
    const rules = await lintScss("/* stylelint-disable-next-line declaration-no-important */\n.Card { margin: 0 !important; }\n");
    assert.ok(rules.includes("declaration-no-important"));
  });

  it("con bem, exige nombres de clase BEM", async () => {
    assert.deepEqual(await lintScss(".CourseCard__title--muted { color: red; }", { bem: true }), []);
    assert.ok((await lintScss(".course-card { color: red; }", { bem: true })).includes("selector-class-pattern"));
    assert.deepEqual(await lintScss(".course-card { color: red; }"), []);
  });
});
