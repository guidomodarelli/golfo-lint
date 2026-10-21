/** @module stylelint.config Checks this package's styles with its own config; fixtures are invalid on purpose. */
import { createStylelintConfig } from "./src/stylelint/index.js";

export default createStylelintConfig({ ignoreFiles: ["test/fixtures/**"] });
