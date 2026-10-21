// These ESLint plugins ship no types; only the parts the preset reads are declared.
declare module "eslint-plugin-promise" {
  import type { ESLint, Linter } from "eslint";

  const plugin: ESLint.Plugin & { configs: Record<"flat/recommended", Linter.Config> };
  export default plugin;
}


declare module "eslint-plugin-jsx-a11y-x" {
  import type { ESLint, Linter } from "eslint";

  const plugin: ESLint.Plugin & { configs: Record<"recommended" | "strict", Linter.Config> };
  export default plugin;
}

declare module "@eslint-community/eslint-plugin-eslint-comments" {
  import type { ESLint } from "eslint";

  const plugin: ESLint.Plugin;
  export default plugin;
}

declare module "eslint-plugin-react-you-might-not-need-an-effect" {
  import type { ESLint, Linter } from "eslint";

  const plugin: ESLint.Plugin & { configs: Record<"recommended" | "strict", Linter.Config> };
  export default plugin;
}
