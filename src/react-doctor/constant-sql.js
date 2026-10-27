/**
 * @module react-doctor/constant-sql Decides whether every `sql.raw(...)` of a file receives SQL fixed in the code:
 * a string literal, or a `const` that holds one (`sql.raw(EFFECT_SQL.begin)`), followed through the imports of the
 * project. A value whose origin cannot be proven, like a parameter, a call or a package import, counts as built at
 * run time.
 */
import path from "node:path";
import ts from "typescript";

/** Imports followed before giving up, so an import cycle cannot loop forever. */
const MAX_IMPORT_DEPTH = 4;

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
function parseModule(filePath, readSource) {
  const source = readSource(filePath);
  return source === undefined
    ? undefined
    : { filePath, sourceFile: ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true) };
}

/**
 * Removes the wrappers that do not change a value: parentheses, `as const`, `satisfies` and `!`.
 * @param {ts.Expression} expression - Expression to unwrap.
 * @returns {ts.Expression} The wrapped value.
 */
function unwrap(expression) {
  if (
    ts.isParenthesizedExpression(expression) ||
    ts.isAsExpression(expression) ||
    ts.isSatisfiesExpression(expression) ||
    ts.isNonNullExpression(expression)
  ) {
    return unwrap(expression.expression);
  }
  return expression;
}

/**
 * Resolves an import of a module to another module of the project.
 * @param {string} importerPath - Path of the importing module, relative to the project.
 * @param {string} specifier - Imported module: relative (`./x`) or under the `@/` alias.
 * @param {SourceReader} readSource - Reads files of the project.
 * @returns {ModuleContext | undefined} The imported module, or `undefined` for a package or a missing file.
 */
function resolveImport(importerPath, specifier, readSource) {
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
 * Checks whether a variable declaration list is `const`.
 * @param {ts.VariableDeclarationList} declarationList - Declaration list.
 * @param {ts.SourceFile} sourceFile - Module that holds it.
 * @returns {boolean} Whether its keyword is `const`.
 */
function isConstList(declarationList, sourceFile) {
  return declarationList.getFirstToken(sourceFile)?.kind === ts.SyntaxKind.ConstKeyword;
}

/**
 * Finds the value a module-level `const` holds, following the import that brings it from another module.
 * @param {string} name - Name of the constant in the module.
 * @param {ModuleContext} context - Module where the name is used.
 * @param {SourceReader} readSource - Reads files of the project.
 * @param {number} depth - Imports followed so far.
 * @returns {{ value: ts.Expression; context: ModuleContext } | undefined} Its initializer and module.
 */
function resolveConstant(name, context, readSource, depth) {
  for (const statement of context.sourceFile.statements) {
    if (ts.isVariableStatement(statement) && isConstList(statement.declarationList, context.sourceFile)) {
      const declaration = statement.declarationList.declarations.find(
        (candidate) => ts.isIdentifier(candidate.name) && candidate.name.text === name,
      );
      if (declaration?.initializer !== undefined) {
        return { value: declaration.initializer, context };
      }
    }
    const importedName = depth < MAX_IMPORT_DEPTH ? findImportedName(statement, name) : undefined;
    if (importedName !== undefined && ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      const imported = resolveImport(context.filePath, statement.moduleSpecifier.text, readSource);
      return imported === undefined ? undefined : resolveConstant(importedName, imported, readSource, depth + 1);
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
function findImportedName(statement, localName) {
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
 * Checks whether an expression is SQL fixed in the code: a string literal without interpolation, a constant that
 * holds one, or a property of a constant object whose value is one.
 * @param {ts.Expression} expression - Argument of `sql.raw`, or a value it points to.
 * @param {ModuleContext} context - Module of the expression.
 * @param {SourceReader} readSource - Reads files of the project.
 * @param {number} depth - Imports followed so far.
 * @returns {boolean} Whether its value is proven to be a literal.
 */
function isConstantSql(expression, context, readSource, depth) {
  const value = unwrap(expression);
  if (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)) {
    return true;
  }
  if (ts.isIdentifier(value)) {
    const constant = resolveConstant(value.text, context, readSource, depth);
    return constant !== undefined && isConstantSql(constant.value, constant.context, readSource, depth + 1);
  }
  if (ts.isPropertyAccessExpression(value) && ts.isIdentifier(value.expression)) {
    const constant = resolveConstant(value.expression.text, context, readSource, depth);
    const objectValue = constant === undefined ? undefined : unwrap(constant.value);
    if (constant === undefined || objectValue === undefined || !ts.isObjectLiteralExpression(objectValue)) {
      return false;
    }
    const property = objectValue.properties.find(
      (candidate) => ts.isPropertyAssignment(candidate) && candidate.name.getText(constant.context.sourceFile) === value.name.text,
    );
    return (
      property !== undefined &&
      ts.isPropertyAssignment(property) &&
      isConstantSql(property.initializer, constant.context, readSource, depth + 1)
    );
  }
  return false;
}

/**
 * Lists the `sql.raw(...)` calls of a module.
 * @param {ts.SourceFile} sourceFile - Parsed module.
 * @returns {ts.CallExpression[]} The calls.
 */
function listRawSqlCalls(sourceFile) {
  /** @type {ts.CallExpression[]} */
  const calls = [];
  /** @param {ts.Node} node - Node to visit. */
  const visit = (node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "raw" &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === "sql"
    ) {
      calls.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return calls;
}

/**
 * Checks whether every `sql.raw(...)` of a file receives SQL fixed in the code.
 * @param {string} filePath - Path of the file, relative to the project.
 * @param {SourceReader} readSource - Reads files of the project.
 * @returns {boolean} Whether the file has `sql.raw` calls and none takes a value built at run time.
 */
export function usesOnlyConstantRawSql(filePath, readSource) {
  const context = parseModule(filePath, readSource);
  if (context === undefined) {
    return false;
  }
  const calls = listRawSqlCalls(context.sourceFile);
  return (
    calls.length > 0 &&
    calls.every((call) => call.arguments.length === 1 && isConstantSql(call.arguments[0], context, readSource, 0))
  );
}
