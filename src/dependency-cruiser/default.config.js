/**
 * @module dependency-cruiser/default.config Config `golfo-lint architecture` uses when the project has no
 * dependency-cruiser config. It resolves `paths` aliases from the project's `tsconfig.json` when there is one.
 */
import { existsSync } from "node:fs";
import { createDependencyCruiserConfig } from "./create-dependency-cruiser-config.js";

/** TypeScript config of the analyzed project, relative to the folder dependency-cruiser runs in. */
const PROJECT_TSCONFIG_FILE = "tsconfig.json";

export default createDependencyCruiserConfig({
  tsConfigFileName: existsSync(PROJECT_TSCONFIG_FILE) ? PROJECT_TSCONFIG_FILE : undefined,
});
