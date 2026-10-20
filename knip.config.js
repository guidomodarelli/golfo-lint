/** @module knip.config Checks this package with its own knip defaults. */
import { createKnipConfig } from "./src/knip/index.js";

export default createKnipConfig({
  // Projects analyzed by the tests, with code that is unused or wrong on purpose.
  ignore: ["test/fixtures/**"],
  entry: [
    // Read by `golfo-rp create-version`, which knip has no plugin for.
    "golfo-rp.config.js",
    // Passed by path to Stylelint and dependency-cruiser when the analyzed project has no config of its own.
    "src/*/default.config.js",
  ],
  // The `golfo-lint` subcommands run these executables by path, which knip cannot follow.
  ignoreDependencies: ["jscpd", "dependency-cruiser", "publint", "@arethetypeswrong/cli", "sherif", "react-doctor"],
});
