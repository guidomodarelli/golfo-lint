import type { Linter } from "eslint";

/** What the project uses, to enable the matching rules. */
export interface EslintConfigOptions {
  /** Folder that holds the root `tsconfig.json`; pass `import.meta.dirname`. Defaults to the current directory. */
  tsconfigRootDir?: string;
  /** Whether to enable rules that need type information (default `true`). */
  typeChecked?: boolean;
  /**
   * TypeScript configs that cover every linted file, such as `["tsconfig.json", "tsconfig.test.json"]`. Pass them
   * when the root `tsconfig.json` excludes tests. By default, `tsconfig.json` and `tsconfig.test.json` when the second
   * exists; otherwise, or with `[]`, the typescript-eslint project service finds each file's config.
   */
  tsconfigFiles?: string[];
  /** Whether to enable the React hooks, JSX accessibility and unnecessary `useEffect` rules (default `false`). */
  react?: boolean;
  /** Whether to enable the Next.js rules, Core Web Vitals included (default `false`). */
  next?: boolean;
  /** Whether to enable the Vitest rules in test files (default `false`). */
  vitest?: boolean;
  /** Whether `eslint-disable` comments may silence a rule, with a description (default `false`). */
  allowDisableComments?: boolean;
  /** Extra globs to skip, besides dependencies and build output. */
  ignores?: string[];
  /** Globs of test files, which get relaxed limits. */
  testFiles?: string[];
}

/** Builds the shared ESLint flat config: quality rules only, never formatting rules. */
export function createEslintConfig(options?: EslintConfigOptions): Linter.Config[];

/** Lists the formatting rules of some plugins: every rule typed `layout` plus {@link STYLISTIC_SUGGESTION_RULES}. */
export function listFormattingRules(
  pluginsByPrefix: Record<string, { rules?: Record<string, { meta?: { type?: string } }> }>,
): string[];

/** Rules not typed `layout` that only choose between equivalent spellings of the same code. */
export const STYLISTIC_SUGGESTION_RULES: string[];

/** Rules that report a problem another enabled rule already reports; the preset turns them off. */
export const DUPLICATED_RULES: string[];

/** Rules that report valid code (security hotspots, correct patterns they forbid); the preset turns them off. */
export const NON_DEFECT_RULES: string[];
