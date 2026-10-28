/**
 * @module react-doctor/source-scope Resolves a name of a module to the identifier that declares it, with the lexical
 * scope of JavaScript: parameters, block declarations, hoisted `var` and functions, loop variables, `catch`, the
 * name of a function expression and imports. Filters use it to follow the real binding of a name instead of its
 * text, so an inner variable that shadows an outer one is never taken for it.
 */
import ts from "typescript";

/**
 * Finds the identifier a binding name or pattern declares with a name.
 * @param {ts.BindingName} bindingName - Name or destructuring pattern.
 * @param {string} name - Name to find.
 * @returns {ts.Identifier | undefined} The declaring identifier.
 */
function findInBindingName(bindingName, name) {
  if (ts.isIdentifier(bindingName)) {
    return bindingName.text === name ? bindingName : undefined;
  }
  for (const element of bindingName.elements) {
    const found = ts.isOmittedExpression(element) ? undefined : findInBindingName(element.name, name);
    if (found !== undefined) {
      return found;
    }
  }
  return undefined;
}

/**
 * Finds the identifier an import declaration binds with a name.
 * @param {ts.ImportDeclaration} statement - Import.
 * @param {string} name - Local name.
 * @returns {ts.Identifier | undefined} The declaring identifier.
 */
function findInImport(statement, name) {
  const clause = statement.importClause;
  if (clause === undefined) {
    return undefined;
  }
  if (clause.name?.text === name) {
    return clause.name;
  }
  const bindings = clause.namedBindings;
  if (bindings === undefined) {
    return undefined;
  }
  if (ts.isNamespaceImport(bindings)) {
    return bindings.name.text === name ? bindings.name : undefined;
  }
  return bindings.elements.find((element) => element.name.text === name)?.name;
}

/**
 * Finds a declaration of a name among the statements of a block or module.
 * @param {readonly ts.Statement[]} statements - Statements.
 * @param {string} name - Name to find.
 * @returns {ts.Identifier | undefined} The declaring identifier.
 */
function findInStatements(statements, name) {
  for (const statement of statements) {
    let found;
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        found ??= findInBindingName(declaration.name, name);
      }
    } else if (
      ts.isFunctionDeclaration(statement) ||
      ts.isClassDeclaration(statement) ||
      ts.isEnumDeclaration(statement)
    ) {
      found = statement.name?.text === name ? statement.name : undefined;
    } else if (ts.isImportDeclaration(statement)) {
      found = findInImport(statement, name);
    }
    if (found !== undefined) {
      return found;
    }
  }
  return undefined;
}

/**
 * Finds a `var` of a function body declared inside nested blocks, which JavaScript hoists to the function.
 * @param {ts.Node} body - Function body.
 * @param {string} name - Name to find.
 * @returns {ts.Identifier | undefined} The declaring identifier.
 */
function findHoistedVar(body, name) {
  /** @type {ts.Identifier | undefined} */
  let found;
  /** @param {ts.Node} node - Node to visit. */
  const visit = (node) => {
    if (found !== undefined || ts.isFunctionLike(node)) {
      return;
    }
    if (ts.isVariableDeclarationList(node) && (node.flags & ts.NodeFlags.BlockScoped) === 0) {
      for (const declaration of node.declarations) {
        found ??= findInBindingName(declaration.name, name);
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(body, visit);
  return found;
}

/**
 * Finds a name among variable declarations.
 * @param {readonly ts.VariableDeclaration[] | readonly ts.ParameterDeclaration[]} declarations - Declarations.
 * @param {string} name - Name to find.
 * @returns {ts.Identifier | undefined} The declaring identifier.
 */
function findInDeclarations(declarations, name) {
  for (const declaration of declarations) {
    const found = findInBindingName(declaration.name, name);
    if (found !== undefined) {
      return found;
    }
  }
  return undefined;
}

/**
 * Finds the declaration a function gives a name: a parameter, the name of a function expression, or a hoisted
 * `var` of its body.
 * @param {ts.SignatureDeclaration} scope - Function.
 * @param {string} name - Name to find.
 * @returns {ts.Identifier | undefined} The declaring identifier.
 */
function findInFunction(scope, name) {
  const parameter = findInDeclarations(scope.parameters, name);
  if (parameter !== undefined) {
    return parameter;
  }
  if (ts.isFunctionExpression(scope) && scope.name?.text === name) {
    return scope.name;
  }
  const body = "body" in scope ? scope.body : undefined;
  return body === undefined ? undefined : findHoistedVar(body, name);
}

/**
 * Finds the declaration a single scope gives a name.
 * @param {ts.Node} scope - Node that may declare names.
 * @param {string} name - Name to find.
 * @returns {ts.Identifier | undefined} The declaring identifier, or `undefined` when the scope does not declare it.
 */
function findInScope(scope, name) {
  if (ts.isSourceFile(scope) || ts.isBlock(scope) || ts.isModuleBlock(scope) || ts.isCaseClause(scope) || ts.isDefaultClause(scope)) {
    return findInStatements(scope.statements, name);
  }
  if (ts.isFunctionLike(scope)) {
    return findInFunction(scope, name);
  }
  if (
    (ts.isForStatement(scope) || ts.isForOfStatement(scope) || ts.isForInStatement(scope)) &&
    scope.initializer !== undefined &&
    ts.isVariableDeclarationList(scope.initializer)
  ) {
    return findInDeclarations(scope.initializer.declarations, name);
  }
  if (ts.isCatchClause(scope) && scope.variableDeclaration !== undefined) {
    return findInBindingName(scope.variableDeclaration.name, name);
  }
  return ts.isClassExpression(scope) && scope.name?.text === name ? scope.name : undefined;
}

/**
 * Finds the identifier that declares the binding a name refers to at its point of use.
 * @param {ts.Identifier} identifier - Name at its point of use.
 * @returns {ts.Identifier | undefined} The declaring identifier, or `undefined` for a global.
 */
export function findDeclaration(identifier) {
  /** @type {ts.Node | undefined} */
  let scope = identifier.parent;
  while (scope !== undefined) {
    const found = findInScope(scope, identifier.text);
    if (found !== undefined) {
      return found;
    }
    scope = scope.parent;
  }
  return undefined;
}

/**
 * Checks whether an identifier reads or writes a variable, rather than naming a property, a label or a declaration.
 * @param {ts.Identifier} identifier - Identifier.
 * @returns {boolean} Whether it refers to a binding of the scope.
 */
export function isVariableReference(identifier) {
  const { parent } = identifier;
  if (
    (ts.isPropertyAccessExpression(parent) && parent.name === identifier) ||
    (ts.isQualifiedName(parent) && parent.right === identifier) ||
    ((ts.isPropertyAssignment(parent) ||
      ts.isPropertyDeclaration(parent) ||
      ts.isPropertySignature(parent) ||
      ts.isMethodDeclaration(parent) ||
      ts.isMethodSignature(parent) ||
      ts.isGetAccessor(parent) ||
      ts.isSetAccessor(parent) ||
      ts.isEnumMember(parent)) &&
      parent.name === identifier) ||
    (ts.isBindingElement(parent) && parent.propertyName === identifier) ||
    ((ts.isImportSpecifier(parent) || ts.isExportSpecifier(parent)) && parent.propertyName === identifier) ||
    ts.isJsxAttribute(parent) ||
    ts.isLabeledStatement(parent) ||
    ts.isBreakOrContinueStatement(parent) ||
    ts.isTypeReferenceNode(parent)
  ) {
    return false;
  }
  return findDeclaredNode(identifier) === undefined;
}

/**
 * Finds the declaration an identifier names, when the identifier is the name it introduces.
 * @param {ts.Identifier} identifier - Identifier.
 * @returns {ts.Node | undefined} The declaration it names, or `undefined` when it is a use.
 */
function findDeclaredNode(identifier) {
  const { parent } = identifier;
  return (ts.isVariableDeclaration(parent) ||
    ts.isParameter(parent) ||
    ts.isBindingElement(parent) ||
    ts.isFunctionDeclaration(parent) ||
    ts.isFunctionExpression(parent) ||
    ts.isClassDeclaration(parent) ||
    ts.isClassExpression(parent) ||
    ts.isImportSpecifier(parent) ||
    ts.isImportClause(parent) ||
    ts.isNamespaceImport(parent)) &&
    parent.name === identifier
    ? parent
    : undefined;
}

/**
 * Lists the uses of a binding inside a node: identifiers that resolve to its declaring identifier.
 * @param {ts.Node} root - Node to search.
 * @param {ts.Identifier} declaration - Declaring identifier.
 * @returns {ts.Identifier[]} The uses, without the declaration itself.
 */
export function listReferences(root, declaration) {
  /** @type {ts.Identifier[]} */
  const references = [];
  /** @param {ts.Node} node - Node to visit. */
  const visit = (node) => {
    if (
      ts.isIdentifier(node) &&
      node !== declaration &&
      node.text === declaration.text &&
      isVariableReference(node) &&
      findDeclaration(node) === declaration
    ) {
      references.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(root);
  return references;
}

/**
 * Removes the wrappers that do not change a value: parentheses, type assertions, `satisfies` and `!`.
 * @param {ts.Expression} expression - Expression to unwrap.
 * @returns {ts.Expression} The wrapped value.
 */
export function unwrapExpression(expression) {
  if (
    ts.isParenthesizedExpression(expression) ||
    ts.isAsExpression(expression) ||
    ts.isTypeAssertionExpression(expression) ||
    ts.isSatisfiesExpression(expression) ||
    ts.isNonNullExpression(expression)
  ) {
    return unwrapExpression(expression.expression);
  }
  return expression;
}

/**
 * Checks whether a node contains a node of some kind outside nested functions.
 * @param {ts.Node} root - Node to search.
 * @param {(node: ts.Node) => boolean} matches - Kind of node.
 * @returns {boolean} Whether some node of `root`'s own function matches.
 */
export function containsOwn(root, matches) {
  let found = false;
  /** @param {ts.Node} node - Node to visit. */
  const visit = (node) => {
    if (found || (node !== root && ts.isFunctionLike(node))) {
      return;
    }
    found = matches(node);
    ts.forEachChild(node, visit);
  };
  visit(root);
  return found;
}
