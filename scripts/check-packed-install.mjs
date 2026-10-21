#!/usr/bin/env node
/**
 * @module scripts/check-packed-install Installs the packed `@golfo/lint` with pnpm, which only exposes declared
 * dependencies, in a throwaway consumer project, and checks that the ESLint preset, the shared configs and every
 * `golfo-lint` subcommand resolve their plugins and executables from the installed package.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

/** Root of this package. */
const PACKAGE_ROOT = fileURLToPath(new URL("..", import.meta.url));

/**
 * On Windows, npm and pnpm are `.cmd` shims that only run through a shell. Every argument here is a fixed literal
 * or a path this script created, so nothing reaches the shell unescaped from outside.
 */
const USES_SHELL = process.platform === "win32";

/** Exit code of a check that found problems. */
const EXIT_CODE_PROBLEMS_FOUND = 1;

/** Exit code of Stylelint when it finds problems. */
const STYLELINT_EXIT_CODE_PROBLEMS_FOUND = 2;

/** Exit code of `golfo-lint` when the tool it needs is not installed. */
const EXIT_CODE_TOOL_UNAVAILABLE = 3;

/** Characters of a failed command's output shown in the report: the end, where tools print the problems. */
const REPORTED_OUTPUT_CHARACTERS = 2000;

/** ESLint version the consumer installs, the same one this package is developed with. */
const CONSUMER_ESLINT_VERSION = "10.13.0";

/** Files of the consumer project: one bug per analysis, so each check proves its tool ran. */
const CONSUMER_FILES = {
  "eslint.config.js": [
    'import { createEslintConfig } from "@golfo/lint/eslint";',
    "",
    "export default createEslintConfig({ tsconfigRootDir: import.meta.dirname });",
    "",
  ].join("\n"),
  "tsconfig.json": JSON.stringify({
    compilerOptions: { strict: true, module: "nodenext", moduleResolution: "nodenext", target: "es2023", noEmit: true },
    include: ["src/**/*.ts"],
  }),
  "src/save-record.ts": [
    "type PersistRecord = (record: string) => Promise<void>;",
    "",
    "async function saveRecord(record: string, persist: PersistRecord): Promise<string> {",
    "  await persist(record);",
    "  return record;",
    "}",
    "",
    "export function storeRecord(record: string, persist: PersistRecord): void {",
    "  saveRecord(record, persist);",
    "}",
    "",
  ].join("\n"),
  "src/card.module.scss": ".Card {\n  margin: 0 !important;\n}\n",
  // pnpm 12 fails on unapproved install scripts; unrs-resolver's checks its native binary, as TuTribu approves it.
  "pnpm-workspace.yaml": "allowBuilds:\n  unrs-resolver: true\n",
};

/**
 * @typedef {object} CommandResult
 * @property {number} exitCode - Exit code of the command.
 * @property {string} output - Its standard output and error, together.
 */

/**
 * Runs a command and captures its output.
 * @param {string} command - Executable.
 * @param {string[]} commandArguments - Its arguments.
 * @param {string} cwd - Folder to run it in.
 * @returns {CommandResult} Exit code and output.
 */
function run(command, commandArguments, cwd) {
  const result = spawnSync(command, commandArguments, { cwd, encoding: "utf8", shell: USES_SHELL });
  return { exitCode: result.status ?? -1, output: `${result.stdout}${result.stderr}` };
}

/**
 * Packs this package into a folder.
 * @param {string} destination - Folder for the tarball.
 * @returns {string} Path of the tarball.
 */
function packPackage(destination) {
  const pack = run("npm", ["pack", "--pack-destination", destination, "--silent"], PACKAGE_ROOT);
  if (pack.exitCode !== 0) {
    throw new Error(`check-packed-install: npm pack falló (exit ${String(pack.exitCode)}):\n${pack.output}`);
  }
  const tarball = readdirSync(destination).find((fileName) => fileName.endsWith(".tgz"));
  if (tarball === undefined) {
    throw new Error(`check-packed-install: npm pack no dejó ningún .tgz en ${destination}.`);
  }
  return path.join(destination, tarball);
}

/**
 * Writes the consumer project and installs the tarball in it with pnpm.
 * @param {string} consumerDirectory - Folder of the consumer project.
 * @param {string} tarballPath - Packed `@golfo/lint`.
 */
function createConsumer(consumerDirectory, tarballPath) {
  const manifest = {
    name: "golfo-lint-consumer",
    version: "1.0.0",
    private: true,
    type: "module",
    // React is declared but react-doctor, an optional peer, is not installed.
    dependencies: { react: "19.0.0" },
    devDependencies: { "@golfo/lint": `file:${tarballPath}`, eslint: CONSUMER_ESLINT_VERSION },
  };
  writeFileSync(path.join(consumerDirectory, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  for (const [relativePath, content] of Object.entries(CONSUMER_FILES)) {
    mkdirSync(path.dirname(path.join(consumerDirectory, relativePath)), { recursive: true });
    writeFileSync(path.join(consumerDirectory, relativePath), content);
  }
  const install = run("pnpm", ["install", "--no-frozen-lockfile"], consumerDirectory);
  if (install.exitCode !== 0) {
    throw new Error(`check-packed-install: pnpm install falló (exit ${String(install.exitCode)}):\n${install.output}`);
  }
}

/**
 * @typedef {object} ExpectedResult
 * @property {string} label - What the check proves, for the report.
 * @property {string[]} commandArguments - Arguments for `pnpm exec`.
 * @property {number} exitCode - Exit code the command must return.
 * @property {string} [outputIncludes] - Text its output must contain.
 */

/** Checks run in the consumer project. */
const EXPECTED_RESULTS = /** @type {ExpectedResult[]} */ ([
  {
    label: "el preset de ESLint carga sus plugins y las reglas con tipos",
    commandArguments: ["eslint", "."],
    exitCode: EXIT_CODE_PROBLEMS_FOUND,
    outputIncludes: "@typescript-eslint/no-floating-promises",
  },
  {
    label: "golfo-lint styles usa la config compartida de Stylelint",
    commandArguments: ["golfo-lint", "styles"],
    exitCode: STYLELINT_EXIT_CODE_PROBLEMS_FOUND,
    outputIncludes: "declaration-no-important",
  },
  { label: "golfo-lint duplicates ejecuta jscpd", commandArguments: ["golfo-lint", "duplicates"], exitCode: 0 },
  { label: "golfo-lint architecture ejecuta dependency-cruiser", commandArguments: ["golfo-lint", "architecture"], exitCode: 0 },
  {
    label: "golfo-lint react pide instalar react-doctor, que es opcional",
    commandArguments: ["golfo-lint", "react"],
    exitCode: EXIT_CODE_TOOL_UNAVAILABLE,
    outputIncludes: "react-doctor@",
  },
  {
    label: "golfo-lint package no aplica a un paquete privado",
    commandArguments: ["golfo-lint", "package"],
    exitCode: 0,
    outputIncludes: "no aplica",
  },
]);

/**
 * Runs the checks and describes the ones that failed.
 * @param {string} consumerDirectory - Folder of the consumer project.
 * @returns {string[]} One message per failed check.
 */
function runChecks(consumerDirectory) {
  return EXPECTED_RESULTS.flatMap((expected) => {
    const result = run("pnpm", ["exec", ...expected.commandArguments], consumerDirectory);
    const outputMatches = expected.outputIncludes === undefined || result.output.includes(expected.outputIncludes);
    if (result.exitCode === expected.exitCode && outputMatches) {
      console.log(`ok: ${expected.label}`);
      return [];
    }
    const expectedOutput = expected.outputIncludes === undefined ? "" : ` con "${expected.outputIncludes}"`;
    const outputTail = result.output.slice(-REPORTED_OUTPUT_CHARACTERS);
    return [
      `${expected.label}: se esperaba exit ${String(expected.exitCode)}${expectedOutput}, ` +
        `salió ${String(result.exitCode)}:\n${outputTail}`,
    ];
  });
}

const workDirectory = mkdtempSync(path.join(tmpdir(), "golfo-lint-packed-"));
try {
  const consumerDirectory = path.join(workDirectory, "consumer");
  mkdirSync(consumerDirectory);
  createConsumer(consumerDirectory, packPackage(workDirectory));
  const failures = runChecks(consumerDirectory);
  if (failures.length > 0) {
    console.error(failures.join("\n\n"));
    process.exitCode = EXIT_CODE_PROBLEMS_FOUND;
  }
} finally {
  rmSync(workDirectory, { recursive: true, force: true });
}
