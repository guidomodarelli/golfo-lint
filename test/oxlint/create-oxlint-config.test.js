import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { createOxlintConfig } from "../../src/oxlint/index.js";

const run = promisify(execFile);
const require = createRequire(import.meta.url);
const TYPED_FIXTURE_DIRECTORY = fileURLToPath(new URL("../fixtures/typed", import.meta.url));

/**
 * Lints files of the typed fixture with oxlint and the preset's oxlint config.
 * @param {string[]} files - Files of the fixture.
 * @returns {Promise<string[]>} Codes reported (`typescript(no-floating-promises)`).
 */
async function lintFixture(files) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "golfo-oxlint-"));
  try {
    const configFile = path.join(directory, "oxlint.json");
    await writeFile(configFile, JSON.stringify(await createOxlintConfig({ testFiles: [] })));
    const oxlintBin = path.join(path.dirname(require.resolve("oxlint/package.json")), "bin", "oxlint");
    const { stdout } = await run(process.execPath, [oxlintBin, "-c", configFile, "--type-aware", "-f", "json", ...files], {
      cwd: TYPED_FIXTURE_DIRECTORY,
    }).catch((/** @type {{ stdout: string }} */ error) => error);
    const report = /** @type {{ diagnostics: { code: string }[] }} */ (JSON.parse(stdout));
    return report.diagnostics.map((diagnostic) => diagnostic.code);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

describe("createOxlintConfig", () => {
  it("carga los plugins JS desde @golfo/lint y deja afuera la regla propia que necesita tipos", async () => {
    const config = await createOxlintConfig({ react: true, next: true, vitest: true });
    const entries = [...(config.jsPlugins ?? []), ...(config.overrides ?? []).flatMap((override) => override.jsPlugins ?? [])];
    assert.ok(entries.length > 0);
    for (const entry of entries) {
      assert.equal(typeof entry, "object");
      assert.ok(existsSync(/** @type {{ specifier: string }} */ (entry).specifier), JSON.stringify(entry));
    }
    const ruleNames = [config.rules ?? {}, ...(config.overrides ?? []).map((override) => override.rules ?? {})].flatMap(
      (rules) => Object.keys(rules),
    );
    assert.deepEqual(ruleNames.filter((ruleName) => ruleName.startsWith("golfo-lint/")), []);
    assert.equal(config.options?.typeAware, true);
  });

  it("corre las reglas que oxlint no implementa con el plugin original, bajo un alias", async () => {
    const config = await createOxlintConfig();
    assert.ok(Object.keys(config.rules ?? {}).some((ruleName) => ruleName.startsWith("unicorn-js/")));
    assert.ok((config.jsPlugins ?? []).some((entry) => typeof entry === "object" && entry.name === "unicorn-js"));
  });

  it("con tipos, reporta una promesa sin esperar", async () => {
    const codes = await lintFixture(["floating-promise.ts"]);
    assert.ok(codes.includes("typescript(no-floating-promises)"), codes.join(", "));
  });
});
