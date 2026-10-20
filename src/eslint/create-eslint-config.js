/**
 * @module eslint/create-eslint-config Builds the shared ESLint flat config: rules that catch bugs, dead code,
 * complexity and unclear names, and never rules about formatting.
 */
import process from "node:process";
import eslintComments from "@eslint-community/eslint-plugin-eslint-comments";
import eslintJs from "@eslint/js";
import nextPlugin from "@next/eslint-plugin-next";
import vitestPlugin from "@vitest/eslint-plugin";
import { createTypeScriptImportResolver } from "eslint-import-resolver-typescript";
import importX from "eslint-plugin-import-x";
import jsxA11y from "eslint-plugin-jsx-a11y-x";
import promisePlugin from "eslint-plugin-promise";
import reactHooks from "eslint-plugin-react-hooks";
import reactEffects from "eslint-plugin-react-you-might-not-need-an-effect";
import regexpPlugin from "eslint-plugin-regexp";
import sonarjs from "eslint-plugin-sonarjs";
import unicorn from "eslint-plugin-unicorn";
import globals from "globals";
import tseslint from "typescript-eslint";
import {
  IGNORED_PATH_GLOBS,
  MAX_COGNITIVE_COMPLEXITY,
  MAX_CYCLOMATIC_COMPLEXITY,
  MAX_FUNCTION_LINES,
  MAX_FUNCTION_PARAMETERS,
  MAX_NESTED_CALLBACKS,
  MAX_NESTING_DEPTH,
  TEST_FILE_GLOBS,
} from "../shared/thresholds.js";
import { listFormattingRules, turnOffRules } from "./formatting-rules.js";

/** @typedef {import("eslint").Linter.Config} FlatConfig */

/** Files written in TypeScript, which get type-aware rules. */
const TYPESCRIPT_FILE_GLOBS = ["**/*.{ts,tsx,mts,cts}"];

/** Tool config files, whose job is the top-level side effect of exporting a computed config. */
const CONFIG_FILE_GLOBS = ["**/*.config.{js,mjs,cjs,ts,mts,cts}"];

/** Files written in JavaScript, which cannot get type-aware rules. */
const JAVASCRIPT_FILE_GLOBS = ["**/*.{js,jsx,mjs,cjs}"];

/** Shortest identifier allowed, except for {@link SHORT_IDENTIFIER_EXCEPTIONS}. */
const MIN_IDENTIFIER_LENGTH = 2;

/** Loop counters and coordinates, the only single-letter names that read clearly. */
const SHORT_IDENTIFIER_EXCEPTIONS = ["i", "j", "k", "x", "y", "z", "_"];

/** Numbers that never need a name: neutral elements, the last index and halving. */
const ALLOWED_MAGIC_NUMBERS = [-1, 0, 1, 2];

/** Abbreviations that frameworks impose (`props`, `params`, `ref`) and that unicorn would otherwise reject. */
const ALLOWED_ABBREVIATIONS = {
  args: true,
  Args: true,
  env: true,
  Env: true,
  params: true,
  Params: true,
  props: true,
  Props: true,
  ref: true,
  Ref: true,
  refs: true,
  tsconfigRootDir: true,
};

/**
 * Plugins whose rules are scanned for formatting rules to turn off, keyed by their rule prefix.
 * @type {Parameters<typeof listFormattingRules>[0]}
 */
const PLUGINS_BY_PREFIX = /** @type {never} */ ({
  "@typescript-eslint": tseslint.plugin,
  "import-x": importX,
  "jsx-a11y-x": jsxA11y,
  promise: promisePlugin,
  "react-hooks": reactHooks,
  "react-you-might-not-need-an-effect": reactEffects,
  "@next/next": nextPlugin,
  vitest: vitestPlugin,
  regexp: regexpPlugin,
  sonarjs,
  unicorn,
});

/**
 * @typedef {object} EslintConfigOptions
 * @property {string} [tsconfigRootDir] - Folder that holds the root `tsconfig.json`; pass `import.meta.dirname`
 * from `eslint.config.js`. Defaults to the current directory.
 * @property {boolean} [typeChecked] - Whether to enable rules that need type information (default `true`).
 * They are slower but catch floating promises, unsafe `any` and unnecessary conditions.
 * @property {boolean} [react] - Whether to enable the React hooks, JSX accessibility and unnecessary `useEffect`
 * rules (default `false`).
 * @property {boolean} [next] - Whether to enable the Next.js rules, Core Web Vitals included (default `false`).
 * @property {boolean} [vitest] - Whether to enable the Vitest rules in test files: no focused or skipped tests,
 * no tests without assertions (default `false`).
 * @property {boolean} [allowDisableComments] - Whether `eslint-disable` comments may silence a rule, as long as
 * they explain why (default `false`: an agent has to fix the code, not silence the linter).
 * @property {string[]} [ignores] - Extra globs to skip, besides dependencies and build output.
 * @property {string[]} [testFiles] - Globs of test files, which get relaxed limits (default: common test paths).
 */

/**
 * Rules from ESLint core that catch bugs or unclear code, beyond `@eslint/js` recommended.
 * @returns {FlatConfig["rules"]} Rule entries.
 */
function createCoreRules() {
  return {
    "array-callback-return": "error",
    complexity: ["error", MAX_CYCLOMATIC_COMPLEXITY],
    curly: ["error", "all"],
    "default-case-last": "error",
    eqeqeq: ["error", "always"],
    "id-length": ["error", { min: MIN_IDENTIFIER_LENGTH, exceptions: SHORT_IDENTIFIER_EXCEPTIONS, properties: "never" }],
    "max-depth": ["error", MAX_NESTING_DEPTH],
    "max-lines-per-function": ["error", { max: MAX_FUNCTION_LINES, skipBlankLines: true, skipComments: true }],
    "max-nested-callbacks": ["error", MAX_NESTED_CALLBACKS],
    "no-constructor-return": "error",
    "no-else-return": ["error", { allowElseIf: false }],
    "no-implicit-coercion": "error",
    "no-nested-ternary": "error",
    "no-new-wrappers": "error",
    "no-param-reassign": "error",
    "no-promise-executor-return": "error",
    "no-self-compare": "error",
    "no-template-curly-in-string": "error",
    "no-unmodified-loop-condition": "error",
    "no-unreachable-loop": "error",
    "no-useless-concat": "error",
    "no-useless-return": "error",
    "no-var": "error",
    "prefer-const": "error",
    "prefer-promise-reject-errors": "error",
  };
}

/**
 * Rules from plugins whose recommended presets need tuning.
 * @returns {FlatConfig["rules"]} Rule entries.
 */
function createPluginRules() {
  return {
    "@typescript-eslint/max-params": ["error", { max: MAX_FUNCTION_PARAMETERS }],
    "@typescript-eslint/no-magic-numbers": [
      "error",
      {
        ignore: ALLOWED_MAGIC_NUMBERS,
        ignoreArrayIndexes: true,
        ignoreDefaultValues: true,
        ignoreEnums: true,
        ignoreNumericLiteralTypes: true,
        ignoreReadonlyClassProperties: true,
        ignoreTypeIndexes: true,
      },
    ],
    "import-x/no-cycle": "error",
    "import-x/no-duplicates": "error",
    "import-x/no-mutable-exports": "error",
    "import-x/no-self-import": "error",
    "import-x/no-useless-path-segments": "error",
    // TypeScript already reports unresolved imports and wrong default imports, with better messages.
    "import-x/no-named-as-default": "off",
    "import-x/no-named-as-default-member": "off",
    "import-x/no-unresolved": "off",
    "sonarjs/cognitive-complexity": ["error", MAX_COGNITIVE_COMPLEXITY],
    // Naming rules from unicorn's opinionated set: an agent that reads `error` and full words needs no guessing.
    "unicorn/catch-error-name": ["error", { name: "error" }],
    "unicorn/name-replacements": ["error", { allowList: ALLOWED_ABBREVIATIONS, checkFilenames: false }],
  };
}

/**
 * Type-aware rules for TypeScript files, beyond `strictTypeChecked`.
 * @param {string} tsconfigRootDir - Folder that holds the root `tsconfig.json`.
 * @returns {FlatConfig[]} Config objects.
 */
function createTypeCheckedConfigs(tsconfigRootDir) {
  return [
    ...tseslint.configs.strictTypeChecked.map((config) => ({ ...config, files: TYPESCRIPT_FILE_GLOBS })),
    {
      files: TYPESCRIPT_FILE_GLOBS,
      languageOptions: { parserOptions: { projectService: true, tsconfigRootDir } },
      rules: {
        "@typescript-eslint/consistent-type-imports": "error",
        "@typescript-eslint/prefer-nullish-coalescing": "error",
        "@typescript-eslint/prefer-optional-chain": "error",
        "@typescript-eslint/switch-exhaustiveness-check": "error",
        "@typescript-eslint/only-throw-error": "error",
      },
    },
  ];
}

/**
 * Severity ESLint reports but never fails on; agents ignore it, so the preset has none.
 * @type {Set<unknown>}
 */
const WARNING_SEVERITIES = new Set(["warn", 1]);

/**
 * Turns every warning into an error. Agents act on failures, not on warnings, and a warning that never
 * fails lets the problem it reports pile up.
 * @param {FlatConfig[]} configs - Config objects.
 * @returns {FlatConfig[]} The same configs with `error` wherever they had `warn`.
 */
function promoteWarningsToErrors(configs) {
  return configs.map((config) => {
    if (config.rules === undefined) {
      return config;
    }
    const rules = Object.fromEntries(
      Object.entries(config.rules).map(([ruleName, entry]) => {
        if (Array.isArray(entry)) {
          const [severity, ...ruleOptions] = entry;
          return [ruleName, WARNING_SEVERITIES.has(severity) ? ["error", ...ruleOptions] : entry];
        }
        return [ruleName, WARNING_SEVERITIES.has(entry) ? "error" : entry];
      }),
    );
    return { ...config, rules };
  });
}

/**
 * Rules about `eslint-disable` and other directive comments.
 * @param {boolean} allowDisableComments - Whether directive comments may silence rules.
 * @returns {FlatConfig} Config object.
 */
function createDirectiveCommentsConfig(allowDisableComments) {
  return {
    name: "golfo-lint/directive-comments",
    plugins: { "eslint-comments": eslintComments },
    linterOptions: { reportUnusedDisableDirectives: "error", reportUnusedInlineConfigs: "error" },
    rules: allowDisableComments
      ? {
          "eslint-comments/no-unlimited-disable": "error",
          "eslint-comments/require-description": "error",
          "eslint-comments/disable-enable-pair": "error",
        }
      : { "eslint-comments/no-use": ["error", { allow: [] }] },
  };
}

/**
 * Rules for the frameworks a project declares.
 * @param {{ react: boolean; next: boolean; vitest: boolean; testFiles: string[] }} frameworks - What the project uses.
 * @returns {FlatConfig[]} Config objects.
 */
function createFrameworkConfigs(frameworks) {
  return [
    ...(frameworks.react
      ? [reactHooks.configs.flat.recommended, jsxA11y.configs.recommended, reactEffects.configs.strict]
      : []),
    ...(frameworks.next ? [nextPlugin.configs["core-web-vitals"]] : []),
    ...(frameworks.vitest && frameworks.testFiles.length > 0
      ? [
          /** @type {FlatConfig} */ ({
            ...vitestPlugin.configs.recommended,
            files: frameworks.testFiles,
            rules: {
              ...vitestPlugin.configs.recommended.rules,
              "vitest/no-standalone-expect": "error",
              "vitest/require-to-throw-message": "error",
              "vitest/valid-title": "error",
            },
          }),
        ]
      : []),
  ];
}

/**
 * Relaxed limits for test files: they list cases, repeat fixtures and nest `describe` callbacks.
 * @param {string[]} testFiles - Globs of test files.
 * @returns {FlatConfig} Config object.
 */
function createTestFilesConfig(testFiles) {
  return {
    files: testFiles,
    rules: {
      "@typescript-eslint/no-floating-promises": "off",
      "@typescript-eslint/no-magic-numbers": "off",
      "max-lines-per-function": "off",
      "max-nested-callbacks": "off",
      "sonarjs/no-duplicate-string": "off",
    },
  };
}

/**
 * Builds the shared ESLint flat config, meant for code written by AI agents. It enables only rules that catch
 * bugs, dead code, excessive complexity or unclear names, turns off every formatting rule of the plugins it uses,
 * reports everything as an error and forbids silencing rules with comments.
 * @param {EslintConfigOptions} [options] - What the project uses.
 * @returns {FlatConfig[]} Flat config to export from `eslint.config.js`.
 */
export function createEslintConfig(options = {}) {
  /** @type {Required<EslintConfigOptions>} */
  const defaults = {
    tsconfigRootDir: process.cwd(),
    typeChecked: true,
    react: false,
    next: false,
    vitest: false,
    allowDisableComments: false,
    ignores: [],
    testFiles: TEST_FILE_GLOBS,
  };
  const { tsconfigRootDir, typeChecked, react, next, vitest, allowDisableComments, ignores, testFiles } = {
    ...defaults,
    ...options,
  };

  return promoteWarningsToErrors([
    { name: "golfo-lint/ignores", ignores: [...IGNORED_PATH_GLOBS, ...ignores] },
    // ESLint only lints extensions some config lists; without this, `.jsx` files would be skipped.
    { name: "golfo-lint/files", files: [...JAVASCRIPT_FILE_GLOBS, ...TYPESCRIPT_FILE_GLOBS] },
    eslintJs.configs.recommended,
    ...tseslint.configs.recommended,
    importX.flatConfigs.recommended,
    importX.flatConfigs.typescript,
    promisePlugin.configs["flat/recommended"],
    regexpPlugin.configs["flat/recommended"],
    sonarjs.configs.recommended,
    // `unopinionated` leaves out unicorn's style preferences; only rules about behavior and APIs remain.
    unicorn.configs.unopinionated,
    ...(typeChecked ? createTypeCheckedConfigs(tsconfigRootDir) : []),
    ...createFrameworkConfigs({ react, next, vitest, testFiles }),
    {
      name: "golfo-lint/quality",
      languageOptions: { globals: { ...globals.node, ...globals.browser } },
      settings: { "import-x/resolver-next": [createTypeScriptImportResolver({ alwaysTryTypes: true })] },
      rules: { ...createCoreRules(), ...createPluginRules() },
    },
    ...(typeChecked ? [{ ...tseslint.configs.disableTypeChecked, files: JAVASCRIPT_FILE_GLOBS }] : []),
    ...(testFiles.length > 0 ? [{ name: "golfo-lint/tests", ...createTestFilesConfig(testFiles) }] : []),
    { name: "golfo-lint/config-files", files: CONFIG_FILE_GLOBS, rules: { "unicorn/no-top-level-side-effects": "off" } },
    createDirectiveCommentsConfig(allowDisableComments),
    { name: "golfo-lint/no-formatting", rules: turnOffRules(listFormattingRules(PLUGINS_BY_PREFIX)) },
  ]);
}
