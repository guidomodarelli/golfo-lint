import assert from "node:assert/strict";
import { describe, it } from "node:test";
import ts from "typescript";
import {
  isReliableConditionReport,
  UNNECESSARY_CONDITION_RULE,
} from "../../src/bun-lint/unnecessary-condition-filter.js";

/**
 * Parses a snippet as the file of a report.
 * @param {string} source - TypeScript code.
 * @param {boolean} [checksIndexedAccess] - Whether `noUncheckedIndexedAccess` is on.
 * @returns {import("../../src/bun-lint/unnecessary-condition-filter.js").FileContext} File context.
 */
function parse(source, checksIndexedAccess = false) {
  return { sourceFile: ts.createSourceFile("snippet.ts", source, ts.ScriptTarget.Latest, true), checksIndexedAccess };
}

/**
 * Builds the report `bun lint` gives for a snippet of the code, at its last occurrence.
 * @param {string} source - TypeScript code.
 * @param {string} snippet - Reported text (`?.` for an optional chain), or a longer text with the reported part
 * between brackets.
 * @param {string} messageId - Message of the rule.
 * @param {string} [ruleId] - Rule that reported it.
 * @returns {import("../../src/bun-lint/unnecessary-condition-filter.js").LintMessage} Report.
 */
function reportAt(source, snippet, messageId, ruleId = UNNECESSARY_CONDITION_RULE) {
  // `[name]` marks the reported part inside a longer snippet: `if ([active])`.
  const open = snippet.indexOf("[");
  const close = snippet.indexOf("]");
  const marked = open !== -1 && close > open;
  const reported = marked ? snippet.slice(open + 1, close) : snippet;
  const plain = marked ? snippet.slice(0, open) + reported + snippet.slice(close + 1) : snippet;
  const start = source.lastIndexOf(plain) + (marked ? open : 0);
  const sourceFile = ts.createSourceFile("snippet.ts", source, ts.ScriptTarget.Latest, true);
  const from = sourceFile.getLineAndCharacterOfPosition(start);
  const to = sourceFile.getLineAndCharacterOfPosition(start + reported.length);
  return {
    ruleId,
    messageId,
    line: from.line + 1,
    column: from.character + 1,
    endLine: to.line + 1,
    endColumn: to.character + 1,
  };
}

describe("isReliableConditionReport", () => {
  it("descarta una propiedad que la función ya chequeó, porque un await puede cambiarla", () => {
    const source = [
      "export async function load(signal: AbortSignal): Promise<void> {",
      "  if (signal.aborted) return;",
      "  await fetch('/x');",
      "  if (signal.aborted) return;",
      "}",
    ].join("\n");
    assert.equal(isReliableConditionReport(reportAt(source, "signal.aborted", "alwaysFalsy"), parse(source)), false);
  });

  it("mantiene una condición sobre un valor que nadie achicó antes", () => {
    const source = "export function label(name: string): string {\n  return name ? name : 'anónimo';\n}";
    assert.equal(isReliableConditionReport(reportAt(source, "name ?", "alwaysTruthy"), parse(source)), true);
  });

  it("descarta un let que un cleanup reasigna y que se declaró con un literal", () => {
    const source = [
      "export function watch(read: () => Promise<void>): () => void {",
      "  let active = true;",
      "  void (async () => { await read(); if (active) console.info('listo'); })();",
      "  return () => { active = false; };",
      "}",
    ].join("\n");
    assert.equal(isReliableConditionReport(reportAt(source, "if ([active])", "alwaysTruthy"), parse(source)), false);
  });

  it("mantiene un let sin achicar que otra función lee, como un pool que asigna beforeAll", () => {
    const source = [
      "declare function connect(): { end(): void };",
      "let pool: { end(): void };",
      "export function setup(): void { pool = connect(); }",
      "export function teardown(): void { if (!pool) return; pool.end(); }",
    ].join("\n");
    assert.equal(isReliableConditionReport(reportAt(source, "!pool", "alwaysFalsy"), parse(source)), true);
  });

  it("mantiene un let que se volvió a asignar con un valor de su tipo después del chequeo", () => {
    const source = [
      "declare function read(): Promise<{ id: string }>;",
      "export async function poll(): Promise<void> {",
      "  let snapshot = await read();",
      "  if (!snapshot) throw new Error('falta');",
      "  snapshot = await read();",
      "  if (!snapshot) throw new Error('falta');",
      "}",
    ].join("\n");
    assert.equal(isReliableConditionReport(reportAt(source, "!snapshot", "alwaysFalsy"), parse(source)), true);
  });

  it("descarta el chequeo de una API del entorno, que puede faltar", () => {
    const source = "export const newId = (): string | undefined => globalThis.crypto?.randomUUID();";
    assert.equal(isReliableConditionReport(reportAt(source, "?.", "neverOptionalChain"), parse(source)), false);
  });

  it("sin noUncheckedIndexedAccess descarta el chequeo de un elemento leído por índice, y con la opción lo mantiene", () => {
    const source = "export function first(items: string[]): string {\n  const head = items[0];\n  return head ?? '';\n}";
    const report = reportAt(source, "head", "neverNullish");
    assert.equal(isReliableConditionReport(report, parse(source)), false);
    assert.equal(isReliableConditionReport(report, parse(source, true)), true);
  });

  it("no toca los reportes de otras reglas", () => {
    const source = "export const total = 1;";
    assert.equal(isReliableConditionReport(reportAt(source, "total", "x", "eqeqeq"), parse(source)), true);
  });
});
