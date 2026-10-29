/**
 * @module react-doctor/constant-sql Decides whether every `sql.raw(...)` of a file receives SQL fixed in the code:
 * a string literal, a `const` that holds one (`sql.raw(EFFECT_SQL.begin)`), a ternary or a template literal built
 * only from such values, or a parameter whose declared type only admits values of the code (a union of string
 * literals, `(typeof X)[keyof typeof X]` of an `as const` object). A type query (`typeof X`) is checked against the
 * type TypeScript gives `X` (its annotation, or the type inferred from its initializer), never against its current
 * value: `const X: string = "a"` admits any string. Bindings are followed through the lexical scope and the imports
 * of the project. A value whose origin cannot be proven, like an untyped parameter, a call or a
 * package import, counts as built at run time.
 */
import ts from "typescript";
import { findImportedName, parseModule, resolveImport } from "./project-modules.js";
import { declaresTypeParameter, unwrapExpression } from "./source-scope.js";

/** @typedef {import("./project-modules.js").SourceReader} SourceReader */
/** @typedef {import("./project-modules.js").ModuleContext} ModuleContext */

/** Bindings and imports followed before giving up, so a cycle cannot loop forever. */
const MAX_IMPORT_DEPTH = 8;

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
 * @typedef {{ kind: "local"; value: ts.Expression } | { kind: "parameter"; parameter: ts.ParameterDeclaration } | { kind: "unknown" }} LocalBinding
 */

/**
 * Finds the binding a name has at a point of a module, from the innermost scope outwards: a parameter, a local
 * `const`, or nothing when only the module scope can hold it.
 * @param {ts.Node} identifier - Name at its point of use.
 * @param {string} name - Its text.
 * @returns {LocalBinding | { kind: "module" }} `local` with the initializer of a local `const`, `parameter` for a
 * parameter named by a plain identifier, `unknown` for any other local binding, `module` otherwise.
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
 * @returns {LocalBinding | undefined} The binding, or `undefined` when the scope does not declare the name.
 */
function findBindingInScope(scope, name) {
  if (ts.isBlock(scope) || ts.isCaseClause(scope) || ts.isDefaultClause(scope)) {
    return findLocalDeclaration(scope.statements, name);
  }
  /** @type {ts.BindingName[]} */
  let bindingNames = [];
  if (ts.isFunctionLike(scope)) {
    const parameter = scope.parameters.find((candidate) => bindsName(candidate.name, name));
    if (parameter !== undefined && ts.isIdentifier(parameter.name) && parameter.dotDotDotToken === undefined) {
      return { kind: "parameter", parameter };
    }
    bindingNames = scope.parameters.map((candidate) => candidate.name);
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
 * @returns {LocalBinding | undefined} The initializer of a local `const`, `unknown` for any other declaration of
 * the name, `undefined` when the block does not declare it.
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
    ts.isObjectLiteralExpression(unwrapExpression(value.expression))
  ) {
    return /** @type {ts.ObjectLiteralExpression} */ (unwrapExpression(value.expression));
  }
  if (
    ts.isCallExpression(value) &&
    value.expression.getText() === "Object.freeze" &&
    value.arguments.length === 1 &&
    ts.isObjectLiteralExpression(unwrapExpression(value.arguments[0]))
  ) {
    return /** @type {ts.ObjectLiteralExpression} */ (unwrapExpression(value.arguments[0]));
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
  if (local.kind === "unknown" || local.kind === "parameter") {
    return undefined;
  }
  return local.kind === "local"
    ? { value: local.value, context }
    : resolveConstant(identifier.text, context, readSource, depth);
}

/**
 * Lists the properties of a constant object that no module can change: an `as const` or frozen object literal that
 * neither the module of the use nor the module that declares it writes to.
 * @param {ts.Identifier} objectIdentifier - Name of the object at its point of use.
 * @param {ModuleContext} context - Module of the use.
 * @param {SourceReader} readSource - Reads files of the project.
 * @param {number} depth - Imports followed so far.
 * @returns {{ object: ts.ObjectLiteralExpression; context: ModuleContext } | undefined} The object literal and its
 * module, or `undefined` when its properties can change.
 */
function resolveReadonlyObject(objectIdentifier, context, readSource, depth) {
  const constant = resolveBinding(objectIdentifier, context, readSource, depth);
  // Properties of a `const` object can still be written: only a read-only object that neither module writes to
  // keeps its literal values.
  const object = constant === undefined ? undefined : readonlyObjectLiteral(constant.value);
  if (
    constant === undefined ||
    object === undefined ||
    mutatesObject(context.sourceFile, objectIdentifier.text) ||
    mutatesObject(constant.context.sourceFile, readDeclaredName(constant.value) ?? objectIdentifier.text)
  ) {
    return undefined;
  }
  return { object, context: constant.context };
}

/**
 * Checks whether a property of a constant object holds SQL fixed in the code.
 * @param {{ object: ts.Identifier; name: string; typed?: boolean }} property - Name of the object at its point of
 * use, the property read, and whether its type, rather than its value, must admit only literals (for a type query).
 * @param {ModuleContext} context - Module of the use.
 * @param {SourceReader} readSource - Reads files of the project.
 * @param {number} depth - Imports followed so far.
 * @returns {boolean} Whether the property exists and its value is proven to be a literal.
 */
function isConstantProperty({ object: objectIdentifier, name: propertyName, typed = false }, context, readSource, depth) {
  const resolved = resolveReadonlyObject(objectIdentifier, context, readSource, depth);
  const property = resolved?.object.properties.find(
    (candidate) => ts.isPropertyAssignment(candidate) && candidate.name.getText(resolved.context.sourceFile) === propertyName,
  );
  return (
    resolved !== undefined &&
    property !== undefined &&
    ts.isPropertyAssignment(property) &&
    (typed ? hasLiteralType : isConstantSql)(property.initializer, resolved.context, readSource, depth + 1)
  );
}

/**
 * Checks whether the type of every property of a constant object only admits SQL fixed in the code, as
 * `(typeof X)[keyof typeof X]` requires.
 * @param {ts.Identifier} objectIdentifier - Name of the object at its point of use.
 * @param {ModuleContext} context - Module of the use.
 * @param {SourceReader} readSource - Reads files of the project.
 * @param {number} depth - Imports followed so far.
 * @returns {boolean} Whether the object only has plain properties with literal values.
 */
function hasOnlyConstantProperties(objectIdentifier, context, readSource, depth) {
  const resolved = resolveReadonlyObject(objectIdentifier, context, readSource, depth);
  return (
    resolved !== undefined &&
    resolved.object.properties.length > 0 &&
    resolved.object.properties.every(
      (property) =>
        ts.isPropertyAssignment(property) && hasLiteralType(property.initializer, resolved.context, readSource, depth + 1),
    )
  );
}

/**
 * Finds the type alias a name refers to at a point of a module: a type alias of an enclosing block or of the module,
 * or one imported from another module of the project. A type parameter or an interface hides it.
 * @param {ts.Identifier} name - Type name at its point of use.
 * @param {ModuleContext} context - Module of the use.
 * @param {SourceReader} readSource - Reads files of the project.
 * @param {number} depth - Imports followed so far.
 * @returns {{ type: ts.TypeNode; context: ModuleContext } | undefined} The aliased type and its module.
 */
function resolveTypeAlias(name, context, readSource, depth) {
  /** @type {ts.Node} */
  let scope = name.parent;
  while (!ts.isSourceFile(scope)) {
    if (declaresTypeParameter(scope, name.text)) {
      return undefined;
    }
    if (ts.isBlock(scope) || ts.isModuleBlock(scope)) {
      const declared = findTypeDeclaration(scope.statements, name.text);
      if (declared !== undefined) {
        return declared === null ? undefined : { type: declared.type, context };
      }
    }
    scope = scope.parent;
  }
  return resolveModuleTypeAlias(name.text, context, readSource, depth);
}

/**
 * Finds a type declaration among statements.
 * @param {ts.NodeArray<ts.Statement>} statements - Statements of a block or module.
 * @param {string} name - Type name.
 * @returns {ts.TypeAliasDeclaration | null | undefined} The type alias, `null` for another declaration of the name
 * (interface, class, enum), `undefined` when none declares it.
 */
function findTypeDeclaration(statements, name) {
  for (const statement of statements) {
    if (ts.isTypeAliasDeclaration(statement) && statement.name.text === name) {
      return statement.typeParameters === undefined ? statement : null;
    }
    if (
      (ts.isInterfaceDeclaration(statement) || ts.isClassDeclaration(statement) || ts.isEnumDeclaration(statement)) &&
      statement.name?.text === name
    ) {
      return null;
    }
  }
  return undefined;
}

/**
 * Finds a module-level type alias, following the import that brings it from another module of the project.
 * @param {string} name - Name of the type in the module.
 * @param {ModuleContext} context - Module where the name is used.
 * @param {SourceReader} readSource - Reads files of the project.
 * @param {number} depth - Imports followed so far.
 * @returns {{ type: ts.TypeNode; context: ModuleContext } | undefined} The aliased type and its module.
 */
function resolveModuleTypeAlias(name, context, readSource, depth) {
  const declared = findTypeDeclaration(context.sourceFile.statements, name);
  if (declared !== undefined) {
    return declared === null ? undefined : { type: declared.type, context };
  }
  for (const statement of context.sourceFile.statements) {
    const importedName = depth < MAX_IMPORT_DEPTH ? findImportedName(statement, name) : undefined;
    if (importedName !== undefined && ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      const imported = resolveImport(context.filePath, statement.moduleSpecifier.text, readSource);
      return imported === undefined ? undefined : resolveModuleTypeAlias(importedName, imported, readSource, depth + 1);
    }
  }
  return undefined;
}

/**
 * Reads the object a `typeof X` type query names, when it names a plain identifier.
 * @param {ts.TypeNode} type - Type node.
 * @returns {ts.Identifier | undefined} The identifier `X`.
 */
function readTypeQueryIdentifier(type) {
  const unwrapped = ts.isParenthesizedTypeNode(type) ? type.type : type;
  return ts.isTypeQueryNode(unwrapped) && ts.isIdentifier(unwrapped.exprName) && unwrapped.typeArguments === undefined
    ? unwrapped.exprName
    : undefined;
}

/**
 * Lists the string literals a key type admits: `"a"`, `"a" | "b"`, or an alias of them.
 * @param {ts.TypeNode} type - Index type.
 * @param {ModuleContext} context - Module of the type.
 * @param {SourceReader} readSource - Reads files of the project.
 * @param {number} depth - Imports followed so far.
 * @returns {string[] | undefined} The keys, or `undefined` when the type admits other values.
 */
function listLiteralKeys(type, context, readSource, depth) {
  if (ts.isParenthesizedTypeNode(type)) {
    return listLiteralKeys(type.type, context, readSource, depth);
  }
  if (ts.isLiteralTypeNode(type) && (ts.isStringLiteral(type.literal) || ts.isNoSubstitutionTemplateLiteral(type.literal))) {
    return [type.literal.text];
  }
  if (ts.isUnionTypeNode(type)) {
    const keys = type.types.map((member) => listLiteralKeys(member, context, readSource, depth));
    return keys.every((member) => member !== undefined) ? keys.flat() : undefined;
  }
  if (ts.isTypeReferenceNode(type) && ts.isIdentifier(type.typeName) && type.typeArguments === undefined && depth < MAX_IMPORT_DEPTH) {
    const alias = resolveTypeAlias(type.typeName, context, readSource, depth);
    return alias === undefined ? undefined : listLiteralKeys(alias.type, alias.context, readSource, depth + 1);
  }
  return undefined;
}

/**
 * Checks whether an indexed access type only admits values of a constant object: `(typeof X)[keyof typeof X]` or
 * `(typeof X)["a" | "b"]`.
 * @param {ts.IndexedAccessTypeNode} type - Indexed access type.
 * @param {ModuleContext} context - Module of the type.
 * @param {SourceReader} readSource - Reads files of the project.
 * @param {number} depth - Imports followed so far.
 * @returns {boolean} Whether every admitted value is SQL fixed in the code.
 */
function isConstantIndexedAccess(type, context, readSource, depth) {
  const objectIdentifier = readTypeQueryIdentifier(type.objectType);
  if (objectIdentifier === undefined) {
    return false;
  }
  const index = ts.isParenthesizedTypeNode(type.indexType) ? type.indexType.type : type.indexType;
  if (ts.isTypeOperatorNode(index) && index.operator === ts.SyntaxKind.KeyOfKeyword) {
    const keyedIdentifier = readTypeQueryIdentifier(index.type);
    // `keyof typeof Y` with another object would admit keys `X` may not have. Both names share a scope, so the same
    // text is the same binding.
    return (
      keyedIdentifier !== undefined &&
      keyedIdentifier.text === objectIdentifier.text &&
      hasOnlyConstantProperties(objectIdentifier, context, readSource, depth)
    );
  }
  const keys = listLiteralKeys(index, context, readSource, depth);
  return (
    keys !== undefined &&
    keys.length > 0 &&
    keys.every((key) => isConstantProperty({ object: objectIdentifier, name: key, typed: true }, context, readSource, depth))
  );
}

/**
 * Checks whether a declared type only admits SQL fixed in the code: string literal types, `typeof` of a constant,
 * values of a constant object, unions of them and type aliases of them.
 * @param {ts.TypeNode} type - Declared type.
 * @param {ModuleContext} context - Module of the type.
 * @param {SourceReader} readSource - Reads files of the project.
 * @param {number} depth - Imports followed so far.
 * @returns {boolean} Whether every value of the type is proven to be a literal of the code.
 */
function isConstantType(type, context, readSource, depth) {
  if (depth >= MAX_IMPORT_DEPTH) {
    return false;
  }
  if (ts.isParenthesizedTypeNode(type)) {
    return isConstantType(type.type, context, readSource, depth);
  }
  if (ts.isLiteralTypeNode(type)) {
    return ts.isStringLiteral(type.literal) || ts.isNoSubstitutionTemplateLiteral(type.literal);
  }
  if (ts.isUnionTypeNode(type)) {
    return type.types.every((member) => isConstantType(member, context, readSource, depth));
  }
  if (ts.isTypeQueryNode(type) && type.typeArguments === undefined) {
    const { exprName } = type;
    if (ts.isIdentifier(exprName)) {
      return isLiteralTypedName(exprName, context, readSource, depth + 1);
    }
    return (
      ts.isIdentifier(exprName.left) &&
      isConstantProperty({ object: exprName.left, name: exprName.right.text, typed: true }, context, readSource, depth + 1)
    );
  }
  if (ts.isIndexedAccessTypeNode(type)) {
    return isConstantIndexedAccess(type, context, readSource, depth + 1);
  }
  if (ts.isTypeReferenceNode(type) && ts.isIdentifier(type.typeName) && type.typeArguments === undefined) {
    const alias = resolveTypeAlias(type.typeName, context, readSource, depth);
    return alias !== undefined && isConstantType(alias.type, alias.context, readSource, depth + 1);
  }
  return false;
}

/**
 * Checks whether the type of a name at its point of use only admits SQL fixed in the code, as `typeof name`
 * requires: the type of a parameter, the annotation of a `const`, or the type TypeScript infers from its initializer.
 * @param {ts.Identifier} identifier - Name at its point of use.
 * @param {ModuleContext} context - Module of the use.
 * @param {SourceReader} readSource - Reads files of the project.
 * @param {number} depth - Imports followed so far.
 * @returns {boolean} Whether every value of its type is proven to be a literal.
 */
function isLiteralTypedName(identifier, context, readSource, depth) {
  if (depth >= MAX_IMPORT_DEPTH) {
    return false;
  }
  const local = resolveLocalBinding(identifier, identifier.text);
  if (local.kind === "parameter") {
    return isConstantParameter(local.parameter, context, readSource, depth + 1);
  }
  const constant = resolveBinding(identifier, context, readSource, depth);
  const declaration = constant?.value.parent;
  if (constant === undefined || declaration === undefined || !ts.isVariableDeclaration(declaration)) {
    return false;
  }
  // The annotation, not the initializer, is the type of the constant: `const X: string = "a"` admits any string.
  return declaration.type === undefined
    ? hasLiteralType(constant.value, constant.context, readSource, depth + 1)
    : isConstantType(declaration.type, constant.context, readSource, depth + 1);
}

/**
 * Checks whether the type TypeScript infers for the initializer of a `const` or of a property of a read-only object
 * only admits SQL fixed in the code: a string literal, a ternary between them, a name or property of such a type, or
 * an assertion to such a type. A template literal with substitutions widens to `string`.
 * @param {ts.Expression} expression - Initializer.
 * @param {ModuleContext} context - Module of the expression.
 * @param {SourceReader} readSource - Reads files of the project.
 * @param {number} depth - Imports followed so far.
 * @returns {boolean} Whether every value of its inferred type is proven to be a literal.
 */
function hasLiteralType(expression, context, readSource, depth) {
  if (depth >= MAX_IMPORT_DEPTH) {
    return false;
  }
  if (ts.isParenthesizedExpression(expression) || ts.isSatisfiesExpression(expression) || ts.isNonNullExpression(expression)) {
    return hasLiteralType(expression.expression, context, readSource, depth);
  }
  if (ts.isAsExpression(expression) || ts.isTypeAssertionExpression(expression)) {
    return expression.type.getText() === "const"
      ? hasLiteralType(expression.expression, context, readSource, depth)
      : isConstantType(expression.type, context, readSource, depth + 1);
  }
  if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) {
    return true;
  }
  if (ts.isConditionalExpression(expression)) {
    return (
      hasLiteralType(expression.whenTrue, context, readSource, depth + 1) &&
      hasLiteralType(expression.whenFalse, context, readSource, depth + 1)
    );
  }
  if (ts.isIdentifier(expression)) {
    return isLiteralTypedName(expression, context, readSource, depth + 1);
  }
  if (ts.isPropertyAccessExpression(expression) && ts.isIdentifier(expression.expression)) {
    return isConstantProperty({ object: expression.expression, name: expression.name.text, typed: true }, context, readSource, depth);
  }
  return false;
}

/**
 * Checks whether a function body assigns a name: `name = ...`, `name += ...`, `name++`, or a destructuring
 * assignment or loop that writes it. Any write counts, also one to an inner variable of the same name.
 * @param {ts.Node} body - Function body.
 * @param {string} name - Parameter name.
 * @returns {boolean} Whether some expression may change it.
 */
function assignsName(body, name) {
  /** @param {ts.Node} target - Assigned expression or pattern. */
  const targetsName = (target) => {
    let found = false;
    /** @param {ts.Node} node - Node of the target. */
    const visit = (node) => {
      found ||= ts.isIdentifier(node) && node.text === name;
      if (!found && !ts.isPropertyAccessExpression(node) && !ts.isElementAccessExpression(node)) {
        ts.forEachChild(node, visit);
      }
    };
    visit(target);
    return found;
  };
  let assigned = false;
  /** @param {ts.Node} node - Node to visit. */
  const visit = (node) => {
    if (assigned) {
      return;
    }
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
      node.operatorToken.kind <= ts.SyntaxKind.LastAssignment
    ) {
      assigned = targetsName(node.left);
    } else if (
      (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
      (node.operator === ts.SyntaxKind.PlusPlusToken || node.operator === ts.SyntaxKind.MinusMinusToken)
    ) {
      assigned = targetsName(node.operand);
    } else if ((ts.isForOfStatement(node) || ts.isForInStatement(node)) && !ts.isVariableDeclarationList(node.initializer)) {
      assigned = targetsName(node.initializer);
    }
    ts.forEachChild(node, visit);
  };
  visit(body);
  return assigned;
}

/**
 * Checks whether a parameter can only hold SQL fixed in the code: its declared type admits only literals of the code
 * (TypeScript rejects any other argument), its default value is one, and the function never reassigns it.
 * @param {ts.ParameterDeclaration} parameter - Parameter named by a plain identifier.
 * @param {ModuleContext} context - Module of the function.
 * @param {SourceReader} readSource - Reads files of the project.
 * @param {number} depth - Imports followed so far.
 * @returns {boolean} Whether every value it can hold is proven to be a literal.
 */
function isConstantParameter(parameter, context, readSource, depth) {
  const owner = parameter.parent;
  return (
    parameter.type !== undefined &&
    parameter.modifiers === undefined &&
    ts.isIdentifier(parameter.name) &&
    isConstantType(parameter.type, context, readSource, depth) &&
    (parameter.initializer === undefined || isConstantSql(parameter.initializer, context, readSource, depth + 1)) &&
    (!("body" in owner) || owner.body === undefined || !assignsName(owner.body, parameter.name.text))
  );
}

/**
 * Checks whether an expression is SQL fixed in the code: a string literal without interpolation, a constant that
 * holds one, a property of a constant object whose value is one, a ternary or a template literal built only from
 * such values, or a parameter whose declared type only admits them.
 * @param {ts.Expression} expression - Argument of `sql.raw`, or a value it points to.
 * @param {ModuleContext} context - Module of the expression.
 * @param {SourceReader} readSource - Reads files of the project.
 * @param {number} depth - Imports followed so far.
 * @returns {boolean} Whether its value is proven to be a literal.
 */
function isConstantSql(expression, context, readSource, depth) {
  if (depth >= MAX_IMPORT_DEPTH) {
    return false;
  }
  const value = unwrapExpression(expression);
  if (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)) {
    return true;
  }
  if (ts.isConditionalExpression(value)) {
    return (
      isConstantSql(value.whenTrue, context, readSource, depth + 1) &&
      isConstantSql(value.whenFalse, context, readSource, depth + 1)
    );
  }
  if (ts.isTemplateExpression(value)) {
    return value.templateSpans.every((span) => isConstantSql(span.expression, context, readSource, depth + 1));
  }
  if (ts.isIdentifier(value)) {
    const local = resolveLocalBinding(value, value.text);
    if (local.kind === "parameter") {
      return isConstantParameter(local.parameter, context, readSource, depth + 1);
    }
    const constant = resolveBinding(value, context, readSource, depth);
    return constant !== undefined && isConstantSql(constant.value, constant.context, readSource, depth + 1);
  }
  if (ts.isPropertyAccessExpression(value) && ts.isIdentifier(value.expression)) {
    return isConstantProperty({ object: value.expression, name: value.name.text }, context, readSource, depth);
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
