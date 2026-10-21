import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";
import { createEslintConfig, DUPLICATED_RULES, STYLISTIC_SUGGESTION_RULES } from "../../src/eslint/index.js";

const TYPED_FIXTURE_DIRECTORY = fileURLToPath(new URL("../fixtures/typed", import.meta.url));

/** Code that silences a rule with a comment instead of fixing it, as an agent might. */
const DISABLED_RULE_SNIPPET = "// eslint-disable-next-line eqeqeq\nexport const isZero = (value) => value == 0;\n";

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
 * @returns {Promise<{ ruleName: string; type: string | undefined; severity: unknown }[]>} Enabled rules.
 */
async function listEnabledRules(options, fileName) {
  const config = await createLinter(options).calculateConfigForFile(path.join(TYPED_FIXTURE_DIRECTORY, fileName));
  return Object.entries(config.rules)
    .filter(([, entry]) => (Array.isArray(entry) ? entry[0] : entry) !== 0)
    .map(([ruleName, entry]) => {
      const separatorIndex = ruleName.lastIndexOf("/");
      const pluginName = separatorIndex === -1 ? "@" : ruleName.slice(0, separatorIndex);
      const rule = config.plugins[pluginName]?.rules?.[ruleName.slice(separatorIndex + 1)];
      const severity = Array.isArray(entry) ? entry[0] : entry;
      return { ruleName, type: rule?.meta?.type, severity };
    });
}

describe("createEslintConfig", () => {
  for (const [label, options, fileName] of /** @type {const} */ ([
    ["JavaScript", { typeChecked: false, react: true, next: true, vitest: true }, "snippet.js"],
    ["TypeScript con tipos", { typeChecked: true, react: true, next: true }, "formatted-badly.ts"],
  ])) {
    it(`no habilita reglas de formato (${label})`, async () => {
      const enabledRules = await listEnabledRules(options, fileName);
      assert.ok(enabledRules.length > 100, `se esperaban más de 100 reglas, hay ${enabledRules.length}`);
      const formattingRules = enabledRules.filter(
        ({ ruleName, type }) =>
          type === "layout" || STYLISTIC_SUGGESTION_RULES.includes(ruleName) || DUPLICATED_RULES.includes(ruleName),
      );
      assert.deepEqual(formattingRules, []);
    });
  }

  it("exige palabras completas en lugar de abreviaturas, sin abreviar nombres completos", async () => {
    const ruleIds = await lintSnippet(
      "export function saveApplicationSettings(errMsg) {\n  return { message: errMsg };\n}\n",
    );
    assert.deepEqual(
      ruleIds.filter((ruleId) => ruleId === "unicorn/name-replacements"),
      ["unicorn/name-replacements"],
    );
  });

  it("acepta == null, que cubre null y undefined a propósito", async () => {
    const ruleIds = await lintSnippet("export const isMissing = (value) => value == null;\n");
    assert.deepEqual(ruleIds, []);
  });

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
        "    return v == 0 ? undefined : v;",
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

  it("con tsconfigFiles, usa esos tsconfig para las reglas con tipos", async () => {
    // Its own fixture: typescript-eslint caches programs per tsconfig, and in CI (single run) a program the
    // project service built for another test would be reused.
    const projectDirectory = fileURLToPath(new URL("../fixtures/typed-project", import.meta.url));
    const linter = new ESLint({
      cwd: projectDirectory,
      overrideConfigFile: true,
      overrideConfig: createEslintConfig({ tsconfigRootDir: projectDirectory, tsconfigFiles: ["tsconfig.json"] }),
    });
    const [result] = await linter.lintFiles(["floating-promise.ts"]);
    assert.deepEqual(
      result.messages.map((message) => message.ruleId),
      ["@typescript-eslint/no-floating-promises"],
    );
  });

  it("habilita las reglas de hooks de React solo cuando se piden", async () => {
    const withReact = await listEnabledRules({ typeChecked: false, react: true }, "snippet.js");
    const withoutReact = await listEnabledRules({ typeChecked: false }, "snippet.js");
    assert.ok(withReact.some(({ ruleName }) => ruleName === "react-hooks/rules-of-hooks"));
    assert.ok(withReact.some(({ ruleName }) => ruleName === "jsx-a11y-x/alt-text"));
    assert.ok(withoutReact.every(({ ruleName }) => !/^(?:react-hooks|jsx-a11y-x)\//.test(ruleName)));
  });

  it("con React, reporta imágenes sin texto alternativo", async () => {
    const [result] = await createLinter({ typeChecked: false, react: true }).lintText(
      'export const Avatar = () => <img src="avatar.png" />;\n',
      { filePath: path.join(TYPED_FIXTURE_DIRECTORY, "avatar.jsx") },
    );
    assert.ok(result.messages.some((message) => message.ruleId === "jsx-a11y-x/alt-text"));
  });

  it("con React, reporta estado derivado calculado en un useEffect", async () => {
    const [result] = await createLinter({ typeChecked: false, react: true }).lintText(
      [
        'import { useEffect, useState } from "react";',
        "export function FullName({ first, last }) {",
        '  const [fullName, setFullName] = useState("");',
        "  useEffect(() => {",
        '    setFullName([first, last].join(" "));',
        "  }, [first, last]);",
        "  return <p>{fullName}</p>;",
        "}",
        "",
      ].join("\n"),
      { filePath: path.join(TYPED_FIXTURE_DIRECTORY, "full-name.jsx") },
    );
    assert.ok(result.messages.some((message) => message.ruleId === "react-you-might-not-need-an-effect/no-derived-state"));
  });

  it("con Next.js, reporta <img> en lugar de next/image", async () => {
    const enabledRules = await listEnabledRules({ typeChecked: false, react: true, next: true }, "snippet.js");
    assert.ok(enabledRules.some(({ ruleName }) => ruleName === "@next/next/no-img-element"));
  });

  it("con Vitest, reporta tests enfocados y tests sin asserts", async () => {
    const [result] = await createLinter({ typeChecked: false, vitest: true, testFiles: ["**/*.test.js"] }).lintText(
      'import { it } from "vitest";\n\nit.only("calcula", () => {\n  Math.max(1, 2);\n});\n',
      { filePath: path.join(TYPED_FIXTURE_DIRECTORY, "sum.test.js") },
    );
    const ruleIds = new Set(result.messages.map((message) => message.ruleId));
    assert.ok(ruleIds.has("vitest/no-focused-tests"));
    assert.ok(ruleIds.has("vitest/expect-expect"));
  });

  it("no deja reglas como advertencia: todo problema es un error", async () => {
    const enabledRules = await listEnabledRules({ typeChecked: true, react: true, next: true }, "formatted-badly.ts");
    assert.deepEqual(
      enabledRules.filter(({ severity }) => severity !== 2).map(({ ruleName }) => ruleName),
      [],
    );
  });

  it("no deja silenciar reglas con comentarios", async () => {
    const ruleIds = await lintSnippet(DISABLED_RULE_SNIPPET);
    assert.ok(ruleIds.includes("eslint-comments/no-use"));
  });

  it("con allowDisableComments, exige explicar por qué se silencia una regla", async () => {
    const [result] = await createLinter({ typeChecked: false, allowDisableComments: true }).lintText(
      DISABLED_RULE_SNIPPET,
      { filePath: path.join(TYPED_FIXTURE_DIRECTORY, "snippet.js") },
    );
    const ruleIds = result.messages.map((message) => message.ruleId);
    assert.deepEqual(ruleIds, ["eslint-comments/require-description"]);
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
