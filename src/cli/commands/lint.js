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

/** Flags that pick the config file `bun lint` reads. */
const CONFIG_FLAGS = new Set(["-c", "--config"]);

/**
 * Finds the ESLint config of the project.
 * @param {string} cwd - Project folder.
 * @returns {string | undefined} Its file name, or `undefined` when there is none.
 */
function findEslintConfig(cwd) {
  return ESLINT_CONFIG_FILES.find((fileName) => existsSync(path.join(cwd, fileName)));
}

/**
 * Picks the config `bun lint` must read: the one the caller passed, or else the project's ESLint config. `bun lint`
 * prefers an `.oxlintrc.json` over `eslint.config.js`, so without `--config` a leftover oxlint config would replace the
 * preset.
 * @param {string[]} toolArguments - Arguments the caller passed through.
 * @param {string} cwd - Project folder.
 * @returns {string[]} `--config` and the file, or nothing when the caller already chose one.
 */
function configArguments(toolArguments, cwd) {
  const configFile = findEslintConfig(cwd);
  return choosesConfig(toolArguments) || configFile === undefined ? [] : ["--config", configFile];
}

/**
 * Checks whether the caller picked the config file.
 * @param {string[]} toolArguments - Arguments the caller passed through.
 * @returns {boolean} Whether they include `-c`, `--config` or `--config=<file>`.
 */
function choosesConfig(toolArguments) {
  return toolArguments.some((argument) => CONFIG_FLAGS.has(argument) || argument.startsWith("--config="));
}

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
  skipReason: (cwd, toolArguments) =>
    choosesConfig(toolArguments) || findEslintConfig(cwd) !== undefined ? undefined : "el proyecto no tiene eslint.config",
  async run(context) {
    const reportDirectory = mkdtempSync(path.join(os.tmpdir(), "golfo-lint-bun-lint-"));
    const reportPath = path.join(reportDirectory, "report.json");
    try {
      const exitCode = await runExternalTool(context, {
        name: "bun lint",
        candidates: [{ command: "bun", prefixArguments: [] }],
        installHint: "Instalá Bun (https://bun.com): `bun lint` está en Bun canary (`bun upgrade --canary`) hasta 1.4.5.",
        arguments: [
          ...BUN_LINT_ARGUMENTS,
          ...configArguments(context.toolArguments, context.cwd),
          "--format",
          "json",
          "--output-file",
          reportPath,
          ...context.toolArguments,
        ],
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
      // Any other exit code means some rules did not run (`bun lint` exits with 2 when the config has a plugin rule
      // that needs types, and lints everything else), so a clean report is not a pass.
      const ranEveryRule = exitCode === EXIT_CODE_SUCCESS || exitCode === EXIT_CODE_PROBLEMS_FOUND;
      if (reported.length > 0) {
        context.warn(formatResults(reported, context.cwd));
      }
      if (!ranEveryRule) {
        context.warn(`golfo-lint: bun lint terminó con código ${exitCode}: algunas reglas no corrieron (ver arriba).`);
        return EXIT_CODE_TOOL_UNAVAILABLE;
      }
      if (reported.length === 0) {
        context.log("bun lint: sin problemas.");
        return EXIT_CODE_SUCCESS;
      }
      return EXIT_CODE_PROBLEMS_FOUND;
    } finally {
      rmSync(reportDirectory, { recursive: true, force: true });
    }
  },
};
