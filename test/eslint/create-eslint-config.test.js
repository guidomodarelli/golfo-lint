import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";
import { createEslintConfig, STYLISTIC_SUGGESTION_RULES } from "../../src/eslint/index.js";

const TYPED_FIXTURE_DIRECTORY = fileURLToPath(new URL("../fixtures/typed", import.meta.url));

/**
 * Creates an ESLint instance that uses only the shared preset, as a consumer's `eslint.config.js` would.
 * @param {import("../../src/eslint/index.js").EslintConfigOptions} options - Preset options.
 * @returns {ESLint} Linter rooted at the typed fixture.
 */
function createLinter(options) {
  return new ESLint({
    cwd: TYPED_FIXTURE_DIRECTORY,
    overrideConfigFile: true,
    overrideConfig: createEslintConfig({ tsconfigRootDir: TYPED_FIXTURE_DIRECTORY, testFiles: [], ...options }),
  });
}

/**
 * Lints a snippet as if it were a file of the typed fixture, without type information.
 * @param {string} code - Source to lint.
 * @returns {Promise<string[]>} Rule ids reported.
 */
async function lintSnippet(code) {
  const [result] = await createLinter({ typeChecked: false }).lintText(code, {
    filePath: path.join(TYPED_FIXTURE_DIRECTORY, "snippet.js"),
  });
  return result.messages.map((message) => message.ruleId ?? "fatal");
}

/**
 * Lists the rules a file ends up with, with their metadata.
 * @param {import("../../src/eslint/index.js").EslintConfigOptions} options - Preset options.
 * @param {string} fileName - File of the typed fixture.
 * @returns {Promise<{ ruleName: string; type: string | undefined }[]>} Enabled rules.
 */
async function listEnabledRules(options, fileName) {
  const config = await createLinter(options).calculateConfigForFile(path.join(TYPED_FIXTURE_DIRECTORY, fileName));
  return Object.entries(config.rules)
    .filter(([, entry]) => (Array.isArray(entry) ? entry[0] : entry) !== 0)
    .map(([ruleName]) => {
      const separatorIndex = ruleName.lastIndexOf("/");
      const pluginName = separatorIndex === -1 ? "@" : ruleName.slice(0, separatorIndex);
      const rule = config.plugins[pluginName]?.rules?.[ruleName.slice(separatorIndex + 1)];
      return { ruleName, type: rule?.meta?.type };
    });
}

describe("createEslintConfig", () => {
  for (const [label, options, fileName] of /** @type {const} */ ([
    ["JavaScript", { typeChecked: false, react: true }, "snippet.js"],
    ["TypeScript con tipos", { typeChecked: true, react: true }, "formatted-badly.ts"],
  ])) {
    it(`no habilita reglas de formato (${label})`, async () => {
      const enabledRules = await listEnabledRules(options, fileName);
      assert.ok(enabledRules.length > 100, `se esperaban más de 100 reglas, hay ${enabledRules.length}`);
      const formattingRules = enabledRules.filter(
        ({ ruleName, type }) => type === "layout" || STYLISTIC_SUGGESTION_RULES.includes(ruleName),
      );
      assert.deepEqual(formattingRules, []);
    });
  }

  it("no reporta código correcto aunque esté mal formateado", async () => {
    const [result] = await createLinter({}).lintFiles(["formatted-badly.ts"]);
    assert.deepEqual(result.messages, []);
  });

  it("reporta comparaciones laxas, nombres de una letra y errores mal nombrados", async () => {
    const ruleIds = await lintSnippet(
      [
        "export function parse(raw) {",
        "  try {",
        "    const v = JSON.parse(raw);",
        "    return v == null ? undefined : v;",
        "  } catch (e) {",
        "    throw new Error(\"parse failed\", { cause: e });",
        "  }",
        "}",
      ].join("\n"),
    );
    assert.ok(ruleIds.includes("eqeqeq"));
    assert.ok(ruleIds.includes("id-length"));
    assert.ok(ruleIds.includes("unicorn/catch-error-name"));
  });

  it("reporta números mágicos y funciones demasiado complejas", async () => {
    const branches = Array.from({ length: 11 }, (_, index) => `  if (value === "${String(index)}") { return; }`);
    const ruleIds = await lintSnippet(
      ["export function check(value) {", ...branches, "}", "export const toMilliseconds = (seconds) => seconds * 1000;"].join("\n"),
    );
    assert.ok(ruleIds.includes("complexity"));
    assert.ok(ruleIds.includes("@typescript-eslint/no-magic-numbers"));
  });

  it("con tipos, reporta promesas que nadie espera", async () => {
    const [result] = await createLinter({}).lintFiles(["floating-promise.ts"]);
    const ruleIds = result.messages.map((message) => message.ruleId);
    assert.deepEqual(ruleIds, ["@typescript-eslint/no-floating-promises"]);
  });

  it("habilita las reglas de hooks de React solo cuando se piden", async () => {
    const withReact = await listEnabledRules({ typeChecked: false, react: true }, "snippet.js");
    const withoutReact = await listEnabledRules({ typeChecked: false }, "snippet.js");
    assert.ok(withReact.some(({ ruleName }) => ruleName === "react-hooks/rules-of-hooks"));
    assert.ok(withoutReact.every(({ ruleName }) => !ruleName.startsWith("react-hooks/")));
  });

  it("relaja los límites en los archivos de test", async () => {
    const [result] = await new ESLint({
      cwd: TYPED_FIXTURE_DIRECTORY,
      overrideConfigFile: true,
      overrideConfig: createEslintConfig({ typeChecked: false }),
    }).lintText('import { it } from "node:test";\n\nit("espera", () => setTimeout(() => {}, 3000));\n', {
      filePath: path.join(TYPED_FIXTURE_DIRECTORY, "timeout.test.js"),
    });
    assert.deepEqual(result.messages, []);
  });
});
