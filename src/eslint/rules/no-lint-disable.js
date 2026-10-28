/**
 * @module eslint/rules/no-lint-disable Reports the comments that silence or reconfigure lint rules, in the spellings
 * ESLint and oxlint both honor (`eslint-disable-next-line`, `oxlint-disable`, `/* eslint eqeqeq: "off" *\/`). An agent
 * has to fix the reported code instead.
 */

/**
 * Directive that turns rules off or back on, at the start of any comment: `eslint-disable`, `-line`, `-next-line` and
 * `-enable`, the same with `oxlint`.
 */
const DISABLE_DIRECTIVE_PATTERN = /^\s*(?:es|ox)lint-(?:disable(?:-next-line|-line)?|enable)(?:\s|$)/u;

/**
 * Inline rule config, which ESLint reads only from block comments: `eslint` or `oxlint`, then a rule name and a colon
 * (`/* eslint eqeqeq: "off" *\/`). A line comment that starts with the word, such as `// eslint reports this import`,
 * is prose.
 */
const INLINE_CONFIG_PATTERN = /^\s*(?:es|ox)lint\s+[@\w/-]+\s*:/u;

/**
 * Checks whether a comment is a lint directive rather than prose.
 * @param {ReturnType<import("eslint").SourceCode["getAllComments"]>[number]} comment - Comment of the file.
 * @returns {boolean} Whether it disables, enables or reconfigures rules.
 */
function isLintDirective(comment) {
  return (
    DISABLE_DIRECTIVE_PATTERN.test(comment.value) ||
    (comment.type === "Block" && INLINE_CONFIG_PATTERN.test(comment.value))
  );
}

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
      if (isLintDirective(comment) && comment.loc) {
        context.report({ loc: comment.loc, messageId: "lintDirective" });
      }
    }
    return {};
  },
};
