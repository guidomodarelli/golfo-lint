/**
 * @module eslint/rules/no-lint-disable Reports the comments that silence or reconfigure lint rules, in the spellings
 * ESLint and oxlint both honor (`eslint-disable-next-line`, `oxlint-disable`, `/* eslint eqeqeq: "off" *\/`). An agent
 * has to fix the reported code instead.
 */

/**
 * Directive at the start of a comment: `eslint-disable`, `-line`, `-next-line` and `-enable`, the same with `oxlint`,
 * and `eslint` or `oxlint` followed by inline rule config.
 */
const LINT_DIRECTIVE_PATTERN = /^\s*(?:es|ox)lint(?:-disable(?:-next-line|-line)?|-enable)?(?:\s|$)/u;

/** @type {import("eslint").Rule.RuleModule} */
export const noLintDisable = {
  meta: {
    type: "problem",
    docs: { description: "Disallow comments that disable or reconfigure ESLint and oxlint rules" },
    messages: {
      lintDirective: "Lint rules cannot be turned off with comments: fix the reported code instead.",
    },
    schema: [],
  },
  create(context) {
    for (const comment of context.sourceCode.getAllComments()) {
      if (LINT_DIRECTIVE_PATTERN.test(comment.value) && comment.loc) {
        context.report({ loc: comment.loc, messageId: "lintDirective" });
      }
    }
    return {};
  },
};
