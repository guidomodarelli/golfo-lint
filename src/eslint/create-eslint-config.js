/**
 * @module eslint/create-eslint-config Builds the shared ESLint flat config: rules that catch bugs, dead code,
 * complexity and unclear names, and never rules about formatting.
 */
import { existsSync } from "node:fs";
import path from "node:path";
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
  MAX_FUNCTION_LINES,
  MAX_FUNCTION_PARAMETERS,
  MAX_NESTED_CALLBACKS,
  MAX_NESTING_DEPTH,
  TEST_FILE_GLOBS,
} from "../shared/thresholds.js";
import { DUPLICATED_RULES, listFormattingRules, NON_DEFECT_RULES, turnOffRules } from "./formatting-rules.js";
import { noUnnecessaryCondition } from "./rules/no-unnecessary-condition.js";


/**
 * SonarJS rules the preset enables, besides `sonarjs/cognitive-complexity`: the ones that found real defects on
 * TuTribu (200,000 lines). The rest of its `recommended` set found nothing there, repeated TypeScript or another
 * rule, or only chose a spelling; under oxlint each one runs as a JS rule and costs time on every file.
 */
const SONARJS_RULES = [
  "sonarjs/no-identical-functions",
  "sonarjs/super-linear-regex",
  "sonarjs/regex-complexity",
  "sonarjs/no-nested-assignment",
  "sonarjs/no-same-line-conditional",
  "sonarjs/no-unused-collection",
  "sonarjs/no-misleading-array-reverse",
  "sonarjs/no-globals-shadowing",
  "sonarjs/no-fixed-wait-in-tests",
];

/** Prefix of SonarJS's rules for AWS CDK infrastructure code (`sonarjs/aws-s3-bucket-public-access`, ...). */
const AWS_CDK_RULE_PREFIX = "aws-";
/** @typedef {import("eslint").Linter.Config} FlatConfig */

/** Files written in TypeScript, which get type-aware rules. */
const TYPESCRIPT_FILE_GLOBS = ["**/*.{ts,tsx,mts,cts}"];

/** Tool config files, whose job is the top-level side effect of exporting a computed config. */
const CONFIG_FILE_GLOBS = ["**/*.config.{js,mjs,cjs,ts,mts,cts}"];

/** Plugin with the rules golfo-lint writes itself, under the `golfo-lint/` prefix. */
const GOLFO_LINT_PLUGIN = { rules: { "no-unnecessary-condition": noUnnecessaryCondition } };

/** Root TypeScript config of a project. */
const ROOT_TSCONFIG_FILE = "tsconfig.json";

/** TypeScript config that the golfo projects keep for tests, which the root config excludes. */
const TEST_TSCONFIG_FILE = "tsconfig.test.json";

/** Files written in JavaScript, which cannot get type-aware rules. */
const JAVASCRIPT_FILE_GLOBS = ["**/*.{js,jsx,mjs,cjs}"];

/** Shortest identifier allowed, except for {@link SHORT_IDENTIFIER_EXCEPTIONS}. */
const MIN_IDENTIFIER_LENGTH = 2;

/** Loop counters and coordinates, the only single-letter names that read clearly. */
const SHORT_IDENTIFIER_EXCEPTIONS = ["i", "j", "k", "x", "y", "z", "_"];

/** Numbers that never need a name: neutral elements, the last index and halving. */
const ALLOWED_MAGIC_NUMBERS = [-1, 0, 1, 2];

/**
 * Abbreviations an agent must spell out, with the full words that replace them. The rule only expands: unicorn's
 * own defaults also abbreviate (`application` into `app`), so they stay off. Abbreviations that frameworks impose
 * (`props`, `params`, `ref`, `args`, `env`) and universal ones (`id`, `url`, `api`) are not listed.
 */
const ABBREVIATION_REPLACEMENTS = {
  acc: { accumulator: true },
  arr: { array: true },
  attr: { attribute: true },
  attrs: { attributes: true },
  btn: { button: true },
  cb: { callback: true },
  cfg: { config: true },
  cnt: { count: true },
  ctx: { context: true },
  cur: { current: true },
  curr: { current: true },
  dest: { destination: true },
  dst: { destination: true },
  e: { error: true, event: true },
  el: { element: true },
  elem: { element: true },
  err: { error: true },
  evt: { event: true },
  fn: { function: true },
  func: { function: true },
  idx: { index: true },
  len: { length: true },
  mgr: { manager: true },
  msg: { message: true },
  num: { number: true },
  obj: { object: true },
  opt: { option: true },
  opts: { options: true },
  pkg: { package: true },
  prev: { previous: true },
  prop: { property: true },
  qty: { quantity: true },
  repo: { repository: true },
  req: { request: true },
  res: { response: true, result: true },
  src: { source: true },
  str: { string: true },
  svc: { service: true },
  temp: { temporary: true },
  tmp: { temporary: true },
  val: { value: true },
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
 * @property {string[]} [tsconfigFiles] - TypeScript configs that cover every linted file, relative to
 * `tsconfigRootDir` (for example `["tsconfig.json", "tsconfig.test.json"]`). Pass them when the root
 * `tsconfig.json` excludes files such as tests: otherwise typescript-eslint builds one program per excluded file,
 * which turns minutes into hours. By default, `tsconfig.json` and `tsconfig.test.json` when the second exists, and
 * otherwise the typescript-eslint project service, which finds each file's config. `[]` forces the project service.
 * @property {boolean} [react] - Whether to enable the React hooks, JSX accessibility and unnecessary `useEffect`
 * rules (default `false`).
 * @property {boolean} [next] - Whether to enable the Next.js rules, Core Web Vitals included (default `false`).
 * @property {boolean} [vitest] - Whether to enable the Vitest rules in test files: no focused or skipped tests,
 * no tests without assertions (default `false`).
 * @property {boolean} [awsCdk] - Whether to enable SonarJS's AWS CDK rules (`sonarjs/aws-*`), which check
 * infrastructure written with `aws-cdk-lib` (default `false`: in other projects they cannot report anything, and
 * they take about a tenth of the lint time).
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
    // Function complexity is measured by `sonarjs/cognitive-complexity`, which counts what makes code hard to
    // read (nesting, breaks in the linear flow) and not each `case` of a flat `switch`; `complexity` would report
    // the same functions a second time.
    "default-case-last": "error",
    // `== null` matches `null` and `undefined` on purpose; every other loose comparison is reported.
    eqeqeq: ["error", "always", { null: "ignore" }],
    // One uppercase letter is a type parameter (`<T>`), the usual name for it; oxlint checks them, ESLint does not.
    "id-length": [
      "error",
      {
        min: MIN_IDENTIFIER_LENGTH,
        exceptions: SHORT_IDENTIFIER_EXCEPTIONS,
        exceptionPatterns: ["^[A-Z]$"],
        properties: "never",
      },
    ],
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
    // Inline `type` specifiers (`import { value, type Shape }`): merging a separate `import type { ... }` into an
    // import that already has them moved the values into the type-only import, which no longer compiles.
    "import-x/no-duplicates": ["error", { "prefer-inline": true }],
    "import-x/no-mutable-exports": "error",
    "import-x/no-self-import": "error",
    "import-x/no-useless-path-segments": "error",
    // TypeScript already reports unresolved imports and missing or wrong named, default and namespace members,
    // with better messages; these rules would repeat it and are the slowest of the preset.
    "import-x/default": "off",
    "import-x/named": "off",
    "import-x/namespace": "off",
    "import-x/no-named-as-default": "off",
    "import-x/no-named-as-default-member": "off",
    "import-x/no-unresolved": "off",
    // Cycles are checked for the whole repository by `golfo-lint architecture` (dependency-cruiser), much faster
    // than this rule does it file by file.
    "import-x/no-cycle": "off",
    "sonarjs/cognitive-complexity": ["error", MAX_COGNITIVE_COMPLEXITY],
    // Naming rules from unicorn's opinionated set: an agent that reads `error` and full words needs no guessing.
    "unicorn/catch-error-name": ["error", { name: "error" }],
    "unicorn/name-replacements": [
      "error",
      { extendDefaultReplacements: false, replacements: ABBREVIATION_REPLACEMENTS, checkFilenames: false },
    ],
  };
}

/**
 * Chooses the TypeScript configs for type-aware rules when the project does not name them: the root config plus
 * the test config, when there is one, so that tests do not each get their own program.
 * @param {string} tsconfigRootDir - Folder that holds the root `tsconfig.json`.
 * @returns {string[]} Configs to load, or none to let the project service find them.
 */
function detectTsconfigFiles(tsconfigRootDir) {
  const hasTestConfig = existsSync(path.join(tsconfigRootDir, TEST_TSCONFIG_FILE));
  return hasTestConfig && existsSync(path.join(tsconfigRootDir, ROOT_TSCONFIG_FILE))
    ? [ROOT_TSCONFIG_FILE, TEST_TSCONFIG_FILE]
    : [];
}

/**
 * Type-aware rules for TypeScript files, beyond `strictTypeChecked`.
 * @param {{ tsconfigRootDir: string; tsconfigFiles: string[] | undefined }} typescriptProject - Where the
 * TypeScript configs are, and which ones to load (`undefined`: detect them; none: the project service finds them).
 * @returns {FlatConfig[]} Config objects.
 */
function createTypeCheckedConfigs({ tsconfigRootDir, tsconfigFiles }) {
  const configFiles = tsconfigFiles ?? detectTsconfigFiles(tsconfigRootDir);
  const projectOptions = configFiles.length > 0 ? { project: configFiles } : { projectService: true };
  return [
    ...tseslint.configs.strictTypeChecked.map((config) => ({ ...config, files: TYPESCRIPT_FILE_GLOBS })),
    {
      files: TYPESCRIPT_FILE_GLOBS,
      languageOptions: { parserOptions: { ...projectOptions, tsconfigRootDir } },
      plugins: { "golfo-lint": GOLFO_LINT_PLUGIN },
      rules: {
        // Same rule without the reports that rest on narrowing TypeScript cannot keep (a property read again after
        // an `await`) or on array elements typed as always present: see `rules/no-unnecessary-condition.js`.
        "@typescript-eslint/no-unnecessary-condition": "off",
        "golfo-lint/no-unnecessary-condition": "error",
        // Sorting without a compare function orders numbers and objects as strings. Arrays of strings sort by code
        // unit on purpose (stable ids, canonical keys), where `localeCompare` would make the order depend on the locale.
        "@typescript-eslint/require-array-sort-compare": ["error", { ignoreStringArrays: true }],
        // The typed rule above knows the element type. Without types (JavaScript, `typeChecked: false`) the unicorn
        // rule stays and asks for a compare function in every sort, or `[2, 10].sort()` would pass.
        "unicorn/require-array-sort-compare": "off",
        // TypeScript and typed rules report these with the types: extra arguments are a compile error, and
        // comparisons that are always true or false go to `golfo-lint/no-unnecessary-condition`, which knows when the
        // types can be trusted; `@typescript-eslint/no-unnecessary-type-conversion` reports the same coercions.
        "unicorn/no-useless-coercion": "off",
        // `switch-exhaustiveness-check` asks for every member of a union, also the one that shares the `default`
        // branch (`case "forbidden": default:`); this rule asks to delete that case, so the two contradict.
        "unicorn/no-useless-switch-case": "off",
        // React ignores what an event handler returns, so `onClick={save}` with an async `save` is fine; promises
        // passed where a callback's result is used are still reported.
        "@typescript-eslint/no-misused-promises": ["error", { checksVoidReturn: { attributes: false } }],
        // Inline, like `import-x/no-duplicates`: the default fix turns `import { type A, B }` into
        // `import type { type A, B }`, which TypeScript rejects.
        "@typescript-eslint/consistent-type-imports": ["error", { fixStyle: "inline-type-imports" }],
        // `import { type A, type B }` keeps an empty side-effect import under `verbatimModuleSyntax`: when every
        // specifier is a type, `import type { A, B }`.
        "@typescript-eslint/no-import-type-side-effects": "error",
        "@typescript-eslint/prefer-optional-chain": "error",
        "@typescript-eslint/switch-exhaustiveness-check": "error",
        "@typescript-eslint/only-throw-error": "error",
        // `onClick={() => setOpen(true)}` returns nothing anyone reads; only longer bodies are confusing.
        "@typescript-eslint/no-confusing-void-expression": ["error", { ignoreArrowShorthand: true }],
        // A number in a template literal formats as expected; objects, `null` and `undefined` still fail.
        "@typescript-eslint/restrict-template-expressions": ["error", { allowNumber: true }],
        // Next.js requires `async` on Server Actions and lets Server Components be `async` without `await`.
        "@typescript-eslint/require-await": "off",
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
              // Vitest's `expect(value, message)` takes the message that explains a failure.
              "vitest/valid-expect": ["error", { maxArgs: 2 }],
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
      // Tests read untyped JSON bodies and use `expect.any()`, which are `any`, and assert values they just
      // checked with `!`: a wrong guess fails the test right there.
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/no-magic-numbers": "off",
      "max-lines-per-function": "off",
      "max-nested-callbacks": "off",
      // Helpers that build fixtures take every value of the case, and a test's branches follow the cases it lists.
      "@typescript-eslint/max-params": "off",
      "sonarjs/cognitive-complexity": "off",
      // `String(init?.body)` reads the body a test sent through a mocked `fetch`, typed as `BodyInit`.
      "@typescript-eslint/no-base-to-string": "off",
      // Tests rethrow what they caught, throw `null` to test how code handles it, and drop the `cause` of an error on
      // purpose so private data stays out of the test output.
      "@typescript-eslint/only-throw-error": "off",
      "preserve-caught-error": "off",
      // Playwright's `locator.innerText()` is not the DOM property.
      "unicorn/prefer-dom-node-text-content": "off",
      // Tests replace `window` and `navigator` properties to simulate the browser.
      "unicorn/no-global-object-property-assignment": "off",
    },
  };
}

/**
 * Turns rules on as errors.
 * @param {string[]} ruleNames - Fully qualified rule names.
 * @returns {Record<string, "error">} Rule entries.
 */
function turnOnRules(ruleNames) {
  return Object.fromEntries(ruleNames.map((ruleName) => [ruleName, "error"]));
}

/**
 * Lists SonarJS's AWS CDK rules, which only report code built with `aws-cdk-lib`.
 * @returns {string[]} Fully qualified rule names.
 */
function listAwsCdkRules() {
  return Object.keys(sonarjs.rules ?? {})
    .filter((ruleName) => ruleName.startsWith(AWS_CDK_RULE_PREFIX))
    .map((ruleName) => `sonarjs/${ruleName}`);
}

/**
 * Builds the shared ESLint flat config, meant for code written by AI agents. It enables only rules that catch
 * bugs, dead code, excessive complexity or unclear names, turns off every formatting rule of the plugins it uses,
 * reports everything as an error and forbids silencing rules with comments.
 * @param {EslintConfigOptions} [options] - What the project uses.
 * @returns {FlatConfig[]} Flat config to export from `eslint.config.js`.
 */
export function createEslintConfig(options = {}) {
  /** @type {Required<Omit<EslintConfigOptions, "tsconfigFiles">> & Pick<EslintConfigOptions, "tsconfigFiles">} */
  const defaults = {
    tsconfigRootDir: process.cwd(),
    typeChecked: true,
    tsconfigFiles: undefined,
    react: false,
    next: false,
    vitest: false,
    awsCdk: false,
    allowDisableComments: false,
    ignores: [],
    testFiles: TEST_FILE_GLOBS,
  };
  const {
    tsconfigRootDir,
    typeChecked,
    tsconfigFiles,
    react,
    next,
    vitest,
    awsCdk,
    allowDisableComments,
    ignores,
    testFiles,
  } = { ...defaults, ...options };

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
    {
      name: "golfo-lint/sonarjs",
      plugins: { sonarjs },
      rules: turnOnRules(awsCdk ? [...SONARJS_RULES, ...listAwsCdkRules()] : SONARJS_RULES),
    },
    // `unopinionated` leaves out unicorn's style preferences; only rules about behavior and APIs remain.
    unicorn.configs.unopinionated,
    ...(typeChecked ? createTypeCheckedConfigs({ tsconfigRootDir, tsconfigFiles }) : []),
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
    { name: "golfo-lint/no-duplicates", rules: turnOffRules(DUPLICATED_RULES) },
    { name: "golfo-lint/no-false-alarms", rules: turnOffRules(NON_DEFECT_RULES) },
  ]);
}
