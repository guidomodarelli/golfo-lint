/**
 * @module eslint/formatting-rules Finds the rules that only decide how code looks, so the preset never
 * enables them: formatting belongs to a formatter (Prettier, Biome, oxfmt), not to the linter.
 */

/** Rule type that ESLint reserves for whitespace, semicolons, commas and other layout concerns. */
const LAYOUT_RULE_TYPE = "layout";

/**
 * Rules that plugins do not type as `layout` but that only choose between equivalent spellings of the
 * same code (letter case, escapes, indentation inside templates, ordering).
 */
export const STYLISTIC_SUGGESTION_RULES = [
  "unicorn/number-literal-case",
  "unicorn/numeric-separators-style",
  "unicorn/template-indent",
  "unicorn/escape-case",
  "unicorn/no-hex-escape",
  "unicorn/text-encoding-identifier-case",
  "unicorn/no-nested-ternary",
  "regexp/sort-flags",
  "regexp/sort-alternatives",
  "regexp/hexadecimal-escape",
  "regexp/unicode-escape",
];

/**
 * @typedef {object} RuleModule
 * @property {{ type?: string }} [meta] - Rule metadata; `type` is `problem`, `suggestion` or `layout`.
 */

/**
 * Lists the rules of some plugins that only format code: every rule typed `layout` plus
 * {@link STYLISTIC_SUGGESTION_RULES}.
 * @param {Record<string, { rules?: Record<string, RuleModule> }>} pluginsByPrefix - Plugins keyed by the prefix
 * their rules use in a config (`unicorn`, `regexp`, ...).
 * @returns {string[]} Fully qualified rule names, sorted.
 */
export function listFormattingRules(pluginsByPrefix) {
  const layoutRules = Object.entries(pluginsByPrefix).flatMap(([prefix, plugin]) =>
    Object.entries(plugin.rules ?? {})
      .filter(([, rule]) => rule.meta?.type === LAYOUT_RULE_TYPE)
      .map(([ruleName]) => `${prefix}/${ruleName}`),
  );
  return [...new Set([...layoutRules, ...STYLISTIC_SUGGESTION_RULES])].toSorted((leftRule, rightRule) => leftRule.localeCompare(rightRule));
}

/**
 * Builds the rule entries that turn formatting rules off.
 * @param {string[]} ruleNames - Rules to turn off.
 * @returns {Record<string, "off">} Rule entries for a flat config.
 */
export function turnOffRules(ruleNames) {
  return Object.fromEntries(ruleNames.map((ruleName) => [ruleName, "off"]));
}
