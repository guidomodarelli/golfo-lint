/**
 * @module oxlint/create-oxlint-config Builds the oxlint config of the preset from the ESLint one, so both report the
 * same rules: oxlint runs natively every rule it implements (type-aware ones through tsgolint, on TypeScript 7) and
 * loads the original ESLint plugins as JS plugins for the rest.
 */
import { createRequire } from "node:module";
import migrate from "@oxlint/migrate";
import { createEslintConfig } from "../eslint/create-eslint-config.js";

const require = createRequire(import.meta.url);

/**
 * @typedef {import("../eslint/create-eslint-config.js").EslintConfigOptions} EslintConfigOptions
 * @typedef {import("eslint").Linter.Config} FlatConfig
 * @typedef {string | { name: string; specifier: string }} JsPluginEntry
 * @typedef {{ jsPlugins?: JsPluginEntry[]; rules?: Record<string, unknown>; overrides?: OxlintOverride[] } & Record<string, unknown>} OxlintConfig
 * @typedef {NonNullable<NonNullable<Parameters<typeof migrate>[2]>["reporter"]>} MigrationReporter
 * @typedef {{ files: string[]; jsPlugins?: JsPluginEntry[]; rules?: Record<string, unknown> } & Record<string, unknown>} OxlintOverride
 */

/**
 * @typedef {object} OxlintConfigOptions
 * @property {boolean} [typeAware] - Whether to run the rules that need type information, through tsgolint (default
 * `true`). Each file uses the `tsconfig.json` nearest to it: a folder of tests excluded from the root `tsconfig.json`
 * needs its own, or its types resolve to `any`.
 * @property {boolean} [react] - Same as the ESLint preset option.
 * @property {boolean} [next] - Same as the ESLint preset option.
 * @property {boolean} [vitest] - Same as the ESLint preset option.
 * @property {boolean} [awsCdk] - Same as the ESLint preset option.
 * @property {boolean} [allowDisableComments] - Same as the ESLint preset option.
 * @property {string[]} [ignores] - Same as the ESLint preset option.
 * @property {string[]} [testFiles] - Same as the ESLint preset option.
 */

/** Rules oxlint does not implement yet: they run through the original ESLint plugin, loaded as a JS plugin. */
const NOT_IMPLEMENTED_CATEGORY = "not-implemented";

/**
 * Suffix of the alias that loads a native plugin's ESLint version for the rules oxlint lacks
 * (`unicorn-js/better-dom-traversing`): a JS plugin cannot take the name of a native one.
 */
const JS_PLUGIN_SUFFIX = "-js";

/** Package of each ESLint plugin, by the name `@oxlint/migrate` gives its JS plugin. */
const PLUGIN_PACKAGES = new Map([
  ["eslint-plugin-regexp", "eslint-plugin-regexp"],
  ["eslint-plugin-sonarjs", "eslint-plugin-sonarjs"],
  ["eslint-plugin-eslint-comments", "@eslint-community/eslint-plugin-eslint-comments"],
  ["eslint-plugin-react-you-might-not-need-an-effect", "eslint-plugin-react-you-might-not-need-an-effect"],
]);

/** Package of each plugin oxlint implements natively, by rule prefix: its JS alias loads it for the rules oxlint lacks. */
const NATIVE_PLUGIN_PACKAGES = new Map([
  ["unicorn", "eslint-plugin-unicorn"],
  ["import-x", "eslint-plugin-import-x"],
  ["promise", "eslint-plugin-promise"],
  ["vitest", "@vitest/eslint-plugin"],
  ["react-hooks", "eslint-plugin-react-hooks"],
  ["jsx-a11y-x", "eslint-plugin-jsx-a11y-x"],
  ["@next/next", "@next/eslint-plugin-next"],
]);

/**
 * Rules oxlint implements natively but reports differently from their ESLint plugin on valid code, found on
 * TuTribu: they run through the original plugin, like the ones oxlint lacks.
 */
const NATIVE_RULES_REPORTING_VALID_CODE = new Set([
  // Reports `new Date()` in async Server Components and in event handlers defined during render.
  "react-hooks/purity",
]);

/** oxlint's prefix for each ESLint plugin prefix whose rules it implements under another name. */
const OXLINT_PREFIXES = new Map([
  ["react-hooks", "react"],
  ["import-x", "import"],
  ["jsx-a11y-x", "jsx-a11y"],
  ["@next/next", "nextjs"],
  ["@typescript-eslint", "typescript"],
]);

/**
 * Setting of import-x that holds a resolver object. oxlint passes settings to JS plugins as JSON, which drops its
 * methods; without it, import-x uses `import-x/resolver`, which names the same TypeScript resolver.
 */
const NON_SERIALIZABLE_SETTINGS = ["import-x/resolver-next"];

/**
 * Prefix of the preset's own plugin. Its only rule, `golfo-lint/no-unnecessary-condition`, needs type information,
 * which oxlint does not give to JS plugins, so it stays out of the oxlint config.
 */
const GOLFO_LINT_PREFIX = "golfo-lint";

/**
 * Splits a rule name into plugin prefix and rule.
 * @param {string} ruleName - Fully qualified rule name (`unicorn/no-null`, `eqeqeq`).
 * @returns {{ prefix: string | undefined; rule: string }} Its parts.
 */
function splitRuleName(ruleName) {
  const separatorIndex = ruleName.lastIndexOf("/");
  return separatorIndex === -1
    ? { prefix: undefined, rule: ruleName }
    : { prefix: ruleName.slice(0, separatorIndex), rule: ruleName.slice(separatorIndex + 1) };
}

/**
 * Runs `@oxlint/migrate` and lists the rules it skipped because oxlint does not implement them.
 * @param {FlatConfig[]} eslintConfig - ESLint flat config.
 * @param {boolean} typeAware - Whether to include type-aware rules.
 * @returns {Promise<{ config: OxlintConfig; notImplemented: Set<string> }>} The oxlint config and those rules.
 */
async function migrateConfig(eslintConfig, typeAware) {
  /** @type {Set<string>} */
  const notImplemented = new Set();
  /** @type {string[]} */
  const warnings = [];
  const reporter = {
    /** @param {string} message - Warning of the migration. */
    addWarning: (message) => {
      warnings.push(message);
    },
    getWarnings: () => warnings,
    /** @param {string} rule - Skipped rule. @param {string} category - Why it was skipped. */
    markSkipped: (rule, category) => {
      if (category === NOT_IMPLEMENTED_CATEGORY) {
        notImplemented.add(rule);
      }
    },
    /** @param {string} rule - Rule no longer skipped. @param {string} category - Why it had been skipped. */
    removeSkipped: (rule, category) => {
      if (category === NOT_IMPLEMENTED_CATEGORY) {
        notImplemented.delete(rule);
      }
    },
    getSkippedRulesByCategory: () => ({}),
  };
  const config = /** @type {OxlintConfig} */ (
    await migrate(eslintConfig, undefined, {
      typeAware,
      jsPlugins: true,
      reporter: /** @type {MigrationReporter} */ (/** @type {unknown} */ (reporter)),
    })
  );
  return { config, notImplemented };
}

/**
 * Names the JS alias of a native plugin prefix; plugin names cannot hold `@` or `/` (`@next/next` is `next-next-js`).
 * @param {string} prefix - Native rule prefix.
 * @returns {string} Alias.
 */
function aliasOf(prefix) {
  return `${prefix.replace(/^@/u, "").replaceAll("/", "-")}${JS_PLUGIN_SUFFIX}`;
}

/**
 * Builds the JS plugin entry that loads a native plugin's ESLint version under its alias.
 * @param {string} prefix - Native rule prefix (`unicorn`).
 * @returns {{ name: string; specifier: string }} JS plugin entry.
 */
function createAliasPlugin(prefix) {
  return {
    name: aliasOf(prefix),
    specifier: require.resolve(/** @type {string} */ (NATIVE_PLUGIN_PACKAGES.get(prefix))),
  };
}

/**
 * Checks whether a rule entry turns the rule off.
 * @param {unknown} entry - Rule entry (`"off"`, `0`, `["error", options]`).
 * @returns {boolean} Whether its severity is off.
 */
function isOff(entry) {
  const severity = Array.isArray(entry) ? entry[0] : entry;
  return severity === "off" || severity === 0;
}

/**
 * Lists, config by config, the rules oxlint lacks from the plugins it implements natively, renamed to their JS
 * alias. The migration drops them: they come back through the original plugin, in the root config when the ESLint
 * config applies to every file and in an override for its files otherwise, in the same order as in ESLint.
 * @param {FlatConfig[]} eslintConfig - ESLint flat config.
 * @param {Set<string>} notImplemented - Rules oxlint does not implement.
 * @returns {{ rootRules: Record<string, unknown>; overrides: OxlintOverride[]; prefixes: Set<string> }} Aliased
 * rules for the root config and for overrides, and the native prefixes whose JS plugin the root config loads.
 */
function collectAliasedRules(eslintConfig, notImplemented) {
  /** @type {Record<string, unknown>} */
  const rootRules = {};
  /** @type {OxlintOverride[]} */
  const overrides = [];
  /** @type {Map<string, string>} */
  const prefixesByAlias = new Map();
  for (const config of eslintConfig) {
    /** @type {Record<string, unknown>} */
    const rules = {};
    for (const [ruleName, entry] of Object.entries(config.rules ?? {})) {
      const { prefix, rule } = splitRuleName(ruleName);
      if (prefix !== undefined && NATIVE_PLUGIN_PACKAGES.has(prefix) && notImplemented.has(ruleName)) {
        rules[`${aliasOf(prefix)}/${rule}`] = entry;
        prefixesByAlias.set(aliasOf(prefix), prefix);
      }
    }
    if (Object.keys(rules).length === 0) {
      continue;
    }
    const files = /** @type {string[] | undefined} */ (config.files);
    if (files === undefined) {
      Object.assign(rootRules, rules);
    } else {
      const aliases = new Set(Object.keys(rules).map((ruleName) => splitRuleName(ruleName).prefix ?? ""));
      overrides.push({
        files,
        jsPlugins: [...aliases].map((alias) => createAliasPlugin(/** @type {string} */ (prefixesByAlias.get(alias)))),
        rules,
      });
    }
  }
  // A rule the root config only turns off needs no plugin: its JS plugin would load for nothing.
  const enabledRootRules = Object.fromEntries(Object.entries(rootRules).filter(([, entry]) => !isOff(entry)));
  const prefixes = new Set(
    [...Object.keys(enabledRootRules), ...overrides.flatMap((override) => Object.keys(override.rules ?? {}))].map(
      (ruleName) => /** @type {string} */ (prefixesByAlias.get(splitRuleName(ruleName).prefix ?? "")),
    ),
  );
  return { rootRules: enabledRootRules, overrides, prefixes };
}

/**
 * Turns the JS plugin names `@oxlint/migrate` writes into entries oxlint can load from any project: the package is
 * resolved from `@golfo/lint`, which depends on it, and the entry keeps the rule prefix as its name.
 * @param {JsPluginEntry[] | undefined} jsPlugins - JS plugins of a config or override.
 * @returns {JsPluginEntry[] | undefined} Resolved entries, without the preset's own plugin.
 * @throws {Error} When the migration names a plugin this module does not know.
 */
function resolveJsPlugins(jsPlugins) {
  if (jsPlugins === undefined) {
    return undefined;
  }
  return jsPlugins.flatMap((entry) => {
    const pluginName = typeof entry === "string" ? entry : entry.specifier;
    if (pluginName === `eslint-plugin-${GOLFO_LINT_PREFIX}`) {
      return [];
    }
    const packageName = PLUGIN_PACKAGES.get(pluginName);
    if (packageName === undefined) {
      throw new Error(`@golfo/lint does not know which package provides the oxlint JS plugin ${pluginName}.`);
    }
    return [{ name: pluginName.replace(/^eslint-plugin-/u, ""), specifier: require.resolve(packageName) }];
  });
}

/**
 * Removes the preset's own rules, which need type information that oxlint does not give to JS plugins.
 * @param {Record<string, unknown> | undefined} rules - Rules of a config or override.
 * @returns {Record<string, unknown> | undefined} The rules without them.
 */
function dropGolfoLintRules(rules) {
  if (rules === undefined) {
    return undefined;
  }
  return Object.fromEntries(
    Object.entries(rules).filter(([ruleName]) => splitRuleName(ruleName).prefix !== GOLFO_LINT_PREFIX),
  );
}

/**
 * Names a rule the way oxlint does (`react-hooks/purity` is `react/purity`).
 * @param {string} ruleName - ESLint rule name.
 * @returns {string} oxlint rule name.
 */
function toOxlintName(ruleName) {
  const { prefix, rule } = splitRuleName(ruleName);
  return prefix === undefined ? rule : `${OXLINT_PREFIXES.get(prefix) ?? prefix}/${rule}`;
}

/**
 * Copies an object without some keys.
 * @param {Record<string, unknown> | undefined} object - Object to copy.
 * @param {string[]} keys - Keys to leave out.
 * @returns {Record<string, unknown> | undefined} The copy.
 */
function omitKeys(object, keys) {
  return object === undefined ? undefined : Object.fromEntries(Object.entries(object).filter(([key]) => !keys.includes(key)));
}

/**
 * Builds the oxlint config of the preset: the same rules and options as `createEslintConfig`, with every rule
 * oxlint implements running natively and the rest through the original ESLint plugins as JS plugins. Export it from
 * `oxlint.config.mjs` with `export default await createOxlintConfig({ ... })`.
 * @param {OxlintConfigOptions} [options] - What the project uses.
 * @returns {Promise<OxlintConfig>} oxlint config.
 */
export async function createOxlintConfig(options = {}) {
  const { typeAware = true, ...presetOptions } = options;
  const eslintConfig = createEslintConfig({ ...presetOptions, typeChecked: typeAware });
  const { config, notImplemented } = await migrateConfig(eslintConfig, typeAware);
  const aliased = collectAliasedRules(eslintConfig, new Set([...notImplemented, ...NATIVE_RULES_REPORTING_VALID_CODE]));
  const nativeNamesToDrop = new Set([...NATIVE_RULES_REPORTING_VALID_CODE].map((ruleName) => toOxlintName(ruleName)));
  /** @param {Record<string, unknown> | undefined} rules - Rules of a config or override. */
  const keepOxlintRules = (rules) =>
    Object.fromEntries(Object.entries(dropGolfoLintRules(rules) ?? {}).filter(([ruleName]) => !nativeNamesToDrop.has(ruleName)));
  return {
    ...config,
    options: { typeAware },
    jsPlugins: [...(resolveJsPlugins(config.jsPlugins) ?? []), ...[...aliased.prefixes].map((prefix) => createAliasPlugin(prefix))],
    settings: omitKeys(/** @type {Record<string, unknown> | undefined} */ (config.settings), NON_SERIALIZABLE_SETTINGS),
    rules: { ...keepOxlintRules(config.rules), ...aliased.rootRules },
    overrides: [
      ...(config.overrides ?? []).map((override) => ({
        ...override,
        jsPlugins: resolveJsPlugins(override.jsPlugins),
        rules: keepOxlintRules(override.rules),
      })),
      ...aliased.overrides,
    ],
  };
}
