/**
 * @module cli/commands/lint Runs the ESLint preset with `bun lint`, which reads `eslint.config.js`, runs natively the
 * rules it implements (type-aware ones on TypeScript 7) and the rest through the ESLint plugins in JavaScript.
 * `bun lint` gives no types to plugin rules, so the preset's own `golfo-lint/no-unnecessary-condition` cannot run:
 * the preset turns on the native `@typescript-eslint/no-unnecessary-condition` instead, and this command drops its
 * reports that rest on types TypeScript cannot know.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createFileContextReader,
  isReliableConditionReport,
} from "../../bun-lint/unnecessary-condition-filter.js";
import { runExternalTool } from "../command-helpers.js";
import { EXIT_CODE_PROBLEMS_FOUND, EXIT_CODE_SUCCESS, EXIT_CODE_TOOL_UNAVAILABLE } from "../constants.js";

/** @typedef {import("../command-helpers.js").LintCommand} LintCommand */
/** @typedef {import("../../bun-lint/unnecessary-condition-filter.js").LintMessage} LintMessage */

/**
 * @typedef {object} LintResult
 * @property {string} filePath - Absolute path of the file.
 * @property {(LintMessage & { message: string; severity: number })[]} messages - Problems in the file.
 */

/** Files where a project keeps its ESLint flat config, which `bun lint` reads. */
const ESLINT_CONFIG_FILES = [
  "eslint.config.js",
  "eslint.config.mjs",
  "eslint.config.cjs",
  "eslint.config.ts",
  "eslint.config.mts",
  "eslint.config.cts",
];

/**
 * `bun lint` flags: type-aware rules on, and the project's own `lint` script skipped, since it usually runs this
 * command.
 */
const BUN_LINT_ARGUMENTS = ["lint", "--no-script", "--type-aware"];

/** Severity ESLint's JSON report gives errors. */
const ERROR_SEVERITY = 2;

/**
 * Reads the JSON report `bun lint` wrote.
 * @param {string} reportPath - Report file.
 * @returns {LintResult[] | undefined} Results, or `undefined` when `bun lint` did not write the report.
 */
function readLintReport(reportPath) {
  if (!existsSync(reportPath)) {
    return undefined;
  }
  return /** @type {LintResult[]} */ (JSON.parse(readFileSync(reportPath, "utf8")));
}

/**
 * Formats problems like ESLint: one section per file, sorted by line, and a count.
 * @param {LintResult[]} results - Results with the problems to show.
 * @param {string} cwd - Project folder, to show relative paths.
 * @returns {string} Report.
 */
function formatResults(results, cwd) {
  const sections = results.map((result) => {
    const lines = result.messages
      .toSorted((left, right) => left.line - right.line || left.column - right.column)
      .map((message) => {
        const severity = message.severity === ERROR_SEVERITY ? "error" : "warning";
        return `  ${message.line}:${message.column}  ${severity}  ${message.message}  ${message.ruleId ?? ""}`;
      });
    return [path.relative(cwd, result.filePath), ...lines].join("\n");
  });
  const count = results.reduce((total, result) => total + result.messages.length, 0);
  return [...sections, `${count} problema(s) de bun lint.`].join("\n\n");
}

/**
 * Drops, from every result, the reports of `@typescript-eslint/no-unnecessary-condition` that rest on types
 * TypeScript cannot know, and the results left without problems.
 * @param {LintResult[]} results - Results of `bun lint`.
 * @returns {LintResult[]} Results with the problems that stay.
 */
function filterResults(results) {
  const readFile = createFileContextReader((filePath) =>
    existsSync(filePath) ? readFileSync(filePath, "utf8") : undefined,
  );
  return results
    .map((result) => {
      const file = readFile(result.filePath);
      return {
        ...result,
        messages: result.messages.filter((message) => file === undefined || isReliableConditionReport(message, file)),
      };
    })
    .filter((result) => result.messages.length > 0);
}

/** @type {LintCommand} */
export const lintCommand = {
  description: "Bugs, código confuso, complejidad, nombres, accesibilidad, React, Next.js y tests (bun lint).",
  skipReason: (cwd) =>
    ESLINT_CONFIG_FILES.some((fileName) => existsSync(path.join(cwd, fileName)))
      ? undefined
      : "el proyecto no tiene eslint.config",
  async run(context) {
    const reportDirectory = mkdtempSync(path.join(os.tmpdir(), "golfo-lint-bun-lint-"));
    const reportPath = path.join(reportDirectory, "report.json");
    try {
      const exitCode = await runExternalTool(context, {
        name: "bun lint",
        candidates: [{ command: "bun", prefixArguments: [] }],
        installHint: "Instalá Bun (https://bun.com): `bun lint` está en Bun canary (`bun upgrade --canary`) hasta 1.4.5.",
        arguments: [...BUN_LINT_ARGUMENTS, "--format", "json", "--output-file", reportPath, ...context.toolArguments],
      });
      if (exitCode === EXIT_CODE_TOOL_UNAVAILABLE) {
        return exitCode;
      }
      const results = readLintReport(reportPath);
      if (results === undefined) {
        context.warn("golfo-lint: bun lint no pudo analizar el proyecto (no escribió el reporte).");
        return EXIT_CODE_TOOL_UNAVAILABLE;
      }
      const reported = filterResults(results);
      if (reported.length === 0) {
        context.log("bun lint: sin problemas.");
        return EXIT_CODE_SUCCESS;
      }
      context.warn(formatResults(reported, context.cwd));
      return EXIT_CODE_PROBLEMS_FOUND;
    } finally {
      rmSync(reportDirectory, { recursive: true, force: true });
    }
  },
};
