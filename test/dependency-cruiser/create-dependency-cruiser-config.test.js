import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createDependencyCruiserConfig } from "../../src/dependency-cruiser/index.js";

describe("createDependencyCruiserConfig", () => {
  it("agrega las reglas hexagonales solo cuando se pide", () => {
    /** @param {ReturnType<typeof createDependencyCruiserConfig>} config */
    const ruleNames = (config) => config.forbidden.map((rule) => rule.name);
    assert.ok(!ruleNames(createDependencyCruiserConfig()).includes("domain-depends-on-nothing"));
    assert.ok(ruleNames(createDependencyCruiserConfig({ hexagonalModulesPath: "src/modules" })).includes("domain-depends-on-nothing"));
  });

  it("no deja que las capas de un módulo importen un setup.ts, la raíz de composición", () => {
    const rule = createDependencyCruiserConfig({ hexagonalModulesPath: "src/modules" }).forbidden.find(
      (forbiddenRule) => forbiddenRule.name === "layers-not-to-setup",
    );
    assert.ok(rule);
    const from = new RegExp(/** @type {string} */ (rule.from.path), "u");
    const to = new RegExp(/** @type {string} */ (rule.to.path), "u");
    assert.equal(from.test("src/modules/events/application/use-cases/list-events.ts"), true);
    assert.equal(from.test("src/modules/events/setup.ts"), false);
    assert.equal(to.test("src/modules/events/setup.ts"), true);
    assert.equal(to.test("src/modules/setup.ts"), true);
    assert.equal(to.test("src/modules/events/application/setup-reminders.ts"), false);
  });

  it("prohíbe las rutas que el proyecto indique, con su explicación", () => {
    const config = createDependencyCruiserConfig({
      forbiddenPaths: [{ name: "no-features", path: "^src/features/", comment: "Usá src/modules." }],
    });
    const rule = config.forbidden.find((forbiddenRule) => forbiddenRule.name === "no-features");
    assert.deepEqual(rule?.to, { path: "^src/features/" });
    assert.equal(rule?.comment, "Usá src/modules.");
  });

  it("deja que las carpetas de mocks importen devDependencies, como msw", () => {
    const rule = createDependencyCruiserConfig().forbidden.find((forbiddenRule) => forbiddenRule.name === "not-to-dev-dep");
    assert.ok(rule);
    const excluded = /** @type {string[]} */ (rule.from.pathNot).map((pattern) => new RegExp(pattern, "u"));
    /** @param {string} path */
    const isExcluded = (path) => excluded.some((pattern) => pattern.test(path));
    assert.equal(isExcluded("src/mocks/handlers.ts"), true);
    assert.equal(isExcluded("src/modules/shared/infrastructure/dev-mocks/start-mocks.ts"), true);
    assert.equal(isExcluded("src/modules/shared/infrastructure/http-client.ts"), false);
  });

  it("todas las reglas son errores", () => {
    const config = createDependencyCruiserConfig({ hexagonalModulesPath: "src/modules" });
    assert.ok(config.forbidden.every((rule) => rule.severity === "error"));
  });
});
