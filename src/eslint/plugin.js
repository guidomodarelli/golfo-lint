/**
 * @module eslint/plugin The preset's own ESLint plugin. oxlint loads it as a JS plugin, so it is a module of its own
 * that `@golfo/lint/oxlint` can point to.
 */
import { noLintDisable } from "./rules/no-lint-disable.js";
import { noUnnecessaryCondition } from "./rules/no-unnecessary-condition.js";

export default {
  meta: { name: "eslint-plugin-golfo-lint" },
  rules: { "no-lint-disable": noLintDisable, "no-unnecessary-condition": noUnnecessaryCondition },
};
