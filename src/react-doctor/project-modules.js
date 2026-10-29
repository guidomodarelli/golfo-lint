/**
 * @module react-doctor/project-modules Parses modules of the project and follows their imports, so the filters of
 * react-doctor findings can read the value or the type a name has in another module. Only relative imports and the
 * `@/` alias are followed: a package is not code of the project.
 */
import path from "node:path";
import ts from "typescript";

/** Extensions tried, in order, when an import omits it. */
const MODULE_SUFFIXES = ["", ".ts", ".tsx", ".mts", ".js", ".mjs", "/index.ts", "/index.tsx", "/index.js"];

/** Prefix of the `@/` alias that Next.js projects map to their root. */
const ROOT_ALIAS = "@/";

/**
 * Reads a file of the project.
 * @callback SourceReader
 * @param {string} filePath - Path relative to the project.
 * @returns {string | undefined} Its text, or `undefined` when it cannot be read.
 */

/**
 * @typedef {object} ModuleContext
 * @property {string} filePath - Path of the module, relative to the project.
 * @property {ts.SourceFile} sourceFile - Parsed module.
 */

/**
 * Parses a module of the project.
 * @param {string} filePath - Path relative to the project.
 * @param {SourceReader} readSource - Reads files of the project.
 * @returns {ModuleContext | undefined} Parsed module, or `undefined` when it cannot be read.
 */
export function parseModule(filePath, readSource) {
  const source = readSource(filePath);
  return source === undefined
    ? undefined
    : { filePath, sourceFile: ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true) };
}

/**
 * Resolves an import of a module to another module of the project.
 * @param {string} importerPath - Path of the importing module, relative to the project.
 * @param {string} specifier - Imported module: relative (`./x`) or under the `@/` alias.
 * @param {SourceReader} readSource - Reads files of the project.
 * @returns {ModuleContext | undefined} The imported module, or `undefined` for a package or a missing file.
 */
export function resolveImport(importerPath, specifier, readSource) {
  let basePath;
  if (specifier.startsWith(".")) {
    basePath = path.posix.join(path.posix.dirname(importerPath.replaceAll("\\", "/")), specifier);
  } else if (specifier.startsWith(ROOT_ALIAS)) {
    basePath = specifier.slice(ROOT_ALIAS.length);
  } else {
    return undefined;
  }
  for (const suffix of MODULE_SUFFIXES) {
    const parsed = parseModule(`${basePath}${suffix}`, readSource);
    if (parsed !== undefined) {
      return parsed;
    }
  }
  return undefined;
}

/**
 * Reads the exported name a module imports under a local name.
 * @param {ts.Statement} statement - Statement of the module.
 * @param {string} localName - Name used in the module.
 * @returns {string | undefined} Exported name (`A` in `import { A as B }`), or `undefined` when it does not import it.
 */
export function findImportedName(statement, localName) {
  if (!ts.isImportDeclaration(statement)) {
    return undefined;
  }
  const bindings = statement.importClause?.namedBindings;
  if (bindings === undefined || !ts.isNamedImports(bindings)) {
    return undefined;
  }
  const specifier = bindings.elements.find((element) => element.name.text === localName);
  return specifier === undefined ? undefined : (specifier.propertyName ?? specifier.name).text;
}

/**
 * Finds the module that a local name is imported from, inside the project.
 * @param {string} localName - Name used in the module.
 * @param {ModuleContext} context - Importing module.
 * @param {SourceReader} readSource - Reads files of the project.
 * @returns {{ name: string; context: ModuleContext } | undefined} The exported name and its module, or `undefined`
 * when the name is not imported or comes from a package.
 */
export function followImport(localName, context, readSource) {
  for (const statement of context.sourceFile.statements) {
    const importedName = findImportedName(statement, localName);
    if (importedName !== undefined && ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      const imported = resolveImport(context.filePath, statement.moduleSpecifier.text, readSource);
      return imported === undefined ? undefined : { name: importedName, context: imported };
    }
  }
  return undefined;
}

/**
 * Finds the node that starts at a position, as react-doctor reports it.
 * @param {ts.SourceFile} sourceFile - Parsed module.
 * @param {number} line - 1-based line.
 * @param {number} column - 1-based column.
 * @param {(node: ts.Node) => boolean} accepts - Kind of node wanted.
 * @returns {ts.Node | undefined} The innermost accepted node that starts there.
 */
function findNodeAt(sourceFile, line, column, accepts) {
  const lineStarts = sourceFile.getLineStarts();
  if (line < 1 || line > lineStarts.length) {
    return undefined;
  }
  const position = lineStarts[line - 1] + column - 1;
  /** @type {ts.Node | undefined} */
  let found;
  /** @param {ts.Node} node - Node to visit. */
  const visit = (node) => {
    if (node.getStart(sourceFile) <= position && position < node.end) {
      if (node.getStart(sourceFile) === position && accepts(node)) {
        found = node;
      }
      ts.forEachChild(node, visit);
    }
  };
  visit(sourceFile);
  return found;
}

/**
 * Parses a module and finds the call that a react-doctor finding points at.
 * @param {string} filePath - Path relative to the project.
 * @param {number} line - 1-based line of the finding.
 * @param {number} column - 1-based column of the finding.
 * @param {SourceReader} readSource - Reads files of the project.
 * @returns {{ context: ModuleContext; call: ts.CallExpression } | undefined} The module and the call, or `undefined`
 * when the file cannot be read or no call starts there.
 */
export function findCallAt(filePath, line, column, readSource) {
  const context = parseModule(filePath, readSource);
  const call = context === undefined ? undefined : findNodeAt(context.sourceFile, line, column, ts.isCallExpression);
  return context === undefined || call === undefined || !ts.isCallExpression(call) ? undefined : { context, call };
}
