/**
 * @module react-doctor/object-url-owner Decides whether an object URL that react-doctor's
 * `no-create-object-url-without-revoke` reports has an owner that releases it. The rule follows the URL inside its
 * function and file, so it cannot see a URL kept in React state or in a ref and revoked by other functions or
 * modules. A URL counts as owned when the value `URL.createObjectURL` creates reaches a `useState` or `useReducer`
 * setter, maybe through local functions, `useCallback` or the declared type of a controller object built from the
 * returns of hooks, or is written to a ref (`ref.current = url`), and the module or one it imports from the project
 * calls `URL.revokeObjectURL`. A URL that is only used, or kept where nothing revokes object URLs, is still reported.
 */
import ts from "typescript";
import { findCallAt, followImport, resolveImport } from "./project-modules.js";
import { declaresTypeParameter, findDeclaration, listReferences, unwrapExpression } from "./source-scope.js";
import { isStateSetter, listReturnedExpressions, readReactExport, writesProperty } from "./state-setter-origin.js";

/** @typedef {import("./project-modules.js").SourceReader} SourceReader */
/** @typedef {import("./project-modules.js").ModuleContext} ModuleContext */

/** Values, functions and types followed before giving up, so a cycle cannot loop forever. */
const MAX_DEPTH = 24;

/**
 * @typedef {object} Flow
 * @property {ModuleContext} context - Module being followed.
 * @property {SourceReader} readSource - Reads files of the project.
 * @property {Set<ts.Node>} visited - Declarations and functions already followed.
 * @property {number} depth - Steps followed so far.
 */

/**
 * Checks whether a call is `URL.<method>(...)` on the global `URL`.
 * @param {ts.Node} node - Node.
 * @param {string} method - Method name.
 * @returns {node is ts.CallExpression} Whether it calls that method.
 */
function isUrlCall(node, method) {
  if (!ts.isCallExpression(node)) {
    return false;
  }
  const callee = unwrapExpression(node.expression);
  return (
    ts.isPropertyAccessExpression(callee) &&
    callee.name.text === method &&
    ts.isIdentifier(callee.expression) &&
    callee.expression.text === "URL" &&
    findDeclaration(callee.expression) === undefined
  );
}

/**
 * Checks whether a module calls `URL.revokeObjectURL`.
 * @param {ts.SourceFile} sourceFile - Module.
 * @returns {boolean} Whether some call revokes an object URL.
 */
function revokesObjectUrls(sourceFile) {
  let found = false;
  /** @param {ts.Node} node - Node to visit. */
  const visit = (node) => {
    if (!found) {
      found = isUrlCall(node, "revokeObjectURL");
      ts.forEachChild(node, visit);
    }
  };
  visit(sourceFile);
  return found;
}

/**
 * Checks whether a module, or a module of the project it imports, calls `URL.revokeObjectURL`.
 * @param {ModuleContext} context - Module of the finding.
 * @param {SourceReader} readSource - Reads files of the project.
 * @returns {boolean} Whether some code at hand releases object URLs.
 */
function revokesNearby(context, readSource) {
  if (revokesObjectUrls(context.sourceFile)) {
    return true;
  }
  return context.sourceFile.statements.some((statement) => {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
      return false;
    }
    const imported = resolveImport(context.filePath, statement.moduleSpecifier.text, readSource);
    return imported !== undefined && revokesObjectUrls(imported.sourceFile);
  });
}

/**
 * Advances a flow one step.
 * @param {Flow} flow - State of the search.
 * @returns {Flow} The same search, one step deeper.
 */
function deeper(flow) {
  return { ...flow, depth: flow.depth + 1 };
}

/**
 * Checks whether a value is kept: some path carries it, unchanged or inside object and array literals, functions
 * that return it and arguments of calls, to a state setter or to a ref.
 * @param {ts.Node} node - Expression that holds the value.
 * @param {Flow} flow - State of the search.
 * @returns {boolean} Whether the value is stored in React state or in a ref.
 */
function isStored(node, flow) {
  if (flow.depth >= MAX_DEPTH) {
    return false;
  }
  const { parent } = node;
  const next = deeper(flow);
  if (carriesValue(parent, node)) {
    return isStored(parent, next);
  }
  if ((ts.isArrowFunction(parent) && parent.body === node) || ts.isReturnStatement(parent)) {
    const callable = ts.isReturnStatement(parent) ? findEnclosingFunction(parent) : parent;
    return callable !== undefined && (ts.isArrowFunction(callable) || ts.isFunctionExpression(callable)) && isStored(callable, next);
  }
  return isStoredByUse(node, parent, next);
}

/**
 * Checks whether an expression has the value of a child as its value, or holds it inside: wrappers, the branches of
 * a ternary, `&&`/`||`/`??`, object and array literals and template literals.
 * @param {ts.Node} parent - Expression.
 * @param {ts.Node} node - Its child that holds the value.
 * @returns {boolean} Whether the value travels with the parent.
 */
function carriesValue(parent, node) {
  return (
    ts.isParenthesizedExpression(parent) ||
    ts.isAsExpression(parent) ||
    ts.isSatisfiesExpression(parent) ||
    ts.isNonNullExpression(parent) ||
    ts.isTypeAssertionExpression(parent) ||
    (ts.isConditionalExpression(parent) && parent.condition !== node) ||
    ts.isArrayLiteralExpression(parent) ||
    ts.isSpreadElement(parent) ||
    ts.isSpreadAssignment(parent) ||
    ts.isObjectLiteralExpression(parent) ||
    ts.isShorthandPropertyAssignment(parent) ||
    (ts.isPropertyAssignment(parent) && parent.initializer === node) ||
    ts.isTemplateSpan(parent) ||
    ts.isTemplateExpression(parent) ||
    (ts.isBinaryExpression(parent) && isPassingOperator(parent.operatorToken.kind))
  );
}

/**
 * Checks whether the use of a value as an argument, the right side of an assignment or the initializer of a
 * `const` stores it.
 * @param {ts.Node} node - Expression that holds the value.
 * @param {ts.Node} parent - Its parent.
 * @param {Flow} flow - State of the search.
 * @returns {boolean} Whether the value is stored in React state or in a ref.
 */
function isStoredByUse(node, parent, flow) {
  if (ts.isCallExpression(parent) && parent.expression !== node) {
    const index = parent.arguments.indexOf(/** @type {ts.Expression} */ (node));
    return passesToStore(parent.expression, index, flow) || isStored(parent, flow);
  }
  if (ts.isBinaryExpression(parent) && parent.operatorToken.kind === ts.SyntaxKind.EqualsToken && parent.right === node) {
    const target = unwrapExpression(parent.left);
    return ts.isPropertyAccessExpression(target) && target.name.text === "current";
  }
  if (ts.isVariableDeclaration(parent) && parent.initializer === node) {
    return isConstBinding(parent) && referencesStore(/** @type {ts.Identifier} */ (parent.name), flow.context.sourceFile, flow);
  }
  return false;
}

/**
 * Checks whether a binary operator can give one of its operands as its value.
 * @param {ts.SyntaxKind} kind - Operator.
 * @returns {boolean} Whether it is `&&`, `||` or `??`.
 */
function isPassingOperator(kind) {
  return (
    kind === ts.SyntaxKind.AmpersandAmpersandToken ||
    kind === ts.SyntaxKind.BarBarToken ||
    kind === ts.SyntaxKind.QuestionQuestionToken
  );
}

/**
 * Finds the function whose body holds a node.
 * @param {ts.Node} node - Node.
 * @returns {ts.SignatureDeclaration | undefined} The innermost enclosing function.
 */
function findEnclosingFunction(node) {
  /** @type {ts.Node | undefined} */
  let current = node.parent;
  while (current !== undefined && !ts.isFunctionLike(current)) {
    current = current.parent;
  }
  return current;
}

/**
 * Checks whether a variable declaration is a `const` named by a plain identifier.
 * @param {ts.VariableDeclaration} declaration - Declaration.
 * @returns {boolean} Whether its value cannot change.
 */
function isConstBinding(declaration) {
  return (
    ts.isIdentifier(declaration.name) &&
    ts.isVariableDeclarationList(declaration.parent) &&
    (declaration.parent.flags & ts.NodeFlags.Const) !== 0
  );
}

/**
 * Checks whether some use of a binding stores its value.
 * @param {ts.Identifier} declaration - Declaring identifier.
 * @param {ts.Node} root - Node where its uses are.
 * @param {Flow} flow - State of the search.
 * @returns {boolean} Whether the value reaches React state or a ref through one of them.
 */
function referencesStore(declaration, root, flow) {
  if (flow.visited.has(declaration)) {
    return false;
  }
  const next = { ...flow, visited: new Set(flow.visited).add(declaration) };
  return listReferences(root, declaration).some((reference) => isStored(reference, next));
}

/**
 * Checks whether a call stores the argument at a position: the callee is a state setter, or a function whose
 * parameter at that position is stored.
 * @param {ts.Expression} callee - Callee of the call.
 * @param {number} index - Position of the argument.
 * @param {Flow} flow - State of the search.
 * @returns {boolean} Whether the argument is stored.
 */
function passesToStore(callee, index, flow) {
  if (index < 0 || flow.depth >= MAX_DEPTH) {
    return false;
  }
  if (isStateSetter(callee, flow.context.sourceFile)) {
    return true;
  }
  const callable = resolveFunction(callee, flow);
  if (callable !== undefined) {
    return storesParameter(callable, index, flow);
  }
  const value = unwrapExpression(callee);
  return ts.isPropertyAccessExpression(value) && passesToTypedMember(value, index, flow);
}

/**
 * Checks whether a function stores the parameter at a position.
 * @param {{ node: ts.SignatureDeclaration; context: ModuleContext }} callable - Function and its module.
 * @param {number} index - Position of the parameter.
 * @param {Flow} flow - State of the search.
 * @returns {boolean} Whether the value it receives there is stored.
 */
function storesParameter({ node, context }, index, flow) {
  const parameter = node.parameters[index];
  const body = "body" in node ? node.body : undefined;
  if (
    parameter === undefined ||
    body === undefined ||
    !ts.isIdentifier(parameter.name) ||
    parameter.dotDotDotToken !== undefined ||
    node.parameters.slice(0, index).some((candidate) => candidate.dotDotDotToken !== undefined)
  ) {
    return false;
  }
  return referencesStore(parameter.name, body, { ...deeper(flow), context });
}

/**
 * Resolves the function a callee names in its module: a function expression, a function declaration, a `const`
 * that holds one, or the callback of a `useCallback`.
 * @param {ts.Expression} callee - Callee, or a value it points to.
 * @param {Flow} flow - State of the search.
 * @returns {{ node: ts.SignatureDeclaration; context: ModuleContext } | undefined} The function and its module.
 */
function resolveFunction(callee, flow) {
  if (flow.depth >= MAX_DEPTH) {
    return undefined;
  }
  const value = unwrapExpression(callee);
  if (ts.isArrowFunction(value) || ts.isFunctionExpression(value)) {
    return { node: value, context: flow.context };
  }
  if (ts.isCallExpression(value) && readReactExport(value.expression) === "useCallback" && value.arguments[0] !== undefined) {
    return resolveFunction(value.arguments[0], deeper(flow));
  }
  if (!ts.isIdentifier(value)) {
    return undefined;
  }
  const declaration = findDeclaration(value);
  const declared = declaration?.parent;
  if (declared !== undefined && ts.isFunctionDeclaration(declared) && declared.name === declaration) {
    return { node: declared, context: flow.context };
  }
  return declared !== undefined &&
    ts.isVariableDeclaration(declared) &&
    declared.name === declaration &&
    isConstBinding(declared) &&
    declared.initializer !== undefined
    ? resolveFunction(declared.initializer, deeper(flow))
    : undefined;
}

/**
 * Checks whether a method of a parameter stores an argument, by the declared type of the parameter: every value the
 * type gives the member must be a state setter or a function that stores it.
 * @param {ts.PropertyAccessExpression} callee - `object.member`.
 * @param {number} index - Position of the argument.
 * @param {Flow} flow - State of the search.
 * @returns {boolean} Whether the argument is stored.
 */
function passesToTypedMember(callee, index, flow) {
  const receiver = unwrapExpression(callee.expression);
  const declaration = ts.isIdentifier(receiver) ? findDeclaration(receiver) : undefined;
  const parameter = declaration?.parent;
  if (
    parameter === undefined ||
    !ts.isParameter(parameter) ||
    parameter.name !== declaration ||
    parameter.type === undefined ||
    writesProperty(flow.context.sourceFile, callee.name.text)
  ) {
    return false;
  }
  const providers = findMemberValues(parameter.type, callee.name.text, deeper(flow));
  return (
    providers !== undefined &&
    providers.length > 0 &&
    providers.every((provider) => {
      const providerFlow = { ...deeper(flow), context: provider.context };
      if (isStateSetter(provider.value, provider.context.sourceFile)) {
        return true;
      }
      const callable = resolveFunction(provider.value, providerFlow);
      return callable !== undefined && storesParameter(callable, index, providerFlow);
    })
  );
}

/**
 * Lists the values a type gives a member, when the type is built from the returns of functions of the project:
 * intersections, `Omit`, type aliases and `ReturnType<typeof fn>` of functions that return object literals.
 * @param {ts.TypeNode} type - Declared type.
 * @param {string} name - Member name.
 * @param {Flow} flow - State of the search, with the module of the type.
 * @returns {Array<{ value: ts.Expression; context: ModuleContext }> | undefined} The values (none when no part of
 * the type has the member), or `undefined` when a part may give it a value that cannot be followed.
 */
function findMemberValues(type, name, flow) {
  if (flow.depth >= MAX_DEPTH) {
    return undefined;
  }
  const next = deeper(flow);
  if (ts.isParenthesizedTypeNode(type)) {
    return findMemberValues(type.type, name, next);
  }
  if (ts.isIntersectionTypeNode(type)) {
    const parts = type.types.map((part) => findMemberValues(part, name, next));
    return parts.every((part) => part !== undefined) ? parts.flat() : undefined;
  }
  if (ts.isTypeLiteralNode(type)) {
    return declaresMember(type.members, name) ? undefined : [];
  }
  return ts.isTypeReferenceNode(type) ? findReferencedMemberValues(type, name, next) : undefined;
}

/**
 * Lists the values a named type gives a member: `Omit<T, K>`, `ReturnType<typeof fn>`, or a type alias or interface
 * of the project.
 * @param {ts.TypeReferenceNode} type - Type reference.
 * @param {string} name - Member name.
 * @param {Flow} flow - State of the search, with the module of the type.
 * @returns {Array<{ value: ts.Expression; context: ModuleContext }> | undefined} The values, or `undefined` when they
 * cannot be followed.
 */
function findReferencedMemberValues(type, name, flow) {
  if (!ts.isIdentifier(type.typeName) || isTypeParameter(type.typeName)) {
    return undefined;
  }
  const next = deeper(flow);
  const typeArguments = type.typeArguments ?? [];
  const typeName = type.typeName.text;
  // `Omit` and `ReturnType` are the global utility types unless the module declares or imports its own.
  const isUtility = (/** @type {string} */ utility, /** @type {number} */ arity) =>
    typeName === utility && typeArguments.length === arity && findModuleType(utility, flow) === undefined;
  if (isUtility("Omit", 2)) {
    const omitted = listStringLiterals(typeArguments[1]);
    if (omitted === undefined) {
      return undefined;
    }
    return omitted.includes(name) ? [] : findMemberValues(typeArguments[0], name, next);
  }
  if (isUtility("ReturnType", 1)) {
    const query = typeArguments[0];
    return ts.isTypeQueryNode(query) && ts.isIdentifier(query.exprName) && query.typeArguments === undefined
      ? findReturnedMemberValues(query.exprName.text, name, next)
      : undefined;
  }
  return typeArguments.length === 0 ? findDeclaredMemberValues(typeName, name, next) : undefined;
}

/**
 * Lists the values a type alias or interface of the project gives a member.
 * @param {string} typeName - Type name in the module.
 * @param {string} name - Member name.
 * @param {Flow} flow - State of the search, with the module of the type.
 * @returns {Array<{ value: ts.Expression; context: ModuleContext }> | undefined} The values, or `undefined` when they
 * cannot be followed.
 */
function findDeclaredMemberValues(typeName, name, flow) {
  const declared = findModuleType(typeName, flow);
  if (declared === undefined) {
    return undefined;
  }
  const declaredFlow = { ...deeper(flow), context: declared.context };
  if (ts.isTypeAliasDeclaration(declared.node)) {
    return declared.node.typeParameters === undefined ? findMemberValues(declared.node.type, name, declaredFlow) : undefined;
  }
  return declared.node.heritageClauses === undefined && !declaresMember(declared.node.members, name) ? [] : undefined;
}

/**
 * Checks whether a type name is a type parameter of an enclosing declaration.
 * @param {ts.Identifier} name - Type name at its point of use.
 * @returns {boolean} Whether a type parameter holds the name.
 */
function isTypeParameter(name) {
  /** @type {ts.Node | undefined} */
  let scope = name.parent;
  while (scope !== undefined) {
    if (declaresTypeParameter(scope, name.text)) {
      return true;
    }
    scope = scope.parent;
  }
  return false;
}

/**
 * Checks whether type members declare a name.
 * @param {readonly ts.TypeElement[]} members - Members of a type literal or interface.
 * @param {string} name - Member name.
 * @returns {boolean} Whether one of them has the name, or a computed or index member may.
 */
function declaresMember(members, name) {
  return members.some(
    (member) =>
      ts.isIndexSignatureDeclaration(member) ||
      (member.name !== undefined &&
        (ts.isComputedPropertyName(member.name) || ((ts.isIdentifier(member.name) || ts.isStringLiteral(member.name)) && member.name.text === name))),
  );
}

/**
 * Lists the string literals of a type: `"a"` or `"a" | "b"`.
 * @param {ts.TypeNode} type - Type.
 * @returns {string[] | undefined} The literals, or `undefined` when the type admits other values.
 */
function listStringLiterals(type) {
  if (ts.isLiteralTypeNode(type) && ts.isStringLiteral(type.literal)) {
    return [type.literal.text];
  }
  if (ts.isUnionTypeNode(type)) {
    const members = type.types.map((member) => listStringLiterals(member));
    return members.every((member) => member !== undefined) ? members.flat() : undefined;
  }
  return undefined;
}

/**
 * Finds a type alias or interface that a module declares at its top level or imports from the project.
 * @param {string} name - Type name in the module.
 * @param {Flow} flow - State of the search, with the module.
 * @returns {{ node: ts.TypeAliasDeclaration | ts.InterfaceDeclaration; context: ModuleContext } | undefined} The
 * declaration and its module.
 */
function findModuleType(name, flow) {
  for (const statement of flow.context.sourceFile.statements) {
    if ((ts.isTypeAliasDeclaration(statement) || ts.isInterfaceDeclaration(statement)) && statement.name.text === name) {
      return { node: statement, context: flow.context };
    }
  }
  const imported = flow.depth < MAX_DEPTH ? followImport(name, flow.context, flow.readSource) : undefined;
  return imported === undefined ? undefined : findModuleType(imported.name, { ...deeper(flow), context: imported.context });
}

/**
 * Finds a function that a module declares at its top level or imports from the project.
 * @param {string} name - Function name in the module.
 * @param {Flow} flow - State of the search, with the module.
 * @returns {{ node: ts.SignatureDeclaration; context: ModuleContext } | undefined} The function and its module.
 */
function findModuleFunction(name, flow) {
  const { statements } = flow.context.sourceFile;
  const declared = statements.find((statement) => ts.isFunctionDeclaration(statement) && statement.name?.text === name);
  if (declared !== undefined) {
    return { node: /** @type {ts.FunctionDeclaration} */ (declared), context: flow.context };
  }
  const declaration = statements
    .flatMap((statement) => (ts.isVariableStatement(statement) ? [...statement.declarationList.declarations] : []))
    .find((candidate) => ts.isIdentifier(candidate.name) && candidate.name.text === name);
  if (declaration !== undefined) {
    return isConstBinding(declaration) && declaration.initializer !== undefined ? resolveFunction(declaration.initializer, flow) : undefined;
  }
  const imported = flow.depth < MAX_DEPTH ? followImport(name, flow.context, flow.readSource) : undefined;
  return imported === undefined ? undefined : findModuleFunction(imported.name, { ...deeper(flow), context: imported.context });
}

/**
 * Lists the values that the object literals a function returns give a member, for `ReturnType<typeof fn>`.
 * @param {string} functionName - Name of the function in the module.
 * @param {string} name - Member name.
 * @param {Flow} flow - State of the search, with the module of the type.
 * @returns {Array<{ value: ts.Expression; context: ModuleContext }> | undefined} The values, or `undefined` when a
 * return is not a plain object literal.
 */
function findReturnedMemberValues(functionName, name, flow) {
  const callable = findModuleFunction(functionName, flow);
  const isAsync =
    callable !== undefined &&
    ts.canHaveModifiers(callable.node) &&
    (ts.getModifiers(callable.node)?.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword) ?? false);
  const returned = callable === undefined || isAsync ? undefined : listReturnedExpressions(callable.node);
  if (callable === undefined || returned === undefined) {
    return undefined;
  }
  const values = returned.map((expression) => readObjectMemberValues(unwrapExpression(expression), name, callable.context));
  return values.every((value) => value !== undefined) ? values.flat() : undefined;
}

/**
 * Lists the values an object literal gives a member.
 * @param {ts.Expression} object - Returned expression.
 * @param {string} name - Member name.
 * @param {ModuleContext} context - Module of the expression.
 * @returns {Array<{ value: ts.Expression; context: ModuleContext }> | undefined} The values, or `undefined` when the
 * expression is not an object literal whose members can all be named.
 */
function readObjectMemberValues(object, name, context) {
  if (!ts.isObjectLiteralExpression(object)) {
    return undefined;
  }
  /** @type {Array<{ value: ts.Expression; context: ModuleContext }>} */
  const values = [];
  for (const property of object.properties) {
    const propertyName = property.name !== undefined && (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) ? property.name.text : undefined;
    if (propertyName === undefined) {
      return undefined;
    }
    if (propertyName !== name) {
      continue;
    }
    if (!ts.isShorthandPropertyAssignment(property) && !ts.isPropertyAssignment(property)) {
      return undefined;
    }
    values.push({ value: ts.isShorthandPropertyAssignment(property) ? property.name : property.initializer, context });
  }
  return values;
}

/**
 * Checks whether the object URL that react-doctor reports is kept in React state or in a ref, and the module or one
 * it imports from the project revokes object URLs.
 * @param {string} filePath - Path of the file, relative to the project.
 * @param {number} line - 1-based line of the `URL.createObjectURL` call.
 * @param {number} column - 1-based column of the call.
 * @param {SourceReader} readSource - Reads files of the project.
 * @returns {boolean} Whether the URL has an owner that can release it.
 */
export function storesRevokedObjectUrl(filePath, line, column, readSource) {
  const found = findCallAt(filePath, line, column, readSource);
  if (found === undefined || !isUrlCall(found.call, "createObjectURL") || !revokesNearby(found.context, readSource)) {
    return false;
  }
  return isStored(found.call, { context: found.context, readSource, visited: new Set(), depth: 0 });
}
