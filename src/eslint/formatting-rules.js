/**
 * @module eslint/formatting-rules Lists the rules the preset never enables: formatting, syntax preferences and
 * rules that duplicate another one. Formatting belongs to a formatter (Prettier, Biome, oxfmt), and a choice
 * between two equivalent spellings of the same code only adds churn to code written by agents.
 */

/** Rule type that ESLint reserves for whitespace, semicolons, commas and other layout concerns. */
const LAYOUT_RULE_TYPE = "layout";

/**
 * Rules that plugins do not type as `layout` but that only choose between equivalent spellings of the same
 * code. They change no behavior. Plugin types do not separate them (some are `problem`), so they are listed.
 */
export const STYLISTIC_SUGGESTION_RULES = [
  // Regular expressions: equivalent ways to write the same pattern (`[^\d]` or `\D`, `{1,}` or `+`).
  "regexp/control-character-escape",
  "regexp/hexadecimal-escape",
  "regexp/match-any",
  "regexp/negation",
  "regexp/no-trivially-nested-quantifier",
  "regexp/no-useless-character-class",
  "regexp/no-useless-escape",
  "regexp/no-useless-non-capturing-group",
  "regexp/no-useless-two-nums-quantifier",
  "regexp/prefer-character-class",
  "regexp/prefer-d",
  "regexp/prefer-plus-quantifier",
  "regexp/prefer-predefined-assertion",
  "regexp/prefer-question-quantifier",
  "regexp/prefer-range",
  "regexp/prefer-set-operation",
  "regexp/prefer-star-quantifier",
  "regexp/prefer-unicode-codepoint-escapes",
  "regexp/prefer-w",
  "regexp/simplify-set-operations",
  "regexp/sort-alternatives",
  "regexp/sort-flags",
  "regexp/unicode-escape",
  "regexp/use-ignore-case",
  // SonarJS: type and test layout preferences (`expect(a === b).toBe(true)` or `expect(a).toBe(b)`).
  "sonarjs/parameterized-tests",
  "sonarjs/prefer-specific-assertions",
  "sonarjs/redundant-type-aliases",
  "sonarjs/use-type-alias",
  "sonarjs/void-use",
  // Template literals inside template literals, and multiline blocks without braces: how the code is laid out,
  // which a formatter settles (`if (ready) start(); stop();` on one line becomes two lines with their indentation).
  "sonarjs/no-nested-template-literals",
  "sonarjs/no-unenclosed-multiline-block",
  // unicorn: control flow written another way (`if` or ternary, `.then` or `await`, early return or `else`).
  "unicorn/consistent-conditional-object-spread",
  "unicorn/no-declarations-before-early-exit",
  "unicorn/no-lonely-if",
  "unicorn/no-negated-array-predicate",
  "unicorn/no-negated-condition",
  "unicorn/no-nested-ternary",
  "unicorn/no-subtraction-comparison",
  "unicorn/no-typeof-undefined",
  "unicorn/no-useless-undefined",
  "unicorn/prefer-await",
  "unicorn/prefer-block-statement-over-iife",
  "unicorn/prefer-boolean-return",
  "unicorn/prefer-default-parameters",
  "unicorn/prefer-early-return",
  "unicorn/prefer-logical-operator-over-ternary",
  "unicorn/prefer-math-min-max",
  "unicorn/prefer-minimal-ternary",
  "unicorn/prefer-optional-catch-binding",
  "unicorn/prefer-switch",
  "unicorn/prefer-ternary",
  "unicorn/prefer-top-level-await",
  "unicorn/prefer-while-loop-condition",
  // unicorn: one API spelled another way (`window` or `globalThis`, `replace(/x/g)` or `replaceAll`, `forEach`).
  "unicorn/consistent-compound-words",
  "unicorn/import-style",
  "unicorn/no-for-each",
  // `[...items].sort()` and `items.toSorted()` do the same.
  "unicorn/no-array-reverse",
  "unicorn/no-array-sort",
  "unicorn/no-unnecessary-global-this",
  "unicorn/prefer-add-event-listener-options",
  "unicorn/prefer-array-from-map",
  "unicorn/prefer-at",
  "unicorn/prefer-class-fields",
  "unicorn/prefer-direct-iteration",
  "unicorn/prefer-global-number-constants",
  "unicorn/prefer-global-this",
  "unicorn/prefer-identifier-import-export-specifiers",
  "unicorn/prefer-object-define-properties",
  "unicorn/prefer-promise-with-resolvers",
  "unicorn/prefer-response-static-json",
  "unicorn/prefer-split-limit",
  "unicorn/prefer-string-repeat",
  "unicorn/prefer-string-replace-all",
  "unicorn/prefer-url-href",
  "unicorn/relative-url-style",
  // `Number(value)` and `Number.parseFloat(value)` differ on `""` and `"12px"`: rewriting one as the other is
  // not a safe fix.
  "unicorn/prefer-number-coercion",
  // unicorn: literals written another way (letter case, escapes, separators, `1.0`).
  "unicorn/escape-case",
  "unicorn/no-hex-escape",
  "unicorn/no-zero-fractions",
  "unicorn/number-literal-case",
  "unicorn/numeric-separators-style",
  "unicorn/prefer-short-escape-sequences",
  "unicorn/prefer-string-raw",
  "unicorn/prefer-unary-minus",
  "unicorn/prefer-unicode-code-point-escapes",
  "unicorn/template-indent",
  "unicorn/text-encoding-identifier-case",
  // vitest: `toHaveBeenCalledOnce()` plus `toHaveBeenCalledWith()` or one `toHaveBeenCalledExactlyOnceWith()`. Its
  // fix also crashes ESLint ("Fix objects must not be overlapped") when both assertions share a line.
  "vitest/prefer-called-exactly-once-with",
  // promise: the name of the executor parameters, and returning from a `then` callback that has nothing to return.
  "promise/always-return",
  "promise/param-names",
  // Braces around a one-statement `if`, `readonly` on props React never mutates, `crypto` or `node:crypto`,
  // `.some((item) => item === value)` or `.includes(value)`, `< 0` or `=== -1`.
  "curly",
  "sonarjs/prefer-read-only-props",
  "unicorn/consistent-existence-index-check",
  "unicorn/prefer-includes",
  "unicorn/prefer-node-protocol",
];

/**
 * Rules that report a problem another enabled rule already reports. An agent would get the same finding twice
 * under two names; the comment says which rule stays.
 */
export const DUPLICATED_RULES = [
  // `no-nested-ternary` stays.
  "sonarjs/no-nested-conditional",
  "unicorn/no-unnecessary-nested-ternary",
  // `@typescript-eslint/no-deprecated` stays.
  "sonarjs/deprecation",
  // `regexp/no-dupe-characters-character-class` stays.
  "sonarjs/duplicates-in-character-class",
  // `regexp/no-super-linear-backtracking` and `sonarjs/super-linear-regex` stay: they find different cases.
  // `unicorn/prefer-boolean-return` is a syntax preference, so neither stays.
  "sonarjs/prefer-single-boolean-return",
  // `@typescript-eslint/require-array-sort-compare` stays: it knows the element type and accepts arrays of
  // strings, which these two report and push towards `localeCompare`, whose order changes with the locale.
  "sonarjs/no-alphabetical-sort",
  "unicorn/require-array-sort-compare",
  // `import-x/no-cycle` and dependency-cruiser's `no-circular` both stay: one in the editor, one per repository.
  // `@typescript-eslint/no-unused-vars` stays.
  "sonarjs/no-unused-vars",
  "sonarjs/unused-import",
  // `no-useless-assignment` stays.
  "sonarjs/no-dead-store",
  // `max-nested-callbacks` stays.
  "sonarjs/no-nested-functions",
  // Committed secrets: `golfo-lint secrets` (gitleaks) checks every file and the whole history.
  "sonarjs/no-hardcoded-passwords",
  "sonarjs/no-hardcoded-secrets",
];

/**
 * Rules that report valid code: security hotspots that ask to review something that is usually fine, and rules
 * that forbid a correct pattern. An agent cannot tell when to leave the code as it is, so they stay off.
 */
export const NON_DEFECT_RULES = [
  // SonarJS security hotspots ("make sure ... is safe here"): `spawn("git")` resolved through `PATH`, public DNS
  // addresses, `http://` URLs in tests, `Math.random()` for jitter.
  "sonarjs/no-clear-text-protocols",
  "sonarjs/no-hardcoded-ip",
  "sonarjs/no-os-command-from-path",
  "sonarjs/os-command",
  "sonarjs/pseudo-random",
  // `new Promise((resolve) => setTimeout(resolve, ms))` returns the timer id, which nobody reads.
  "no-promise-executor-return",
  // Scripts that export their functions so tests can import them.
  "unicorn/no-exports-in-scripts",
  // Errors that copy `name` and `stack` from another error, or tests that build an `AbortError`.
  "unicorn/no-error-property-assignment",
  // Loops whose flag an `await`ed callback or another async path sets (`while (!stopped)`): the rule only sees
  // assignments inside the loop.
  "no-unmodified-loop-condition",
  // Methods taken from objects that bind them (`const { push } = useRouter()`): the rule only sees method syntax
  // in the type.
  "@typescript-eslint/unbound-method",
  // `delete draft[id]` on a copy of a record, and `void` as the type argument of a call (`transact<void>(...)`).
  "@typescript-eslint/no-dynamic-delete",
  "@typescript-eslint/no-invalid-void-type",
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
  return [...new Set([...layoutRules, ...STYLISTIC_SUGGESTION_RULES])].toSorted((leftRule, rightRule) =>
    leftRule.localeCompare(rightRule),
  );
}

/**
 * Builds the rule entries that turn rules off.
 * @param {string[]} ruleNames - Rules to turn off.
 * @returns {Record<string, "off">} Rule entries for a flat config.
 */
export function turnOffRules(ruleNames) {
  return Object.fromEntries(ruleNames.map((ruleName) => [ruleName, "off"]));
}
