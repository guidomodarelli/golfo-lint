/**
 * @module eslint/create-eslint-config Builds the shared ESLint flat config: rules that catch bugs, dead code,
 * complexity and unclear names, and never rules about formatting.
 */
import process from "node:process";
import eslintJs from "@eslint/js";
import { createTypeScriptImportResolver } from "eslint-import-resolver-typescript";
import importX from "eslint-plugin-import-x";
import promisePlugin from "eslint-plugin-promise";
import reactHooks from "eslint-plugin-react-hooks";
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
  promise: promisePlugin,
  "react-hooks": reactHooks,
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
 * @property {boolean} [react] - Whether to enable the React hooks rules (default `false`).
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
    "object-shorthand": "error",
    "prefer-const": "error",
    "prefer-promise-reject-errors": "error",
    "prefer-template": "error",
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
    // `null` is part of React, JSON and SQL contracts.
    "unicorn/no-null": "off",
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
      "unicorn/no-useless-undefined": "off",
    },
  };
}

/**
 * Builds the shared ESLint flat config. It enables only rules that catch bugs, dead code, excessive complexity
 * or unclear names, and turns off every formatting rule of the plugins it uses, so it can sit next to any
 * formatter without conflicts.
 * @param {EslintConfigOptions} [options] - What the project uses.
 * @returns {FlatConfig[]} Flat config to export from `eslint.config.js`.
 */
export function createEslintConfig(options = {}) {
  /** @type {Required<EslintConfigOptions>} */
  const defaults = { tsconfigRootDir: process.cwd(), typeChecked: true, react: false, ignores: [], testFiles: TEST_FILE_GLOBS };
  const { tsconfigRootDir, typeChecked, react, ignores, testFiles } = { ...defaults, ...options };

  return [
    { name: "golfo-lint/ignores", ignores: [...IGNORED_PATH_GLOBS, ...ignores] },
    eslintJs.configs.recommended,
    ...tseslint.configs.recommended,
    importX.flatConfigs.recommended,
    importX.flatConfigs.typescript,
    promisePlugin.configs["flat/recommended"],
    regexpPlugin.configs["flat/recommended"],
    sonarjs.configs.recommended,
    unicorn.configs.recommended,
    ...(typeChecked ? createTypeCheckedConfigs(tsconfigRootDir) : []),
    ...(react ? [reactHooks.configs.flat.recommended] : []),
    {
      name: "golfo-lint/quality",
      languageOptions: { globals: { ...globals.node, ...globals.browser } },
      settings: { "import-x/resolver-next": [createTypeScriptImportResolver({ alwaysTryTypes: true })] },
      rules: { ...createCoreRules(), ...createPluginRules() },
    },
    ...(typeChecked ? [{ ...tseslint.configs.disableTypeChecked, files: JAVASCRIPT_FILE_GLOBS }] : []),
    ...(testFiles.length > 0 ? [{ name: "golfo-lint/tests", ...createTestFilesConfig(testFiles) }] : []),
    { name: "golfo-lint/config-files", files: CONFIG_FILE_GLOBS, rules: { "unicorn/no-top-level-side-effects": "off" } },
    { name: "golfo-lint/no-formatting", rules: turnOffRules(listFormattingRules(PLUGINS_BY_PREFIX)) },
  ];
}
