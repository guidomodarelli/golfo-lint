/** @module knip.config Checks this package with its own knip defaults. */
import { createKnipConfig } from "./src/knip/index.js";

export default createKnipConfig({
  // Read by `golfo-rp create-version`, which knip has no plugin for.
  entry: ["golfo-rp.config.js"],
  // `golfo-lint duplicates` runs jscpd's executable by path, which knip cannot follow.
  ignoreDependencies: ["jscpd"],
});
