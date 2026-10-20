/**
 * @module shared/expand-braces Expands brace alternatives in a glob (`*.{js,ts}` into `*.js` and `*.ts`), for
 * tools that take globs as a comma-separated list and would split the braces apart.
 */

/** First brace group without nested braces: the text before, the alternatives and the text after. */
const BRACE_GROUP_PATTERN = /^(?<prefix>[^{]*)\{(?<alternatives>[^{}]*)\}(?<suffix>.*)$/u;

/**
 * Expands every brace group of a glob into separate globs.
 * @param {string} glob - Glob that may contain `{a,b}` groups.
 * @returns {string[]} Globs without braces, in order.
 */
export function expandBraces(glob) {
  const match = BRACE_GROUP_PATTERN.exec(glob);
  if (match?.groups === undefined) {
    return [glob];
  }
  const { prefix, alternatives, suffix } = match.groups;
  return alternatives.split(",").flatMap((alternative) => expandBraces(`${prefix}${alternative}${suffix}`));
}
