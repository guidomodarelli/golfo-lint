/**
 * @module cli/react-scan/format-file-diff Shows what a setup command changed in a file, as a unified diff, so the
 * person or agent that ran it can review the change before committing it.
 */

/** Unchanged lines shown around each change. */
const CONTEXT_LINES = 3;

/** Header path of a file that did not exist before. */
const MISSING_FILE_PATH = "/dev/null";

/**
 * @typedef {object} DiffLine
 * @property {" " | "-" | "+"} marker - Kept, removed or added.
 * @property {string} text - Line content.
 */

/**
 * Splits a file into lines, without the empty line after the final newline.
 * @param {string | undefined} content - File content, or `undefined` when it does not exist.
 * @returns {string[]} Lines.
 */
function splitLines(content) {
  if (content === undefined || content === "") {
    return [];
  }
  const lines = content.split(/\r?\n/u);
  return lines.at(-1) === "" ? lines.slice(0, -1) : lines;
}

/**
 * Lines of the longest common subsequence that start at each position of both files, for {@link diffLines}.
 * @param {string[]} beforeLines - Old lines.
 * @param {string[]} afterLines - New lines.
 * @returns {number[][]} `table[i][j]`: common lines between `beforeLines.slice(i)` and `afterLines.slice(j)`.
 */
function commonSubsequenceTable(beforeLines, afterLines) {
  const table = Array.from({ length: beforeLines.length + 1 }, () => Array.from({ length: afterLines.length + 1 }, () => 0));
  for (let i = beforeLines.length - 1; i >= 0; i -= 1) {
    for (let j = afterLines.length - 1; j >= 0; j -= 1) {
      table[i][j] =
        beforeLines[i] === afterLines[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  return table;
}

/**
 * Compares two files line by line.
 * @param {string[]} beforeLines - Old lines.
 * @param {string[]} afterLines - New lines.
 * @returns {DiffLine[]} Every line, marked as kept, removed or added.
 */
function diffLines(beforeLines, afterLines) {
  const table = commonSubsequenceTable(beforeLines, afterLines);
  /** @type {DiffLine[]} */
  const lines = [];
  let i = 0;
  let j = 0;
  while (i < beforeLines.length || j < afterLines.length) {
    if (i < beforeLines.length && j < afterLines.length && beforeLines[i] === afterLines[j]) {
      lines.push({ marker: " ", text: beforeLines[i] });
      i += 1;
      j += 1;
    } else if (j < afterLines.length && (i === beforeLines.length || table[i][j + 1] >= table[i + 1][j])) {
      lines.push({ marker: "+", text: afterLines[j] });
      j += 1;
    } else {
      lines.push({ marker: "-", text: beforeLines[i] });
      i += 1;
    }
  }
  return lines;
}

/**
 * Groups the changed lines, with their context, into hunks.
 * @param {DiffLine[]} lines - Every line of the comparison.
 * @returns {{ start: number; end: number }[]} Index ranges of `lines`, end excluded.
 */
function hunkRanges(lines) {
  /** @type {{ start: number; end: number }[]} */
  const ranges = [];
  for (const [index, line] of lines.entries()) {
    if (line.marker === " ") {
      continue;
    }
    const start = Math.max(0, index - CONTEXT_LINES);
    const end = Math.min(lines.length, index + CONTEXT_LINES + 1);
    const previous = ranges.at(-1);
    if (previous !== undefined && start <= previous.end) {
      previous.end = end;
    } else {
      ranges.push({ start, end });
    }
  }
  return ranges;
}

/**
 * Formats one hunk with its `@@` header.
 * @param {DiffLine[]} lines - Every line of the comparison.
 * @param {{ start: number; end: number }} range - Lines of the hunk.
 * @returns {string[]} Header and lines.
 */
function formatHunk(lines, range) {
  const before = lines.slice(0, range.start);
  const hunk = lines.slice(range.start, range.end);
  const beforeStart = before.filter((line) => line.marker !== "+").length + 1;
  const afterStart = before.filter((line) => line.marker !== "-").length + 1;
  const beforeCount = hunk.filter((line) => line.marker !== "+").length;
  const afterCount = hunk.filter((line) => line.marker !== "-").length;
  return [
    `@@ -${String(beforeCount === 0 ? beforeStart - 1 : beforeStart)},${String(beforeCount)} +${String(afterStart)},${String(afterCount)} @@`,
    ...hunk.map((line) => `${line.marker}${line.text}`),
  ];
}

/**
 * Formats the change to a file as a unified diff.
 * @param {string} relativePath - File path relative to the project, for the header.
 * @param {string | undefined} before - Old content, or `undefined` when the file is new.
 * @param {string} after - New content.
 * @returns {string} Unified diff, empty when nothing changed.
 */
export function formatFileDiff(relativePath, before, after) {
  const lines = diffLines(splitLines(before), splitLines(after));
  const ranges = hunkRanges(lines);
  if (ranges.length === 0) {
    return "";
  }
  const oldPath = before === undefined ? MISSING_FILE_PATH : `a/${relativePath}`;
  return [
    `--- ${oldPath}`,
    `+++ b/${relativePath}`,
    ...ranges.flatMap((range) => formatHunk(lines, range)),
  ].join("\n");
}
