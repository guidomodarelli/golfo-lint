/**
 * @module workflows/background-steps Makes workflows that use the background steps of GitHub Actions (`background`,
 * `wait`, `wait-all`, `cancel` and `parallel`, June 2026) readable by actionlint, which does not know them yet and
 * reports every such step as a syntax error. The rewrite keeps every line in place so actionlint's line numbers
 * stay valid:
 *
 * - `background: true` becomes a comment: the step still runs its `run` or `uses`.
 * - `wait`, `wait-all` and `cancel` steps become `run: "true"`, the closest step that does nothing.
 * - `parallel:` becomes a comment and its steps move left to the level of the other steps, so actionlint checks
 *   them; their columns are shifted back in the report.
 */

/** Step keys that only synchronize with background steps, without running anything. */
const SYNCHRONIZATION_KEYS = new Set(["wait", "wait-all", "cancel"]);

/** Step key that runs a step in the background. */
const BACKGROUND_KEY = "background";

/** Step key that groups steps to run at the same time. */
const PARALLEL_KEY = "parallel";

/** A step key, possibly opening a list item: indentation, `- ` when present, key and the rest of the line. */
const STEP_KEY_PATTERN = /^(?<indent> *)(?<dash>- +)?(?<key>[\w-]+):(?<rest>.*)$/u;

/**
 * @typedef {object} RewrittenWorkflow
 * @property {string} text - Workflow that actionlint can parse.
 * @property {Map<number, number>} columnShifts - Columns each 1-based line moved to the left.
 */

/**
 * Counts the spaces that indent a line.
 * @param {string} line - Line of the workflow.
 * @returns {number} Leading spaces.
 */
function indentationOf(line) {
  return line.length - line.trimStart().length;
}

/**
 * Checks whether a line is blank or a comment, which never ends a block.
 * @param {string} line - Line of the workflow.
 * @returns {boolean} Whether it is.
 */
function isBlankOrComment(line) {
  const trimmed = line.trim();
  return trimmed === "" || trimmed.startsWith("#");
}

/**
 * Checks whether a workflow uses background steps.
 * @param {string} text - Workflow source.
 * @returns {boolean} Whether some step uses `background`, `wait`, `wait-all`, `cancel` or `parallel`.
 */
export function usesBackgroundSteps(text) {
  return text.split("\n").some((line) => {
    const key = STEP_KEY_PATTERN.exec(line)?.groups?.key;
    return key !== undefined && (key === BACKGROUND_KEY || key === PARALLEL_KEY || SYNCHRONIZATION_KEYS.has(key));
  });
}

/**
 * Moves the steps of every `parallel:` group to the level of the other steps.
 * @param {string[]} lines - Workflow lines, changed in place.
 * @param {Map<number, number>} columnShifts - Receives the columns each 1-based line moved.
 */
function flattenParallelGroups(lines, columnShifts) {
  for (let index = 0; index < lines.length; index += 1) {
    const match = STEP_KEY_PATTERN.exec(lines[index]);
    if (match?.groups?.key !== PARALLEL_KEY || match.groups.dash === undefined || match.groups.rest.trim() !== "") {
      continue;
    }
    const itemIndent = match.groups.indent.length;
    lines[index] = `${match.groups.indent}# ${PARALLEL_KEY}:`;
    const firstNested = lines.findIndex((line, lineIndex) => lineIndex > index && !isBlankOrComment(line));
    const shift = firstNested === -1 ? 0 : indentationOf(lines[firstNested]) - itemIndent;
    for (const nested of listNestedLineIndexes(lines, index, itemIndent)) {
      if (shift > 0 && indentationOf(lines[nested]) >= shift) {
        lines[nested] = lines[nested].slice(shift);
        columnShifts.set(nested + 1, shift);
      }
    }
  }
}

/**
 * Lists the lines that belong to the block opened at a line: the ones after it until the first one indented as
 * much as the block or less.
 * @param {string[]} lines - Workflow lines.
 * @param {number} openingIndex - Index of the line that opens the block.
 * @param {number} blockIndent - Indentation of the line that opens the block.
 * @returns {number[]} Indexes of the nested lines.
 */
function listNestedLineIndexes(lines, openingIndex, blockIndent) {
  const end = lines.findIndex(
    (line, index) => index > openingIndex && !isBlankOrComment(line) && indentationOf(line) <= blockIndent,
  );
  const stop = end === -1 ? lines.length : end;
  return Array.from({ length: stop - openingIndex - 1 }, (_, offset) => openingIndex + 1 + offset);
}

/**
 * Rewrites the keys of background steps that actionlint does not know.
 * @param {string[]} lines - Workflow lines, changed in place.
 */
function rewriteBackgroundKeys(lines) {
  let stepKeyIndent = -1;
  for (let index = 0; index < lines.length; index += 1) {
    const groups = STEP_KEY_PATTERN.exec(lines[index])?.groups;
    if (groups === undefined) {
      continue;
    }
    const keyIndent = groups.indent.length + (groups.dash ?? "").length;
    if (groups.dash !== undefined) {
      stepKeyIndent = keyIndent;
    }
    if (keyIndent === stepKeyIndent) {
      rewriteStepKey(lines, index, {
        indent: groups.indent,
        dash: groups.dash ?? "",
        key: groups.key,
        rest: groups.rest,
      });
    }
  }
}

/**
 * Rewrites one step key when it belongs to background steps; leaves any other key as it is.
 * @param {string[]} lines - Workflow lines, changed in place.
 * @param {number} index - Line of the key.
 * @param {{ indent: string; dash: string; key: string; rest: string }} parts - Parts of the line.
 */
function rewriteStepKey(lines, index, { indent, dash, key, rest }) {
  if (key === BACKGROUND_KEY) {
    // A comment right after `- ` would leave an empty step; a name keeps the step a mapping.
    lines[index] = dash === "" ? `${indent}# ${key}:${rest}` : `${indent}${dash}name: ${key}`;
    return;
  }
  if (!SYNCHRONIZATION_KEYS.has(key)) {
    return;
  }
  lines[index] = `${indent}${dash}run: "true"`;
  // A `wait` list on the following lines (`- build`) would now hang from `run`: comment it out.
  for (const nested of listNestedLineIndexes(lines, index, indent.length + dash.length)) {
    lines[nested] = `${" ".repeat(indentationOf(lines[nested]))}# ${lines[nested].trimStart()}`;
  }
}

/**
 * Rewrites the background steps of a workflow into steps actionlint can check, keeping every line in place.
 * @param {string} text - Workflow source.
 * @returns {RewrittenWorkflow} Rewritten workflow and the column shift of each moved line.
 */
export function rewriteBackgroundSteps(text) {
  const lines = text.split("\n");
  /** @type {Map<number, number>} */
  const columnShifts = new Map();
  flattenParallelGroups(lines, columnShifts);
  rewriteBackgroundKeys(lines);
  return { text: lines.join("\n"), columnShifts };
}
