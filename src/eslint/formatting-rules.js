/**
 * @module eslint/formatting-rules Finds the rules that only decide how code looks, so the preset never
 * enables them: formatting belongs to a formatter (Prettier, Biome, oxfmt), not to the linter.
 */

/** Rule type that ESLint reserves for whitespace, semicolons, commas and other layout concerns. */
const LAYOUT_RULE_TYPE = "layout";

/**
 * Rules that plugins do not type as `layout` but that only choose between equivalent spellings of the same
 * code: letter case, escapes, `if` versus ternary or `switch`, `String.raw`, and similar syntax preferences.
 * They change no behavior, so they only add churn to code written by agents.
 */
export const STYLISTIC_SUGGESTION_RULES = [
  "regexp/hexadecimal-escape",
  "regexp/sort-alternatives",
  "regexp/sort-flags",
  "regexp/unicode-escape",
  "unicorn/consistent-conditional-object-spread",
  "unicorn/escape-case",
  "unicorn/import-style",
  "unicorn/no-hex-escape",
  "unicorn/no-lonely-if",
  "unicorn/no-negated-condition",
  "unicorn/no-nested-ternary",
  "unicorn/no-useless-undefined",
  "unicorn/no-zero-fractions",
  "unicorn/number-literal-case",
  "unicorn/numeric-separators-style",
  "unicorn/prefer-block-statement-over-iife",
  "unicorn/prefer-class-fields",
  "unicorn/prefer-identifier-import-export-specifiers",
  "unicorn/prefer-logical-operator-over-ternary",
  "unicorn/prefer-minimal-ternary",
  "unicorn/prefer-optional-catch-binding",
  "unicorn/prefer-short-escape-sequences",
  "unicorn/prefer-string-raw",
  "unicorn/prefer-switch",
  "unicorn/prefer-ternary",
  "unicorn/prefer-unary-minus",
  "unicorn/prefer-unicode-code-point-escapes",
  "unicorn/prefer-while-loop-condition",
  "unicorn/relative-url-style",
  "unicorn/template-indent",
  "unicorn/text-encoding-identifier-case",
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
