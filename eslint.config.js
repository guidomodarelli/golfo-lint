/** @module eslint.config Lints this package with its own preset. */
import { createEslintConfig } from "./src/eslint/index.js";

export default createEslintConfig({ tsconfigRootDir: import.meta.dirname, ignores: ["test/fixtures/**"] });
