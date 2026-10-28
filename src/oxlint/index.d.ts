/** What the project uses, to enable the matching rules; the same options as the ESLint preset. */
export interface OxlintConfigOptions {
  /**
   * Whether to run the rules that need type information, through tsgolint (default `true`). Each file uses the
   * `tsconfig.json` nearest to it: a folder of tests excluded from the root `tsconfig.json` needs its own.
   */
  typeAware?: boolean;
  /** Whether to enable the React hooks, JSX accessibility and unnecessary `useEffect` rules (default `false`). */
  react?: boolean;
  /** Whether to enable the Next.js rules, Core Web Vitals included (default `false`). */
  next?: boolean;
  /** Whether to enable the Vitest rules in test files (default `false`). */
  vitest?: boolean;
  /** Whether to enable SonarJS's AWS CDK rules (`sonarjs/aws-*`) (default `false`). */
  awsCdk?: boolean;
  /** Whether `eslint-disable` and `oxlint-disable` comments may silence a rule, with a description (default `false`). */
  allowDisableComments?: boolean;
  /** Extra globs to skip, besides dependencies and build output. */
  ignores?: string[];
  /** Globs of test files, which get relaxed limits. */
  testFiles?: string[];
}

/** oxlint config; see https://oxc.rs/docs/guide/usage/linter/config-file-reference. */
export interface OxlintConfig {
  options?: { typeAware?: boolean; [option: string]: unknown };
  jsPlugins?: (string | { name: string; specifier: string })[];
  rules?: Record<string, unknown>;
  overrides?: { files: string[]; jsPlugins?: (string | { name: string; specifier: string })[]; rules?: Record<string, unknown>; [key: string]: unknown }[];
  [key: string]: unknown;
}

/**
 * Builds the oxlint config of the preset: the rules of `createEslintConfig`, natively where oxlint implements them
 * (type-aware ones through tsgolint) and through the original ESLint plugins as JS plugins otherwise. Export it from
 * `oxlint.config.mjs` with `export default await createOxlintConfig({ ... })`.
 */
export function createOxlintConfig(options?: OxlintConfigOptions): Promise<OxlintConfig>;
