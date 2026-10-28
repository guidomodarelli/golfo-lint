/**
 * @module react-doctor/finally-reset Decides whether a loading flag reset runs on rejection as well as on success.
 * react-doctor's `no-loading-flag-reset-outside-finally` also reports a reset inside `finally` when an `if` guards
 * it, unless it recognizes the guard as an ownership check. A `finally` runs on both paths, so the reset runs on
 * rejection exactly when it runs on success as long as its condition does not depend on how the `try` ended: the
 * condition must not read anything the `try` or the `catch` assigns. Writes made by functions they call are not
 * followed: an ownership check (`if (controller.current === current)`) reads a ref that only a newer run replaces,
 * and a newer run reaches its own `finally`.
 */
import ts from "typescript";
import { findCallAt } from "./project-modules.js";
import { containsOwn, findDeclaration, isVariableReference, unwrapExpression } from "./source-scope.js";

/** @typedef {import("./project-modules.js").SourceReader} SourceReader */

/**
 * A place a condition reads or a statement writes: a variable, maybe followed by properties (`ref.current`).
 * @typedef {object} AccessPath
 * @property {ts.Identifier | string} root - Declaring identifier of the variable, or its name for a global.
 * @property {string[]} properties - Properties read after it; `*` stands for a computed one.
 */

/**
 * Reads the access path of an expression: `name`, `name.a.b`, `name[i]`.
 * @param {ts.Expression} expression - Expression.
 * @returns {AccessPath | undefined} The path, or `undefined` when it does not start at a variable.
 */
function readAccessPath(expression) {
  const value = unwrapExpression(expression);
  if (ts.isIdentifier(value)) {
    return { root: findDeclaration(value) ?? value.text, properties: [] };
  }
  if (ts.isPropertyAccessExpression(value) || ts.isElementAccessExpression(value)) {
    const owner = readAccessPath(value.expression);
    const property = ts.isPropertyAccessExpression(value) ? value.name.text : "*";
    return owner === undefined ? undefined : { root: owner.root, properties: [...owner.properties, property] };
  }
  return undefined;
}

/**
 * Checks whether a write to one path can change the value read from another: same variable, and one path extends
 * the other.
 * @param {AccessPath} read - Path read by the condition.
 * @param {AccessPath} written - Path written by the `try` or the `catch`.
 * @returns {boolean} Whether they may overlap.
 */
function overlaps(read, written) {
  if (read.root !== written.root) {
    return false;
  }
  const shared = Math.min(read.properties.length, written.properties.length);
  return read.properties
    .slice(0, shared)
    .every((property, index) => property === "*" || written.properties[index] === "*" || property === written.properties[index]);
}

/**
 * Lists the paths a node assigns, also inside nested functions it declares.
 * @param {ts.Node} root - `try` block or `catch` clause.
 * @returns {AccessPath[] | undefined} The paths, or `undefined` when a target cannot be read as a path.
 */
function listWrittenPaths(root) {
  /** @type {AccessPath[]} */
  const paths = [];
  let readable = true;
  /** @param {ts.Expression} target - Assigned expression or destructuring pattern. */
  const addTarget = (target) => {
    const value = unwrapExpression(target);
    if (ts.isArrayLiteralExpression(value)) {
      value.elements.forEach((element) => addTarget(ts.isSpreadElement(element) ? element.expression : element));
      return;
    }
    if (ts.isObjectLiteralExpression(value)) {
      for (const property of value.properties) {
        if (ts.isShorthandPropertyAssignment(property)) {
          addTarget(property.name);
        } else if (ts.isPropertyAssignment(property)) {
          addTarget(property.initializer);
        } else if (ts.isSpreadAssignment(property)) {
          addTarget(property.expression);
        } else {
          readable = false;
        }
      }
      return;
    }
    if (ts.isBinaryExpression(value) && value.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      addTarget(value.left);
      return;
    }
    const path = readAccessPath(value);
    if (path === undefined) {
      readable = false;
    } else {
      paths.push(path);
    }
  };
  /** @param {ts.Node} node - Node to visit. */
  const visit = (node) => {
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
      node.operatorToken.kind <= ts.SyntaxKind.LastAssignment
    ) {
      addTarget(node.left);
    } else if (
      (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
      (node.operator === ts.SyntaxKind.PlusPlusToken || node.operator === ts.SyntaxKind.MinusMinusToken)
    ) {
      addTarget(node.operand);
    } else if (ts.isDeleteExpression(node)) {
      addTarget(node.expression);
    } else if ((ts.isForOfStatement(node) || ts.isForInStatement(node)) && !ts.isVariableDeclarationList(node.initializer)) {
      addTarget(node.initializer);
    }
    ts.forEachChild(node, visit);
  };
  visit(root);
  return readable ? paths : undefined;
}

/**
 * Lists the paths a condition reads. A condition with a call, an `await`, `this` or a nested function may read
 * anything, so it gives `undefined`.
 * @param {ts.Expression} condition - Condition.
 * @returns {AccessPath[] | undefined} The paths read.
 */
function listReadPaths(condition) {
  const opaque = containsOwn(
    condition,
    (node) =>
      ts.isCallExpression(node) ||
      ts.isNewExpression(node) ||
      ts.isAwaitExpression(node) ||
      ts.isTaggedTemplateExpression(node) ||
      node.kind === ts.SyntaxKind.ThisKeyword ||
      (node !== condition && ts.isFunctionLike(node)),
  );
  if (opaque) {
    return undefined;
  }
  /** @type {AccessPath[]} */
  const paths = [];
  /** @param {ts.Node} node - Node to visit. */
  const visit = (node) => {
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node) || (ts.isIdentifier(node) && isVariableReference(node))) {
      const path = readAccessPath(/** @type {ts.Expression} */ (node));
      if (path !== undefined) {
        paths.push(path);
        if (ts.isElementAccessExpression(node)) {
          visit(node.argumentExpression);
        }
        return;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(condition);
  return paths;
}

/**
 * Lists the conditions that decide whether a node of a `finally` block runs: the tests of the `if`s, ternaries and
 * `&&`/`||` that contain it. Statements that can leave the block before it, and loops or `switch`es around it, make
 * the answer unknown.
 * @param {ts.Node} node - Reset call.
 * @param {ts.Block} finallyBlock - `finally` block that contains it.
 * @returns {ts.Expression[] | undefined} The conditions.
 */
function listGuards(node, finallyBlock) {
  /** @type {ts.Expression[]} */
  const guards = [];
  /** @type {ts.Node} */
  let current = node;
  while (current !== finallyBlock) {
    const parent = current.parent;
    if (ts.isIfStatement(parent) && parent.expression !== current) {
      guards.push(parent.expression);
    } else if (ts.isConditionalExpression(parent) && parent.condition !== current) {
      guards.push(parent.condition);
    } else if (ts.isBinaryExpression(parent) && parent.right === current && isLogicalOperator(parent.operatorToken.kind)) {
      guards.push(parent.left);
    } else if (ts.isBlock(parent)) {
      const index = parent.statements.indexOf(/** @type {ts.Statement} */ (current));
      const leaves = parent.statements.slice(0, index).some((statement) =>
        containsOwn(statement, (candidate) => ts.isReturnStatement(candidate) || ts.isThrowStatement(candidate) || ts.isBreakOrContinueStatement(candidate)),
      );
      if (leaves) {
        return undefined;
      }
    } else if (ts.isIterationStatement(parent, false) || ts.isCaseClause(parent) || ts.isDefaultClause(parent) || ts.isTryStatement(parent) || ts.isFunctionLike(parent)) {
      return undefined;
    }
    current = parent;
  }
  return guards;
}

/**
 * Checks whether an operator short-circuits its right operand.
 * @param {ts.SyntaxKind} kind - Operator.
 * @returns {boolean} Whether it is `&&`, `||` or `??`.
 */
function isLogicalOperator(kind) {
  return (
    kind === ts.SyntaxKind.AmpersandAmpersandToken ||
    kind === ts.SyntaxKind.BarBarToken ||
    kind === ts.SyntaxKind.QuestionQuestionToken
  );
}

/**
 * Checks whether the reset that react-doctor reports runs in a `finally` block under conditions that do not depend
 * on how the `try` ended.
 * @param {string} filePath - Path of the file, relative to the project.
 * @param {number} line - 1-based line of the reset call.
 * @param {number} column - 1-based column of the reset call.
 * @param {SourceReader} readSource - Reads files of the project.
 * @returns {boolean} Whether it runs on rejection whenever it runs on success.
 */
export function resetsInFinally(filePath, line, column, readSource) {
  const call = findCallAt(filePath, line, column, readSource)?.call;
  if (call === undefined) {
    return false;
  }
  /** @type {ts.Node} */
  let current = call;
  while (!ts.isSourceFile(current.parent) && !ts.isFunctionLike(current.parent)) {
    const parent = current.parent;
    if (ts.isTryStatement(parent) && parent.finallyBlock === current) {
      return isIndependentOfOutcome(call, parent);
    }
    current = parent;
  }
  return false;
}

/**
 * Checks whether the conditions of a reset in a `finally` read nothing that its `try` or `catch` assigns.
 * @param {ts.Node} call - Reset call.
 * @param {ts.TryStatement} statement - `try` statement whose `finally` contains it.
 * @returns {boolean} Whether the reset runs the same on success and on rejection.
 */
function isIndependentOfOutcome(call, statement) {
  const guards = listGuards(call, /** @type {ts.Block} */ (statement.finallyBlock));
  const tryWrites = listWrittenPaths(statement.tryBlock);
  const catchWrites = statement.catchClause === undefined ? [] : listWrittenPaths(statement.catchClause);
  if (guards === undefined || tryWrites === undefined || catchWrites === undefined) {
    return false;
  }
  const written = [...tryWrites, ...catchWrites];
  return guards.every((guard) => {
    const read = listReadPaths(guard);
    return read !== undefined && read.every((path) => written.every((write) => !overlaps(path, write)));
  });
}
