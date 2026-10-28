/** @module eslint.config Lints this package with its own preset, through `bun lint`. */
import { createEslintConfig } from "./src/eslint/index.js";

export default createEslintConfig({ tsconfigRootDir: import.meta.dirname, linter: "bun", ignores: ["test/fixtures/**"] });
