import type { Linter } from "eslint";

/** What the project uses, to enable the matching rules. */
export interface EslintConfigOptions {
  /** Folder that holds the root `tsconfig.json`; pass `import.meta.dirname`. Defaults to the current directory. */
  tsconfigRootDir?: string;
  /** Whether to enable rules that need type information (default `true`). */
  typeChecked?: boolean;
  /** Whether to enable the React hooks rules (default `false`). */
  react?: boolean;
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
