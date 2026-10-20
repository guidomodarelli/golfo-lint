import type { Config } from "stylelint";

/** BEM class names: PascalCase block, camelCase elements, kebab-case modifiers. */
export const BEM_CLASS_PATTERN: string;

export interface StylelintConfigOptions {
  /** Whether class names must follow {@link BEM_CLASS_PATTERN} (default `false`). */
  bem?: boolean;
  /** Extra globs to skip, besides dependencies and build output. */
  ignoreFiles?: string[];
}

/** Builds the shared Stylelint config: error-catching rules only; disable comments are ignored. */
export function createStylelintConfig(options?: StylelintConfigOptions): Config;
