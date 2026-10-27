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

/** Key that opens the list of steps of a job. */
const STEPS_KEY = "steps";

/** Value that opens a block scalar (`run: |`, `script: >-`), whose lines are text, not keys. */
const BLOCK_SCALAR_PATTERN = /^\s*[>|][+-]?\d?\s*(?:#.*)?$/u;

/**
 * Checks whether the rest of a `key:` line opens a block: nothing, or only a comment (`steps: # services`).
 * @param {string} rest - What follows the colon.
 * @returns {boolean} Whether the key has no value on its line.
 */
function opensBlock(rest) {
  const value = rest.trim();
  return value === "" || value.startsWith("#");
}

/**
 * @typedef {object} StepKeyLine
 * @property {number} index - Index of the line.
 * @property {number} stepIndex - Index of the line that opens its step, the one with `- `.
 * @property {{ indent: string; dash: string; key: string; rest: string }} parts - Parts of the line.
 */

/**
 * Lists the keys of steps: the keys of the list items under a `steps:` key, also the items of a `parallel:` group.
 * Keys of other lists, like the entries of `strategy.matrix.include`, are not steps.
 * @param {string[]} lines - Workflow lines.
 * @returns {StepKeyLine[]} Step keys, in order.
 */
function listStepKeyLines(lines) {
  /** @type {StepKeyLine[]} */
  const stepKeys = [];
  let stepsIndent = -1;
  let stepKeyIndent = -1;
  let stepIndex = -1;
  let blockScalarIndent = -1;
  lines.forEach((line, index) => {
    if (isBlankOrComment(line)) {
      return;
    }
    // The lines of a block scalar (a `run: |` script, maybe with a heredoc that writes YAML) are text.
    if (blockScalarIndent !== -1 && indentationOf(line) > blockScalarIndent) {
      return;
    }
    blockScalarIndent = -1;
    const groups = STEP_KEY_PATTERN.exec(line)?.groups;
    if (groups !== undefined && BLOCK_SCALAR_PATTERN.test(groups.rest)) {
      blockScalarIndent = groups.indent.length + (groups.dash ?? "").length;
    }
    // YAML lets the `-` of the steps sit at the same column as `steps:`; only a key there ends the list.
    const continuesIndentlessList = groups?.dash !== undefined && indentationOf(line) === stepsIndent;
    if (stepsIndent !== -1 && indentationOf(line) <= stepsIndent && !continuesIndentlessList) {
      stepsIndent = -1;
      stepKeyIndent = -1;
    }
    if (groups === undefined) {
      return;
    }
    if (groups.key === STEPS_KEY && groups.dash === undefined && opensBlock(groups.rest)) {
      stepsIndent = groups.indent.length;
      stepKeyIndent = -1;
      return;
    }
    if (stepsIndent === -1) {
      return;
    }
    const keyIndent = groups.indent.length + (groups.dash ?? "").length;
    if (groups.dash !== undefined) {
      stepKeyIndent = keyIndent;
      stepIndex = index;
    }
    if (keyIndent === stepKeyIndent) {
      stepKeys.push({
        index,
        stepIndex,
        parts: { indent: groups.indent, dash: groups.dash ?? "", key: groups.key, rest: groups.rest },
      });
    }
  });
  return stepKeys;
}

/**
 * Checks whether a key belongs to background steps.
 * @param {string} key - Step key.
 * @returns {boolean} Whether it is `background`, `wait`, `wait-all`, `cancel` or `parallel`.
 */
function isBackgroundStepKey(key) {
  return key === BACKGROUND_KEY || key === PARALLEL_KEY || SYNCHRONIZATION_KEYS.has(key);
}

/**
 * Checks whether a workflow uses background steps.
 * @param {string} text - Workflow source.
 * @returns {boolean} Whether some step uses `background`, `wait`, `wait-all`, `cancel` or `parallel`.
 */
export function usesBackgroundSteps(text) {
  return listStepKeyLines(text.split("\n")).some(({ parts }) => isBackgroundStepKey(parts.key));
}

/**
 * Moves the steps of every `parallel:` group to the level of the other steps.
 * @param {string[]} lines - Workflow lines, changed in place.
 * @param {Map<number, number>} columnShifts - Receives the columns each 1-based line moved.
 */
function flattenParallelGroups(lines, columnShifts) {
  for (const { index, parts } of listStepKeyLines(lines)) {
    if (parts.key !== PARALLEL_KEY || parts.dash === "" || !opensBlock(parts.rest)) {
      continue;
    }
    const itemIndent = parts.indent.length;
    lines[index] = `${parts.indent}# ${PARALLEL_KEY}:`;
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
  const stepKeys = listStepKeyLines(lines);
  for (const { index, stepIndex, parts } of stepKeys) {
    const keysOfStep = new Set(stepKeys.filter((stepKey) => stepKey.stepIndex === stepIndex).map(({ parts: { key } }) => key));
    rewriteStepKey(lines, index, parts, keysOfStep);
  }
}

/**
 * Keys that can stand in for `background: true` when it opens a step (`- background: true`), so the step stays a
 * mapping. Each one keeps the step running as before; the first one the step does not have is used, so the step
 * does not end up with a key twice.
 */
const BACKGROUND_PLACEHOLDER_KEYS = [
  ["name", "background"],
  ["continue-on-error", "false"],
  ["timeout-minutes", "360"],
  ["shell", "bash"],
];

/**
 * Rewrites one step key when it belongs to background steps; leaves any other key as it is.
 * @param {string[]} lines - Workflow lines, changed in place.
 * @param {number} index - Line of the key.
 * @param {{ indent: string; dash: string; key: string; rest: string }} parts - Parts of the line.
 * @param {Set<string>} keysOfStep - Keys the step already has.
 */
function rewriteStepKey(lines, index, { indent, dash, key, rest }, keysOfStep) {
  if (key === BACKGROUND_KEY) {
    // A comment right after `- ` would leave an empty step; a key the step does not have keeps it a mapping.
    const placeholder = BACKGROUND_PLACEHOLDER_KEYS.find(([placeholderKey]) => !keysOfStep.has(placeholderKey));
    lines[index] =
      dash === "" || placeholder === undefined
        ? `${indent}# ${key}:${rest}`
        : `${indent}${dash}${placeholder[0]}: ${placeholder[1]}`;
    return;
  }
  if (!SYNCHRONIZATION_KEYS.has(key)) {
    return;
  }
  lines[index] = `${indent}${dash}run: "true"`;
  // A `wait` list on the following lines (`- build`) would now hang from `run`: comment it out, also when its items
  // sit at the column of the key, which YAML allows.
  const keyColumn = indent.length + dash.length;
  for (const nested of [...listNestedLineIndexes(lines, index, keyColumn), ...listIndentlessItems(lines, index, keyColumn)]) {
    lines[nested] = `${" ".repeat(indentationOf(lines[nested]))}# ${lines[nested].trimStart()}`;
  }
}

/**
 * Lists the items of a sequence that sits at the column of the key it belongs to (`wait:` and then `- server` right
 * below the `w`), which YAML allows.
 * @param {string[]} lines - Workflow lines.
 * @param {number} keyIndex - Index of the line with the key.
 * @param {number} keyColumn - Column of the key.
 * @returns {number[]} Indexes of the items and their nested lines.
 */
function listIndentlessItems(lines, keyIndex, keyColumn) {
  /** @type {number[]} */
  const items = [];
  let index = keyIndex + 1;
  while (index < lines.length) {
    const line = lines[index];
    if (isBlankOrComment(line) || indentationOf(line) > keyColumn) {
      index += 1;
      continue;
    }
    if (indentationOf(line) !== keyColumn || !line.trimStart().startsWith("- ")) {
      break;
    }
    const nested = listNestedLineIndexes(lines, index, keyColumn);
    items.push(index, ...nested);
    index += 1 + nested.length;
  }
  return items.filter((itemIndex) => !isBlankOrComment(lines[itemIndex]));
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
