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
 * Finds the binding a name has at a point of a module, from the innermost scope outwards: a parameter, a local
 * `const`, or nothing when only the module scope can hold it.
 * @param {ts.Identifier} identifier - Name at its point of use.
 * @param {string} name - Its text.
 * @returns {{ kind: "local"; value: ts.Expression } | { kind: "unknown" } | { kind: "module" }} `local` with the
 * initializer of a local `const`, `unknown` for a parameter or any other local binding, `module` otherwise.
 */
function resolveLocalBinding(identifier, name) {
  let scope = identifier.parent;
  while (!ts.isSourceFile(scope)) {
    const binding = findBindingInScope(scope, name);
    if (binding !== undefined) {
      return binding;
    }
    scope = scope.parent;
  }
  return { kind: "module" };
}

/**
 * Finds the binding a single scope gives a name: parameters, block declarations, loop variables and `catch`.
 * @param {ts.Node} scope - Node that may declare names.
 * @param {string} name - Name to find.
 * @returns {{ kind: "local"; value: ts.Expression } | { kind: "unknown" } | undefined} The binding, or `undefined`
 * when the scope does not declare the name.
 */
function findBindingInScope(scope, name) {
  if (ts.isBlock(scope) || ts.isCaseClause(scope) || ts.isDefaultClause(scope)) {
    return findLocalDeclaration(scope.statements, name);
  }
  /** @type {ts.BindingName[]} */
  let bindingNames = [];
  if (ts.isFunctionLike(scope)) {
    bindingNames = scope.parameters.map((parameter) => parameter.name);
  } else if (
    (ts.isForStatement(scope) || ts.isForOfStatement(scope) || ts.isForInStatement(scope)) &&
    scope.initializer !== undefined &&
    ts.isVariableDeclarationList(scope.initializer)
  ) {
    bindingNames = scope.initializer.declarations.map((declaration) => declaration.name);
  } else if (ts.isCatchClause(scope) && scope.variableDeclaration !== undefined) {
    bindingNames = [scope.variableDeclaration.name];
  }
  return bindingNames.some((bindingName) => bindsName(bindingName, name)) ? { kind: "unknown" } : undefined;
}

/**
 * Finds a local declaration of a name among the statements of a block.
 * @param {ts.NodeArray<ts.Statement>} statements - Statements of the block.
 * @param {string} name - Name to find.
 * @returns {{ kind: "local"; value: ts.Expression } | { kind: "unknown" } | undefined} The initializer of a local
 * `const`, `unknown` for any other declaration of the name, `undefined` when the block does not declare it.
 */
function findLocalDeclaration(statements, name) {
  for (const statement of statements) {
    if (ts.isVariableStatement(statement)) {
      const declaration = statement.declarationList.declarations.find((candidate) => bindsName(candidate.name, name));
      if (declaration !== undefined) {
        const isConst = isConstList(statement.declarationList, statement.getSourceFile());
        return isConst && ts.isIdentifier(declaration.name) && declaration.initializer !== undefined
          ? { kind: "local", value: declaration.initializer }
          : { kind: "unknown" };
      }
    }
    if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) && statement.name?.text === name) {
      return { kind: "unknown" };
    }
  }
  return undefined;
}

/**
 * Checks whether a binding name, maybe a destructuring pattern, binds a name.
 * @param {ts.BindingName} bindingName - Name or pattern.
 * @param {string} name - Name to find.
 * @returns {boolean} Whether it binds it.
 */
function bindsName(bindingName, name) {
  if (ts.isIdentifier(bindingName)) {
    return bindingName.text === name;
  }
  return bindingName.elements.some((element) => !ts.isOmittedExpression(element) && bindsName(element.name, name));
}

/**
 * Checks whether a module writes to a property of an object: `NAME.key = ...`, `NAME[key] = ...`, `delete NAME.key`,
 * `Object.assign(NAME, ...)` or `Object.defineProperty(NAME, ...)`.
 * @param {ts.SourceFile} sourceFile - Module to search.
 * @param {string} name - Name of the object in the module.
 * @returns {boolean} Whether some statement may change its properties.
 */
function mutatesObject(sourceFile, name) {
  /** @param {ts.Expression} target - Written expression. */
  const isPropertyOf = (target) =>
    (ts.isPropertyAccessExpression(target) || ts.isElementAccessExpression(target)) &&
    ts.isIdentifier(target.expression) &&
    target.expression.text === name;
  /** @param {ts.Node} node - Node that may write. */
  const writesProperty = (node) =>
    (ts.isBinaryExpression(node) &&
      node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
      node.operatorToken.kind <= ts.SyntaxKind.LastAssignment &&
      isPropertyOf(node.left)) ||
    (ts.isDeleteExpression(node) && isPropertyOf(node.expression)) ||
    (ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === "Object" &&
      node.arguments.some((argument) => ts.isIdentifier(argument) && argument.text === name));
  let mutated = false;
  /** @param {ts.Node} node - Node to visit. */
  const visit = (node) => {
    if (!mutated) {
      mutated = writesProperty(node);
      ts.forEachChild(node, visit);
    }
  };
  visit(sourceFile);
  return mutated;
}

/**
 * Checks whether an object constant is read-only for TypeScript: `{ ... } as const` or `Object.freeze({ ... })`.
 * Other modules that import it cannot assign its properties without a type error.
 * @param {ts.Expression} initializer - Initializer of the constant.
 * @returns {ts.ObjectLiteralExpression | undefined} The object literal, when it is read-only.
 */
function readonlyObjectLiteral(initializer) {
  let value = initializer;
  while (ts.isParenthesizedExpression(value) || ts.isSatisfiesExpression(value)) {
    value = value.expression;
  }
  if (
    ts.isAsExpression(value) &&
    value.type.getText() === "const" &&
    ts.isObjectLiteralExpression(unwrap(value.expression))
  ) {
    return /** @type {ts.ObjectLiteralExpression} */ (unwrap(value.expression));
  }
  if (
    ts.isCallExpression(value) &&
    value.expression.getText() === "Object.freeze" &&
    value.arguments.length === 1 &&
    ts.isObjectLiteralExpression(unwrap(value.arguments[0]))
  ) {
    return /** @type {ts.ObjectLiteralExpression} */ (unwrap(value.arguments[0]));
  }
  return undefined;
}

/**
 * Resolves the value a name holds at its point of use: a local `const`, or a module-level one, maybe imported.
 * @param {ts.Identifier} identifier - Name at its point of use.
 * @param {ModuleContext} context - Module of the use.
 * @param {SourceReader} readSource - Reads files of the project.
 * @param {number} depth - Imports followed so far.
 * @returns {{ value: ts.Expression; context: ModuleContext } | undefined} Its initializer and module.
 */
function resolveBinding(identifier, context, readSource, depth) {
  const local = resolveLocalBinding(identifier, identifier.text);
  if (local.kind === "unknown") {
    return undefined;
  }
  return local.kind === "local"
    ? { value: local.value, context }
    : resolveConstant(identifier.text, context, readSource, depth);
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
    const constant = resolveBinding(value, context, readSource, depth);
    return constant !== undefined && isConstantSql(constant.value, constant.context, readSource, depth + 1);
  }
  if (ts.isPropertyAccessExpression(value) && ts.isIdentifier(value.expression)) {
    const objectName = value.expression.text;
    const constant = resolveBinding(value.expression, context, readSource, depth);
    // Properties of a `const` object can still be written: only a read-only object that neither module writes to
    // keeps its literal values.
    const objectValue = constant === undefined ? undefined : readonlyObjectLiteral(constant.value);
    if (
      constant === undefined ||
      objectValue === undefined ||
      mutatesObject(context.sourceFile, objectName) ||
      mutatesObject(constant.context.sourceFile, readDeclaredName(constant.value) ?? objectName)
    ) {
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
 * Reads the name of the constant an initializer belongs to.
 * @param {ts.Expression} initializer - Initializer of a `const`.
 * @returns {string | undefined} Name of the declared variable.
 */
function readDeclaredName(initializer) {
  const declaration = initializer.parent;
  return ts.isVariableDeclaration(declaration) && ts.isIdentifier(declaration.name) ? declaration.name.text : undefined;
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
