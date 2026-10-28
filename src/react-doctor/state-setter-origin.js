/**
 * @module react-doctor/state-setter-origin Decides whether a callback that react-doctor's
 * `no-prop-callback-in-render` reports is the `useState` setter of the component that renders. The rule takes any
 * callback a hook receives as a parameter for a callback of the parent, but a hook can receive the setter of the
 * same component through other hooks (`useMilestoneStep(..., setters.setStep)`), and updating the own state during
 * render behind a guard is a pattern React documents. The value is followed through `const`s, destructuring,
 * object literals, `useMemo`, the returns of local functions and every call site of local, non-exported functions;
 * anything else (props, imports, context, mutable values) counts as a callback of someone else.
 */
import ts from "typescript";
import { findCallAt } from "./project-modules.js";
import { findDeclaration, listReferences, unwrapExpression } from "./source-scope.js";

/** @typedef {import("./project-modules.js").SourceReader} SourceReader */

/** Values followed before giving up, so a cycle cannot loop forever. */
const MAX_DEPTH = 24;

/** React hooks whose second returned element sets the state of the component that calls them. */
const STATE_HOOKS = new Set(["useState", "useReducer"]);

/**
 * Where a value comes from: the setter of a state hook, or an object literal whose properties can be followed.
 * @typedef {{ kind: "setter" } | { kind: "object"; node: ts.ObjectLiteralExpression }} Origin
 */

/**
 * @typedef {object} Trace
 * @property {ts.SourceFile} sourceFile - Module being followed.
 * @property {Set<ts.Node>} visited - Declarations and calls already on the path, to stop cycles.
 * @property {number} depth - Values followed so far.
 */

/**
 * Reads the React export a name refers to: `useState` imported from `react` (maybe renamed), or `React.useState`.
 * @param {ts.Expression} callee - Callee of a call.
 * @returns {string | undefined} The exported name, or `undefined` when it does not come from `react`.
 */
function readReactExport(callee) {
  const value = unwrapExpression(callee);
  let local;
  if (ts.isIdentifier(value)) {
    local = value;
  } else if (ts.isPropertyAccessExpression(value) && ts.isIdentifier(value.expression)) {
    local = value.expression;
  }
  const declaration = local === undefined ? undefined : findDeclaration(local);
  const declared = declaration?.parent;
  if (declared === undefined) {
    return undefined;
  }
  let importDeclaration;
  let exported;
  if (ts.isImportSpecifier(declared) && ts.isIdentifier(value)) {
    importDeclaration = declared.parent.parent.parent;
    exported = (declared.propertyName ?? declared.name).text;
  } else if ((ts.isImportClause(declared) || ts.isNamespaceImport(declared)) && ts.isPropertyAccessExpression(value)) {
    importDeclaration = ts.isImportClause(declared) ? declared.parent : declared.parent.parent;
    exported = value.name.text;
  }
  return importDeclaration !== undefined &&
    ts.isStringLiteral(importDeclaration.moduleSpecifier) &&
    importDeclaration.moduleSpecifier.text === "react"
    ? exported
    : undefined;
}

/**
 * Lists the expressions a function returns, in its own body.
 * @param {ts.SignatureDeclaration} callable - Function.
 * @returns {ts.Expression[] | undefined} The returned expressions, or `undefined` when some return has no value.
 */
function listReturnedExpressions(callable) {
  const body = "body" in callable ? callable.body : undefined;
  if (body === undefined) {
    return undefined;
  }
  if (!ts.isBlock(body)) {
    return [/** @type {ts.Expression} */ (body)];
  }
  /** @type {ts.Expression[]} */
  const returned = [];
  let complete = true;
  /** @param {ts.Node} node - Node to visit. */
  const visit = (node) => {
    if (ts.isFunctionLike(node)) {
      return;
    }
    if (ts.isReturnStatement(node)) {
      if (node.expression === undefined) {
        complete = false;
      } else {
        returned.push(node.expression);
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(body, visit);
  return complete && returned.length > 0 ? returned : undefined;
}

/**
 * Reads the function a callee names when the module declares it: a function declaration or a `const` holding one.
 * @param {ts.Expression} callee - Callee.
 * @returns {ts.SignatureDeclaration | undefined} The function, when it is neither async nor a generator.
 */
function resolveCalledFunction(callee) {
  const value = unwrapExpression(callee);
  const declaration = ts.isIdentifier(value) ? findDeclaration(value) : undefined;
  const declared = declaration?.parent;
  let callable;
  if (declared !== undefined && ts.isFunctionDeclaration(declared)) {
    callable = declared;
  } else if (declared !== undefined && ts.isVariableDeclaration(declared) && isConstDeclaration(declared) && declared.initializer !== undefined) {
    const initializer = unwrapExpression(declared.initializer);
    callable = ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer) ? initializer : undefined;
  }
  const isAsync = callable?.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword) ?? false;
  return callable === undefined || isAsync || callable.asteriskToken !== undefined ? undefined : callable;
}

/**
 * Checks whether a variable declaration is `const`.
 * @param {ts.VariableDeclaration} declaration - Declaration.
 * @returns {boolean} Whether its list is `const`.
 */
function isConstDeclaration(declaration) {
  return ts.isVariableDeclarationList(declaration.parent) && (declaration.parent.flags & ts.NodeFlags.Const) !== 0;
}

/**
 * Follows a value to its origins.
 * @param {ts.Expression} expression - Value.
 * @param {Trace} trace - State of the search.
 * @returns {Origin[] | undefined} Every origin it can have, or `undefined` when one cannot be proven.
 */
function valueOrigins(expression, trace) {
  if (trace.depth >= MAX_DEPTH) {
    return undefined;
  }
  const next = { ...trace, depth: trace.depth + 1 };
  const value = unwrapExpression(expression);
  if (ts.isIdentifier(value)) {
    return identifierOrigins(value, next);
  }
  if (ts.isPropertyAccessExpression(value)) {
    return propertyOrigins(valueOrigins(value.expression, next), value.name.text, next);
  }
  if (ts.isObjectLiteralExpression(value)) {
    return [{ kind: "object", node: value }];
  }
  if (!ts.isCallExpression(value)) {
    return undefined;
  }
  if (readReactExport(value.expression) === "useMemo") {
    const factory = value.arguments[0] === undefined ? undefined : unwrapExpression(value.arguments[0]);
    return factory !== undefined && (ts.isArrowFunction(factory) || ts.isFunctionExpression(factory))
      ? returnedOrigins(factory, next)
      : undefined;
  }
  const called = resolveCalledFunction(value.expression);
  return called === undefined ? undefined : returnedOrigins(called, next);
}

/**
 * Follows the values a function returns.
 * @param {ts.SignatureDeclaration} callable - Function.
 * @param {Trace} trace - State of the search.
 * @returns {Origin[] | undefined} Their origins.
 */
function returnedOrigins(callable, trace) {
  if (trace.visited.has(callable)) {
    return undefined;
  }
  const visited = new Set(trace.visited).add(callable);
  const returned = listReturnedExpressions(callable);
  return returned === undefined ? undefined : unionOrigins(returned.map((expression) => valueOrigins(expression, { ...trace, visited })));
}

/**
 * Joins the origins of several values.
 * @param {Array<Origin[] | undefined>} groups - Origins of each value.
 * @returns {Origin[] | undefined} All of them, or `undefined` when one is unknown.
 */
function unionOrigins(groups) {
  return groups.every((group) => group !== undefined) ? groups.flat() : undefined;
}

/**
 * Reads the step a binding element adds to its pattern: a property name or an array index.
 * @param {ts.BindingElement} element - Element of a destructuring pattern.
 * @returns {string | number | undefined} The step, or `undefined` for a computed name or a rest element.
 */
function readBindingStep(element) {
  if (element.dotDotDotToken !== undefined) {
    return undefined;
  }
  const pattern = element.parent;
  if (ts.isArrayBindingPattern(pattern)) {
    return pattern.elements.indexOf(element);
  }
  const name = element.propertyName ?? element.name;
  return ts.isIdentifier(name) || ts.isStringLiteral(name) ? name.text : undefined;
}

/**
 * Follows a variable to its origins.
 * @param {ts.Identifier} identifier - Name at its point of use.
 * @param {Trace} trace - State of the search.
 * @returns {Origin[] | undefined} Its origins.
 */
function identifierOrigins(identifier, trace) {
  const declaration = findDeclaration(identifier);
  if (declaration === undefined || trace.visited.has(declaration)) {
    return undefined;
  }
  const next = { ...trace, visited: new Set(trace.visited).add(declaration) };
  /** @type {Array<string | number>} */
  const path = [];
  /** @type {ts.Node} */
  let owner = declaration.parent;
  while (ts.isBindingElement(owner)) {
    const step = readBindingStep(owner);
    if (step === undefined) {
      return undefined;
    }
    path.unshift(step);
    owner = owner.parent.parent;
  }
  if (ts.isVariableDeclaration(owner) && isConstDeclaration(owner) && owner.initializer !== undefined) {
    const initializer = unwrapExpression(owner.initializer);
    if (path.length === 1 && path[0] === 1 && ts.isCallExpression(initializer) && STATE_HOOKS.has(readReactExport(initializer.expression) ?? "")) {
      return [{ kind: "setter" }];
    }
    return followPath(valueOrigins(initializer, next), path, next);
  }
  if (ts.isParameter(owner)) {
    return parameterOrigins(owner, path, next);
  }
  return undefined;
}

/**
 * Applies the property steps of a destructuring pattern to some origins.
 * @param {Origin[] | undefined} origins - Origins of the destructured value.
 * @param {Array<string | number>} path - Steps of the pattern.
 * @param {Trace} trace - State of the search.
 * @returns {Origin[] | undefined} Origins of the bound value.
 */
function followPath(origins, path, trace) {
  let current = origins;
  for (const step of path) {
    current = typeof step === "string" ? propertyOrigins(current, step, trace) : undefined;
  }
  return current;
}

/**
 * Follows a property of some objects.
 * @param {Origin[] | undefined} origins - Origins of the object.
 * @param {string} name - Property read.
 * @param {Trace} trace - State of the search.
 * @returns {Origin[] | undefined} Origins of the property value.
 */
function propertyOrigins(origins, name, trace) {
  if (origins === undefined || writesProperty(trace.sourceFile, name)) {
    return undefined;
  }
  return unionOrigins(
    origins.map((origin) => {
      if (origin.kind !== "object") {
        return undefined;
      }
      const { properties } = origin.node;
      // A spread or a computed name may set the property too.
      if (properties.some((property) => ts.isSpreadAssignment(property) || (property.name !== undefined && ts.isComputedPropertyName(property.name)))) {
        return undefined;
      }
      const property = properties.findLast((candidate) => candidate.name !== undefined && (ts.isIdentifier(candidate.name) || ts.isStringLiteral(candidate.name)) && candidate.name.text === name);
      if (property !== undefined && ts.isShorthandPropertyAssignment(property)) {
        return identifierOrigins(property.name, trace);
      }
      return property !== undefined && ts.isPropertyAssignment(property) ? valueOrigins(property.initializer, trace) : undefined;
    }),
  );
}

/**
 * Checks whether a module may write a property of some object: `x.name = ...`, `x["name"] = ...`, a computed write
 * (`x[key] = ...`), `delete`, or `Object.assign`/`Object.defineProperty`.
 * @param {ts.SourceFile} sourceFile - Module.
 * @param {string} name - Property name.
 * @returns {boolean} Whether some statement may change it.
 */
function writesProperty(sourceFile, name) {
  /** @param {ts.Expression} target - Written expression. */
  const isTarget = (target) => {
    const value = unwrapExpression(target);
    if (ts.isPropertyAccessExpression(value)) {
      return value.name.text === name;
    }
    if (ts.isElementAccessExpression(value)) {
      const key = unwrapExpression(value.argumentExpression);
      return !(ts.isStringLiteral(key) || ts.isNumericLiteral(key)) || key.text === name;
    }
    return false;
  };
  let writes = false;
  /** @param {ts.Node} node - Node to visit. */
  const visit = (node) => {
    if (writes) {
      return;
    }
    writes =
      (ts.isBinaryExpression(node) &&
        node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
        node.operatorToken.kind <= ts.SyntaxKind.LastAssignment &&
        isTarget(node.left)) ||
      (ts.isDeleteExpression(node) && isTarget(node.expression)) ||
      (ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        ts.isIdentifier(node.expression.expression) &&
        node.expression.expression.text === "Object" &&
        ["assign", "defineProperty", "defineProperties"].includes(node.expression.name.text));
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return writes;
}

/**
 * Reads the name a function is called by in its module, when no other module can call it.
 * @param {ts.SignatureDeclaration} callable - Function.
 * @returns {ts.Identifier | undefined} Declaring identifier of a function declaration or a `const`, not exported.
 */
function readLocalFunctionName(callable) {
  const isExported = (/** @type {ts.Node} */ node) =>
    ts.canHaveModifiers(node) && (ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ?? false);
  if (ts.isFunctionDeclaration(callable)) {
    return callable.name !== undefined && !isExported(callable) ? callable.name : undefined;
  }
  const declaration = callable.parent;
  if (ts.isVariableDeclaration(declaration) && ts.isIdentifier(declaration.name) && isConstDeclaration(declaration) && declaration.initializer !== undefined && unwrapExpression(declaration.initializer) === callable) {
    const statement = declaration.parent.parent;
    return ts.isVariableStatement(statement) && isExported(statement) ? undefined : declaration.name;
  }
  return undefined;
}

/**
 * Follows a parameter to the arguments of every call of its function. The function must be local and only called:
 * a function passed as a value, exported or used as a component may receive anything.
 * @param {ts.ParameterDeclaration} parameter - Parameter.
 * @param {Array<string | number>} path - Destructuring steps inside the parameter.
 * @param {Trace} trace - State of the search.
 * @returns {Origin[] | undefined} Origins of the bound value.
 */
function parameterOrigins(parameter, path, trace) {
  const callable = parameter.parent;
  const index = callable.parameters.indexOf(parameter);
  const name = parameter.dotDotDotToken === undefined ? readLocalFunctionName(callable) : undefined;
  if (name === undefined) {
    return undefined;
  }
  const references = listReferences(trace.sourceFile, name);
  const calls = references.map((reference) => {
    const call = reference.parent;
    return ts.isCallExpression(call) && call.expression === reference ? call : undefined;
  });
  if (calls.length === 0 || calls.some((call) => call === undefined)) {
    return undefined;
  }
  return unionOrigins(
    calls.map((call) => {
      const argumentsBefore = /** @type {ts.CallExpression} */ (call).arguments.slice(0, index + 1);
      const argument = argumentsBefore[index];
      if (argument === undefined || argumentsBefore.some((candidate) => ts.isSpreadElement(candidate))) {
        return undefined;
      }
      return followPath(valueOrigins(argument, trace), path, trace);
    }),
  );
}

/**
 * Checks whether the callback that react-doctor reports as a prop callback called during render is the state setter
 * of the component that renders.
 * @param {string} filePath - Path of the file, relative to the project.
 * @param {number} line - 1-based line of the call.
 * @param {number} column - 1-based column of the call.
 * @param {SourceReader} readSource - Reads files of the project.
 * @returns {boolean} Whether every value the callee can hold is a `useState` or `useReducer` setter reached through
 * calls of the same render.
 */
export function callsOwnStateSetter(filePath, line, column, readSource) {
  const found = findCallAt(filePath, line, column, readSource);
  if (found === undefined) {
    return false;
  }
  const origins = valueOrigins(found.call.expression, { sourceFile: found.context.sourceFile, visited: new Set(), depth: 0 });
  return origins !== undefined && origins.length > 0 && origins.every((origin) => origin.kind === "setter");
}
