/**
 * @module react-doctor/effect-cancellation Decides whether an effect cancels its asynchronous work before it writes
 * state. react-doctor's `no-set-state-after-await-in-effect` accepts a guard on a flag that the cleanup flips, but
 * not one combined with a call (`if (!isActive || isAbortError(error)) return;`) nor `signal.aborted` of an
 * `AbortController` that the cleanup aborts. This module checks every asynchronous function the effect can run and
 * accepts the effect only when no call after an `await` can run once the cleanup has run.
 */
import ts from "typescript";
import { parseModule } from "./project-modules.js";
import { containsOwn, findDeclaration, listReferences, unwrapExpression } from "./source-scope.js";

/** @typedef {import("./project-modules.js").SourceReader} SourceReader */

/** Hooks whose callback runs after the render commits and returns the cleanup. */
const EFFECT_HOOKS = new Set(["useEffect", "useLayoutEffect", "useInsertionEffect"]);

/** Calls of a member that may write React state even though the callee is not a plain name. */
const MEMBER_SETTER_PATTERN = /^(?:set[A-Z]|dispatch$)/u;

/**
 * @typedef {object} Cancellation
 * @property {Map<ts.Identifier, boolean>} flags - `let` flags of the effect and the value each cleanup gives them.
 * @property {Set<ts.Identifier>} controllers - `AbortController`s of the effect that each cleanup aborts.
 * @property {Set<ts.Identifier>} signals - `const signal = controller.signal` of those controllers.
 */

/**
 * @typedef {object} FlowState
 * @property {boolean} exposed - Whether an `await` ran since the last guard, so the cleanup may have run.
 * @property {boolean} unsafe - Whether a call that may write state can run after the cleanup.
 * @property {boolean} exits - Whether every path returns or throws.
 */

/**
 * Reads the effect callback of a hook call: `useEffect(() => { ... })` or `React.useEffect(...)`.
 * @param {ts.Node} node - Candidate call.
 * @returns {ts.ArrowFunction | ts.FunctionExpression | undefined} The callback, when it has a block body.
 */
function readEffectCallback(node) {
  if (!ts.isCallExpression(node)) {
    return undefined;
  }
  const callee = unwrapExpression(node.expression);
  let name = "";
  if (ts.isIdentifier(callee)) {
    name = callee.text;
  } else if (ts.isPropertyAccessExpression(callee)) {
    name = callee.name.text;
  }
  const callback = node.arguments[0] === undefined ? undefined : unwrapExpression(node.arguments[0]);
  return EFFECT_HOOKS.has(name) &&
    callback !== undefined &&
    (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback)) &&
    ts.isBlock(callback.body)
    ? callback
    : undefined;
}

/**
 * Checks whether a node runs code when it is evaluated: a call, a `new`, an `await` or a tagged template outside
 * nested functions.
 * @param {ts.Node} node - Statement or expression.
 * @returns {boolean} Whether evaluating it may start work.
 */
function startsWork(node) {
  return containsOwn(
    node,
    (candidate) =>
      ts.isCallExpression(candidate) ||
      ts.isNewExpression(candidate) ||
      ts.isAwaitExpression(candidate) ||
      ts.isTaggedTemplateExpression(candidate),
  );
}

/**
 * Lists the cleanup functions an effect returns. Returns without a cleanup are accepted only before the effect
 * starts any work, as an early exit (`if (!enabled) return undefined;`).
 * @param {ts.ArrowFunction | ts.FunctionExpression} effect - Effect callback.
 * @returns {Array<ts.ArrowFunction | ts.FunctionExpression> | undefined} The cleanups, or `undefined` when some path
 * returns another value or leaves started work without one.
 */
function listCleanups(effect) {
  const body = /** @type {ts.Block} */ (effect.body);
  /** @type {Array<ts.ArrowFunction | ts.FunctionExpression>} */
  const cleanups = [];
  let lastBareReturn = -1;
  let valid = true;
  body.statements.forEach((statement, index) => {
    /** @param {ts.Node} node - Node to visit. */
    const visit = (node) => {
      if (ts.isFunctionLike(node)) {
        return;
      }
      if (ts.isReturnStatement(node)) {
        const value = node.expression === undefined ? undefined : unwrapExpression(node.expression);
        if (value !== undefined && (ts.isArrowFunction(value) || ts.isFunctionExpression(value))) {
          cleanups.push(value);
        } else if (value === undefined || (ts.isIdentifier(value) && value.text === "undefined" && findDeclaration(value) === undefined)) {
          lastBareReturn = index;
        } else {
          valid = false;
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(statement);
  });
  const workStartsBeforeExit = body.statements.slice(0, lastBareReturn + 1).some((statement) => startsWork(statement));
  // Falling off the end of the callback leaves the started work without a cleanup.
  const last = body.statements.at(-1);
  const endsWithCleanup = last !== undefined && ts.isReturnStatement(last) && last.expression !== undefined && cleanups.includes(/** @type {ts.ArrowFunction} */ (unwrapExpression(last.expression)));
  return valid && endsWithCleanup && !workStartsBeforeExit ? cleanups : undefined;
}

/**
 * Lists the statements a cleanup always runs: the top-level statements of its body, or its expression body.
 * @param {ts.ArrowFunction | ts.FunctionExpression} cleanup - Cleanup function.
 * @returns {ts.Expression[]} Expressions it evaluates unconditionally.
 */
function listUnconditionalExpressions(cleanup) {
  if (!ts.isBlock(cleanup.body)) {
    return [cleanup.body];
  }
  /** @type {ts.Expression[]} */
  const expressions = [];
  for (const statement of cleanup.body.statements) {
    if (!ts.isExpressionStatement(statement)) {
      // A later statement may not run once an earlier one returns or throws; stop at the first other statement.
      break;
    }
    expressions.push(statement.expression);
  }
  return expressions;
}

/**
 * Reads the boolean value of a literal.
 * @param {ts.Expression | undefined} expression - Expression.
 * @returns {boolean | undefined} `true` or `false`, or `undefined` when it is not a boolean literal.
 */
function readBoolean(expression) {
  if (expression === undefined) {
    return undefined;
  }
  const value = unwrapExpression(expression);
  if (value.kind === ts.SyntaxKind.TrueKeyword) {
    return true;
  }
  return value.kind === ts.SyntaxKind.FalseKeyword ? false : undefined;
}

/**
 * Checks whether an expression writes a binding: an assignment, `++`/`--`, or a destructuring target.
 * @param {ts.Identifier} reference - Use of the binding.
 * @returns {ts.Node | undefined} The writing expression, or `undefined` when the use only reads it.
 */
function findWrite(reference) {
  /** @type {ts.Node} */
  let target = reference;
  let { parent } = reference;
  while (
    ts.isParenthesizedExpression(parent) ||
    ts.isArrayLiteralExpression(parent) ||
    ts.isShorthandPropertyAssignment(parent) ||
    (ts.isPropertyAssignment(parent) && parent.initializer === target) ||
    ts.isObjectLiteralExpression(parent) ||
    ts.isSpreadElement(parent)
  ) {
    target = parent;
    parent = parent.parent;
  }
  if (
    ts.isBinaryExpression(parent) &&
    parent.left === target &&
    parent.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
    parent.operatorToken.kind <= ts.SyntaxKind.LastAssignment
  ) {
    return parent;
  }
  if (
    (ts.isPrefixUnaryExpression(parent) || ts.isPostfixUnaryExpression(parent)) &&
    (parent.operator === ts.SyntaxKind.PlusPlusToken || parent.operator === ts.SyntaxKind.MinusMinusToken)
  ) {
    return parent;
  }
  if ((ts.isForOfStatement(parent) || ts.isForInStatement(parent)) && parent.initializer === target) {
    return parent;
  }
  return undefined;
}

/**
 * @typedef {object} EffectScope
 * @property {ts.ArrowFunction | ts.FunctionExpression} effect - Effect callback.
 * @property {ts.Expression[][]} cleanupExpressions - Expressions each cleanup evaluates unconditionally.
 */

/**
 * Finds the cancellation signals of an effect: `let` flags that every cleanup sets and nothing else writes, and
 * `AbortController`s that every cleanup aborts.
 * @param {ts.ArrowFunction | ts.FunctionExpression} effect - Effect callback.
 * @param {Array<ts.ArrowFunction | ts.FunctionExpression>} cleanups - Its cleanups.
 * @returns {Cancellation} The flags, controllers and signals.
 */
function findCancellation(effect, cleanups) {
  const body = /** @type {ts.Block} */ (effect.body);
  /** @type {Cancellation} */
  const cancellation = { flags: new Map(), controllers: new Set(), signals: new Set() };
  const scope = { effect, cleanupExpressions: cleanups.map((cleanup) => listUnconditionalExpressions(cleanup)) };
  for (const statement of body.statements) {
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        addCancellationSignal(declaration, scope, cancellation);
      }
    }
  }
  return cancellation;
}

/**
 * Records a top-level variable of the effect when it tells that the cleanup ran.
 * @param {ts.VariableDeclaration} declaration - Variable of the effect body.
 * @param {EffectScope} scope - Effect and its cleanups.
 * @param {Cancellation} cancellation - Signals found so far, updated in place.
 */
function addCancellationSignal(declaration, scope, cancellation) {
  if (!ts.isIdentifier(declaration.name) || declaration.initializer === undefined) {
    return;
  }
  const { name } = declaration;
  const listFlags = declaration.parent.flags;
  const initial = readBoolean(declaration.initializer);
  if ((listFlags & ts.NodeFlags.Let) !== 0 && initial !== undefined) {
    if (flipsFlag(scope, name, !initial)) {
      cancellation.flags.set(name, !initial);
    }
    return;
  }
  if ((listFlags & ts.NodeFlags.Const) === 0) {
    return;
  }
  const initializer = unwrapExpression(declaration.initializer);
  if (isAbortControllerConstruction(initializer) && abortsController(name, scope.cleanupExpressions)) {
    cancellation.controllers.add(name);
  } else if (readsControllerSignal(initializer, cancellation)) {
    cancellation.signals.add(name);
  }
}

/**
 * Checks whether an expression reads `signal` of a controller that every cleanup aborts.
 * @param {ts.Expression} expression - Expression.
 * @param {Cancellation} cancellation - Signals found so far.
 * @returns {boolean} Whether it is `controller.signal` of such a controller.
 */
function readsControllerSignal(expression, cancellation) {
  if (!ts.isPropertyAccessExpression(expression) || expression.name.text !== "signal") {
    return false;
  }
  const owner = unwrapExpression(expression.expression);
  const controller = ts.isIdentifier(owner) ? findDeclaration(owner) : undefined;
  return controller !== undefined && cancellation.controllers.has(controller);
}

/**
 * Checks whether an expression builds the global `AbortController`.
 * @param {ts.Expression} expression - Initializer.
 * @returns {boolean} Whether it is `new AbortController()` with the global constructor.
 */
function isAbortControllerConstruction(expression) {
  return (
    ts.isNewExpression(expression) &&
    ts.isIdentifier(expression.expression) &&
    expression.expression.text === "AbortController" &&
    findDeclaration(expression.expression) === undefined
  );
}

/**
 * Checks whether every cleanup sets a flag to its cancelled value and nothing else in the effect writes it.
 * @param {EffectScope} scope - Effect and its cleanups.
 * @param {ts.Identifier} flag - Declaring identifier of the flag.
 * @param {boolean} cancelledValue - Value the cleanup must give it.
 * @returns {boolean} Whether the flag reliably tells that the cleanup ran.
 */
function flipsFlag({ effect, cleanupExpressions }, flag, cancelledValue) {
  /** @param {ts.Expression} expression - Expression of a cleanup. */
  const isFlip = (expression) =>
    ts.isBinaryExpression(expression) &&
    expression.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
    ts.isIdentifier(unwrapExpression(expression.left)) &&
    findDeclaration(/** @type {ts.Identifier} */ (unwrapExpression(expression.left))) === flag &&
    readBoolean(expression.right) === cancelledValue;
  const flips = new Set(cleanupExpressions.flatMap((expressions) => expressions.filter((expression) => isFlip(expression))));
  return (
    cleanupExpressions.every((expressions) => expressions.some((expression) => isFlip(expression))) &&
    listReferences(effect, flag).every((reference) => {
      const write = findWrite(reference);
      return write === undefined || flips.has(/** @type {ts.Expression} */ (write));
    })
  );
}

/**
 * Checks whether every cleanup calls `controller.abort()`.
 * @param {ts.Identifier} controller - Declaring identifier of the controller.
 * @param {ts.Expression[][]} cleanupExpressions - Unconditional expressions of each cleanup.
 * @returns {boolean} Whether each cleanup aborts it.
 */
function abortsController(controller, cleanupExpressions) {
  return cleanupExpressions.every((expressions) =>
    expressions.some((expression) => {
      const call = unwrapExpression(expression);
      if (!ts.isCallExpression(call) || !ts.isPropertyAccessExpression(call.expression) || call.expression.name.text !== "abort") {
        return false;
      }
      const owner = unwrapExpression(call.expression.expression);
      return ts.isIdentifier(owner) && findDeclaration(owner) === controller;
    }),
  );
}

/**
 * Reads a `&&` or `||` expression.
 * @param {ts.Expression} value - Unwrapped expression.
 * @returns {{ left: ts.Expression; right: ts.Expression; isOr: boolean } | undefined} Its operands and operator.
 */
function readLogical(value) {
  if (!ts.isBinaryExpression(value)) {
    return undefined;
  }
  const { kind } = value.operatorToken;
  return kind === ts.SyntaxKind.BarBarToken || kind === ts.SyntaxKind.AmpersandAmpersandToken
    ? { left: value.left, right: value.right, isOr: kind === ts.SyntaxKind.BarBarToken }
    : undefined;
}

/**
 * Checks whether an expression reads a flag of the effect whose value after the cleanup is the one given.
 * @param {ts.Expression} value - Unwrapped expression.
 * @param {Cancellation} cancellation - Cancellation signals of the effect.
 * @param {boolean} cancelledValue - Value the cleanup gives the flag.
 * @returns {boolean} Whether it is such a flag.
 */
function readsFlag(value, cancellation, cancelledValue) {
  const declaration = ts.isIdentifier(value) ? findDeclaration(value) : undefined;
  return declaration !== undefined && cancellation.flags.get(declaration) === cancelledValue;
}

/**
 * Checks whether an expression reads `aborted` of a signal whose controller every cleanup aborts:
 * `controller.signal.aborted` or `signal.aborted`.
 * @param {ts.Expression} value - Unwrapped expression.
 * @param {Cancellation} cancellation - Cancellation signals of the effect.
 * @returns {boolean} Whether it is such a read.
 */
function readsAbortedSignal(value, cancellation) {
  if (!ts.isPropertyAccessExpression(value) || value.name.text !== "aborted") {
    return false;
  }
  const signal = unwrapExpression(value.expression);
  if (ts.isIdentifier(signal)) {
    const declaration = findDeclaration(signal);
    return declaration !== undefined && cancellation.signals.has(declaration);
  }
  return readsControllerSignal(signal, cancellation);
}

/**
 * Checks whether an expression is true whenever the cleanup has run: a cancelled flag, `signal.aborted` of an
 * aborted controller, or a combination that keeps that guarantee.
 * @param {ts.Expression} expression - Condition.
 * @param {Cancellation} cancellation - Cancellation signals of the effect.
 * @returns {boolean} Whether a false value proves the cleanup has not run.
 */
function isCancelledCheck(expression, cancellation) {
  const value = unwrapExpression(expression);
  if (ts.isPrefixUnaryExpression(value) && value.operator === ts.SyntaxKind.ExclamationToken) {
    return isActiveCheck(value.operand, cancellation);
  }
  const logical = readLogical(value);
  if (logical !== undefined) {
    const left = isCancelledCheck(logical.left, cancellation);
    const right = isCancelledCheck(logical.right, cancellation);
    return logical.isOr ? left || right : left && right;
  }
  return readsFlag(value, cancellation, true) || readsAbortedSignal(value, cancellation);
}

/**
 * Checks whether an expression is true only while the cleanup has not run: the negation of a cancelled check, or a
 * flag that the cleanup sets to `false`.
 * @param {ts.Expression} expression - Condition.
 * @param {Cancellation} cancellation - Cancellation signals of the effect.
 * @returns {boolean} Whether a true value proves the cleanup has not run.
 */
function isActiveCheck(expression, cancellation) {
  const value = unwrapExpression(expression);
  if (ts.isPrefixUnaryExpression(value) && value.operator === ts.SyntaxKind.ExclamationToken) {
    return isCancelledCheck(value.operand, cancellation);
  }
  const logical = readLogical(value);
  if (logical !== undefined) {
    const left = isActiveCheck(logical.left, cancellation);
    const right = isActiveCheck(logical.right, cancellation);
    return logical.isOr ? left && right : left || right;
  }
  return readsFlag(value, cancellation, false);
}

/**
 * Checks whether a call may write React state: a call of a plain name (a setter, or a function that calls one) or
 * of a member named like a setter.
 * @param {ts.CallExpression} call - Call.
 * @returns {boolean} Whether it counts as a state write.
 */
function mayWriteState(call) {
  const callee = unwrapExpression(call.expression);
  return ts.isIdentifier(callee) || (ts.isPropertyAccessExpression(callee) && MEMBER_SETTER_PATTERN.test(callee.name.text));
}

/**
 * Follows `a && b`, `a || b` or `a ?? b`: the right operand runs only when the left one allows it, so a left operand
 * that rules out the cleanup protects it.
 * @param {ts.BinaryExpression} node - Expression.
 * @param {boolean} exposed - Whether the cleanup may have run before it.
 * @param {Cancellation} cancellation - Cancellation signals of the effect.
 * @returns {{ exposed: boolean; unsafe: boolean }} The state after it.
 */
function scanShortCircuit(node, exposed, cancellation) {
  const left = scanExpression(node.left, exposed, cancellation);
  const { kind } = node.operatorToken;
  const plainLeft = !exposedByOwnAwait(node.left);
  const guarded =
    plainLeft &&
    ((kind === ts.SyntaxKind.BarBarToken && isCancelledCheck(node.left, cancellation)) ||
      (kind === ts.SyntaxKind.AmpersandAmpersandToken && isActiveCheck(node.left, cancellation)));
  const right = scanExpression(node.right, guarded ? false : left.exposed, cancellation);
  return { exposed: left.exposed || right.exposed, unsafe: left.unsafe || right.unsafe };
}

/**
 * Follows a ternary: a branch that only runs while the cleanup has not run starts protected.
 * @param {ts.ConditionalExpression} node - Expression.
 * @param {boolean} exposed - Whether the cleanup may have run before it.
 * @param {Cancellation} cancellation - Cancellation signals of the effect.
 * @returns {{ exposed: boolean; unsafe: boolean }} The state after it.
 */
function scanConditional(node, exposed, cancellation) {
  const condition = scanExpression(node.condition, exposed, cancellation);
  const plainCondition = !exposedByOwnAwait(node.condition);
  const trueEntry = plainCondition && isActiveCheck(node.condition, cancellation) ? false : condition.exposed;
  const falseEntry = plainCondition && isCancelledCheck(node.condition, cancellation) ? false : condition.exposed;
  const whenTrue = scanExpression(node.whenTrue, trueEntry, cancellation);
  const whenFalse = scanExpression(node.whenFalse, falseEntry, cancellation);
  return {
    exposed: whenTrue.exposed || whenFalse.exposed,
    unsafe: condition.unsafe || whenTrue.unsafe || whenFalse.unsafe,
  };
}

/**
 * Checks whether a binary expression short-circuits its right operand.
 * @param {ts.Node} node - Expression.
 * @returns {node is ts.BinaryExpression} Whether it is `&&`, `||` or `??`.
 */
function isShortCircuit(node) {
  return (
    ts.isBinaryExpression(node) &&
    (node.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
      node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
      node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)
  );
}

/**
 * Follows the evaluation of an expression: an `await` exposes what follows to the cleanup, a guard in `&&`, `||` or
 * a ternary protects its other operand, and a call that may write state is unsafe while exposed.
 * @param {ts.Node} node - Expression.
 * @param {boolean} exposed - Whether the cleanup may have run before it.
 * @param {Cancellation} cancellation - Cancellation signals of the effect.
 * @returns {{ exposed: boolean; unsafe: boolean }} The state after it.
 */
function scanExpression(node, exposed, cancellation) {
  if (ts.isFunctionLike(node) || ts.isClassLike(node)) {
    return { exposed, unsafe: false };
  }
  if (ts.isAwaitExpression(node)) {
    return { exposed: true, unsafe: scanExpression(node.expression, exposed, cancellation).unsafe };
  }
  if (isShortCircuit(node)) {
    return scanShortCircuit(node, exposed, cancellation);
  }
  if (ts.isConditionalExpression(node)) {
    return scanConditional(node, exposed, cancellation);
  }
  let state = { exposed, unsafe: false };
  ts.forEachChild(node, (child) => {
    const next = scanExpression(child, state.exposed, cancellation);
    state = { exposed: next.exposed, unsafe: state.unsafe || next.unsafe };
  });
  return ts.isCallExpression(node) && state.exposed && mayWriteState(node) ? { exposed: true, unsafe: true } : state;
}

/**
 * Checks whether an expression contains an `await` of its own function.
 * @param {ts.Node} node - Expression.
 * @returns {boolean} Whether evaluating it suspends the function.
 */
function exposedByOwnAwait(node) {
  return containsOwn(node, (candidate) => ts.isAwaitExpression(candidate));
}

/**
 * Merges the states of the branches that continue after a statement.
 * @param {FlowState[]} branches - States at the end of each branch.
 * @returns {FlowState} State after the statement.
 */
function mergeBranches(branches) {
  const continuing = branches.filter((branch) => !branch.exits);
  return {
    exposed: continuing.some((branch) => branch.exposed),
    unsafe: branches.some((branch) => branch.unsafe),
    exits: continuing.length === 0,
  };
}

/**
 * Follows the statements of a block in order.
 * @param {readonly ts.Statement[]} statements - Statements.
 * @param {boolean} exposed - Whether the cleanup may have run before them.
 * @param {Cancellation} cancellation - Cancellation signals of the effect.
 * @returns {FlowState} State after them.
 */
function scanStatements(statements, exposed, cancellation) {
  /** @type {FlowState} */
  let state = { exposed, unsafe: false, exits: false };
  for (const statement of statements) {
    if (state.exits) {
      break;
    }
    const next = scanStatement(statement, state.exposed, cancellation);
    state = { exposed: next.exposed, unsafe: state.unsafe || next.unsafe, exits: next.exits };
    if (state.unsafe) {
      break;
    }
  }
  return state;
}

/**
 * Follows a `try` statement: the `catch` can start after any `await` of the `try`, and the `finally` after any of
 * both.
 * @param {ts.TryStatement} statement - Statement.
 * @param {boolean} exposed - Whether the cleanup may have run before it.
 * @param {Cancellation} cancellation - Cancellation signals of the effect.
 * @returns {FlowState} State after it.
 */
function scanTry(statement, exposed, cancellation) {
  const tryState = scanStatements(statement.tryBlock.statements, exposed, cancellation);
  const catchEntry = exposed || exposedByOwnAwait(statement.tryBlock);
  const catchState =
    statement.catchClause === undefined
      ? undefined
      : scanStatements(statement.catchClause.block.statements, catchEntry, cancellation);
  const branches = catchState === undefined ? [tryState] : [tryState, catchState];
  const merged = mergeBranches(branches);
  if (statement.finallyBlock === undefined) {
    return merged;
  }
  const finallyEntry =
    catchEntry || (statement.catchClause !== undefined && exposedByOwnAwait(statement.catchClause.block)) || merged.exposed;
  const finallyState = scanStatements(statement.finallyBlock.statements, finallyEntry, cancellation);
  return {
    exposed: finallyState.exposed,
    unsafe: merged.unsafe || finallyState.unsafe,
    exits: finallyState.exits || merged.exits,
  };
}

/**
 * Follows an `if` statement: a branch that only runs while the cleanup has not run starts protected, and an early
 * exit on a cancelled check protects what follows.
 * @param {ts.IfStatement} statement - Statement.
 * @param {boolean} exposed - Whether the cleanup may have run before it.
 * @param {Cancellation} cancellation - Cancellation signals of the effect.
 * @returns {FlowState} State after it.
 */
function scanIf(statement, exposed, cancellation) {
  const condition = scanExpression(statement.expression, exposed, cancellation);
  const plainCondition = !exposedByOwnAwait(statement.expression);
  const thenEntry = plainCondition && isActiveCheck(statement.expression, cancellation) ? false : condition.exposed;
  const elseEntry = plainCondition && isCancelledCheck(statement.expression, cancellation) ? false : condition.exposed;
  const thenState = scanStatement(statement.thenStatement, thenEntry, cancellation);
  const elseState =
    statement.elseStatement === undefined
      ? { exposed: elseEntry, unsafe: false, exits: false }
      : scanStatement(statement.elseStatement, elseEntry, cancellation);
  const merged = mergeBranches([thenState, elseState]);
  return { ...merged, unsafe: merged.unsafe || condition.unsafe };
}

/**
 * Follows a loop or a `switch`: any `await` inside can precede any statement inside, on a later iteration or case.
 * @param {ts.Node} statement - Loop or `switch`.
 * @param {boolean} exposed - Whether the cleanup may have run before it.
 * @param {Cancellation} cancellation - Cancellation signals of the effect.
 * @returns {FlowState} State after it.
 */
function scanRepeated(statement, exposed, cancellation) {
  const entry =
    exposed || exposedByOwnAwait(statement) || (ts.isForOfStatement(statement) && statement.awaitModifier !== undefined);
  let unsafe = false;
  let after = entry;
  ts.forEachChild(statement, (child) => {
    const state = ts.isStatement(child) || ts.isCaseBlock(child) ? scanBlockLike(child, entry, cancellation) : scanExpression(child, entry, cancellation);
    unsafe ||= state.unsafe;
    after ||= state.exposed;
  });
  return { exposed: after, unsafe, exits: false };
}

/**
 * Follows a statement or the clauses of a `switch` inside a loop or a `switch`.
 * @param {ts.Node} node - Statement or case block.
 * @param {boolean} entry - Whether the cleanup may have run before it.
 * @param {Cancellation} cancellation - Cancellation signals of the effect.
 * @returns {FlowState} State after it.
 */
function scanBlockLike(node, entry, cancellation) {
  if (ts.isCaseBlock(node)) {
    const states = node.clauses.map((clause) => {
      const test = ts.isCaseClause(clause) ? scanExpression(clause.expression, entry, cancellation) : { exposed: entry, unsafe: false };
      const body = scanStatements(clause.statements, entry, cancellation);
      return { exposed: test.exposed || body.exposed, unsafe: test.unsafe || body.unsafe, exits: false };
    });
    return { exposed: entry || states.some((state) => state.exposed), unsafe: states.some((state) => state.unsafe), exits: false };
  }
  return scanStatement(/** @type {ts.Statement} */ (node), entry, cancellation);
}

/**
 * Follows a statement.
 * @param {ts.Statement} statement - Statement.
 * @param {boolean} exposed - Whether the cleanup may have run before it.
 * @param {Cancellation} cancellation - Cancellation signals of the effect.
 * @returns {FlowState} State after it.
 */
function scanStatement(statement, exposed, cancellation) {
  if (ts.isBlock(statement)) {
    return scanStatements(statement.statements, exposed, cancellation);
  }
  if (ts.isReturnStatement(statement) || ts.isThrowStatement(statement)) {
    const value = statement.expression === undefined ? { exposed, unsafe: false } : scanExpression(statement.expression, exposed, cancellation);
    return { exposed: value.exposed, unsafe: value.unsafe, exits: true };
  }
  if (ts.isIfStatement(statement)) {
    return scanIf(statement, exposed, cancellation);
  }
  if (ts.isTryStatement(statement)) {
    return scanTry(statement, exposed, cancellation);
  }
  if (ts.isLabeledStatement(statement)) {
    return scanStatement(statement.statement, exposed, cancellation);
  }
  if (ts.isIterationStatement(statement, false) || ts.isSwitchStatement(statement)) {
    return scanRepeated(statement, exposed, cancellation);
  }
  if (ts.isBreakOrContinueStatement(statement)) {
    // Where a `break` lands is not followed: count every later statement as reachable from here.
    return { exposed, unsafe: false, exits: false };
  }
  const state = scanExpression(statement, exposed, cancellation);
  return { ...state, exits: false };
}

/**
 * Reads the function a name refers to, when the module declares it: a function declaration, a `const` that holds a
 * function, or a `const` that holds `useCallback(fn, deps)`.
 * @param {ts.Identifier} name - Callee at its point of use.
 * @returns {ts.SignatureDeclaration | undefined} The function.
 */
function resolveLocalFunction(name) {
  const declaration = findDeclaration(name);
  const declared = declaration?.parent;
  if (declared === undefined) {
    return undefined;
  }
  if (ts.isFunctionDeclaration(declared)) {
    return declared;
  }
  if (!ts.isVariableDeclaration(declared) || declared.initializer === undefined) {
    return undefined;
  }
  const initializer = unwrapExpression(declared.initializer);
  if (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer)) {
    return initializer;
  }
  const wrapped = ts.isCallExpression(initializer) && initializer.arguments[0] !== undefined ? unwrapExpression(initializer.arguments[0]) : undefined;
  return wrapped !== undefined && (ts.isArrowFunction(wrapped) || ts.isFunctionExpression(wrapped)) ? wrapped : undefined;
}

/**
 * Lists the functions an effect can run: the functions it declares and the functions of the module it calls, also
 * transitively.
 * @param {ts.ArrowFunction | ts.FunctionExpression} effect - Effect callback.
 * @returns {ts.SignatureDeclaration[]} The functions, the effect included.
 */
function listReachableFunctions(effect) {
  /** @type {Set<ts.SignatureDeclaration>} */
  const reached = new Set();
  /** @type {ts.SignatureDeclaration[]} */
  const pending = [effect];
  while (pending.length > 0) {
    const current = /** @type {ts.SignatureDeclaration} */ (pending.pop());
    if (reached.has(current)) {
      continue;
    }
    reached.add(current);
    /** @param {ts.Node} node - Node to visit. */
    const visit = (node) => {
      if (node !== current && ts.isFunctionLike(node)) {
        pending.push(node);
      }
      if (ts.isCallExpression(node) && ts.isIdentifier(unwrapExpression(node.expression))) {
        const callee = resolveLocalFunction(/** @type {ts.Identifier} */ (unwrapExpression(node.expression)));
        if (callee !== undefined) {
          pending.push(callee);
        }
      }
      ts.forEachChild(node, visit);
    };
    ts.forEachChild(current, visit);
  }
  return [...reached];
}

/**
 * Checks whether a function is `async`.
 * @param {ts.SignatureDeclaration} candidate - Function.
 * @returns {boolean} Whether it has the `async` modifier.
 */
function isAsyncFunction(candidate) {
  return (
    ts.canHaveModifiers(candidate) &&
    (ts.getModifiers(candidate)?.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword) ?? false)
  );
}

/**
 * Checks whether the effect of a `useEffect` call cancels its asynchronous work before every call that may write
 * state after an `await`.
 * @param {string} filePath - Path of the file, relative to the project.
 * @param {number} line - 1-based line of the hook call.
 * @param {number} column - 1-based column of the hook call.
 * @param {SourceReader} readSource - Reads files of the project.
 * @returns {boolean} Whether no state write of its asynchronous functions can run after the cleanup.
 */
export function cancelsBeforeStateWrites(filePath, line, column, readSource) {
  const context = parseModule(filePath, readSource);
  if (context === undefined) {
    return false;
  }
  const call = findEffectCall(context.sourceFile, line, column);
  const effect = call === undefined ? undefined : readEffectCallback(call);
  const cleanups = effect === undefined ? undefined : listCleanups(effect);
  if (effect === undefined || cleanups === undefined) {
    return false;
  }
  const cancellation = findCancellation(effect, cleanups);
  const asyncFunctions = listReachableFunctions(effect).filter(
    (candidate) => isAsyncFunction(candidate) && "body" in candidate && candidate.body !== undefined,
  );
  return (
    asyncFunctions.length > 0 &&
    asyncFunctions.every((asyncFunction) => {
      const body = /** @type {ts.Node} */ (/** @type {{ body: ts.Node }} */ (asyncFunction).body);
      const state = ts.isBlock(body)
        ? scanStatements(body.statements, false, cancellation)
        : scanExpression(body, false, cancellation);
      return !state.unsafe;
    })
  );
}

/**
 * Finds the hook call react-doctor reports, by its start, or the only effect hook call of the line.
 * @param {ts.SourceFile} sourceFile - Parsed module.
 * @param {number} line - 1-based line.
 * @param {number} column - 1-based column.
 * @returns {ts.CallExpression | undefined} The call.
 */
function findEffectCall(sourceFile, line, column) {
  /** @type {ts.CallExpression[]} */
  const calls = [];
  /** @param {ts.Node} node - Node to visit. */
  const visit = (node) => {
    if (ts.isCallExpression(node) && readEffectCallback(node) !== undefined) {
      const start = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
      if (start.line + 1 === line) {
        calls.push(node);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  const exact = calls.find(
    (candidate) => sourceFile.getLineAndCharacterOfPosition(candidate.getStart(sourceFile)).character + 1 === column,
  );
  return exact ?? (calls.length === 1 ? calls[0] : undefined);
}

