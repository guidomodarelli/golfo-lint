/**
 * @module bun-lint/unnecessary-condition-filter Drops the reports of `@typescript-eslint/no-unnecessary-condition`
 * that rest on types TypeScript cannot know, from the JSON report of `bun lint`, which runs the rule natively but
 * cannot run the preset's own `golfo-lint/no-unnecessary-condition` (it gives no types to plugin rules). The checks
 * read the code only, without a type checker, so they keep a report only when the code shows the type can be
 * trusted:
 * - a property the same function checked before, which an `await`, a call or another write can change
 *   (`if (signal.aborted) return; await fetch(...); if (signal.aborted) ...`); on a `const` local, only a check
 *   against `null`, `undefined` or with `typeof` counts, since a truthiness check narrows the object;
 * - a `let` or `var` that code assigns again (in a callback, a cleanup) and that the same function narrowed before
 *   the read;
 * - a global of the host environment, which code checks to detect features (`globalThis.crypto?.randomUUID`);
 * - without `noUncheckedIndexedAccess`, an element read by index (`items[0]`, `countsById[id]`) or a variable that
 *   holds one (`const first = items[0]`, `const [first] = items`).
 */
import path from "node:path";
import globals from "globals";
import ts from "typescript";

/** Rule whose reports this module filters. */
export const UNNECESSARY_CONDITION_RULE = "@typescript-eslint/no-unnecessary-condition";

/** Reports about the truthiness or nullishness of a value, the ones control-flow narrowing can fake. */
const NARROWABLE_MESSAGE_IDS = new Set(["alwaysTruthy", "alwaysFalsy", "alwaysNullish", "neverNullish", "never"]);

/** Report about an optional chain on a value whose type cannot be nullish; it points at the `?.` token. */
const OPTIONAL_CHAIN_MESSAGE_ID = "neverOptionalChain";

/** Report about a comparison whose operands have types that cannot be equal (`record[key] !== undefined`). */
const NO_OVERLAP_MESSAGE_ID = "noOverlapBooleanExpression";

/**
 * Globals of the host environment. Their types say every API is there, but code checks them on purpose: a browser
 * API is missing on the server, in old browsers or outside secure contexts.
 */
const HOST_GLOBALS = new Set(["globalThis", "window", "self", "document", "navigator", ...Object.keys(globals.browser)]);

/**
 * @typedef {object} LintMessage
 * @property {string | null} ruleId - Rule that reported it.
 * @property {string} [messageId] - Message of the rule.
 * @property {number} line - 1-based line where the report starts.
 * @property {number} column - 1-based column where the report starts.
 * @property {number} [endLine] - 1-based line where the report ends.
 * @property {number} [endColumn] - 1-based column where the report ends.
 */

/**
 * @typedef {object} FileContext
 * @property {ts.SourceFile} sourceFile - Parsed file.
 * @property {boolean} checksIndexedAccess - Whether its tsconfig turns on `noUncheckedIndexedAccess`.
 */

/**
 * Converts a 1-based line and column into an offset of the file.
 * @param {ts.SourceFile} sourceFile - Parsed file.
 * @param {number} line - 1-based line.
 * @param {number} column - 1-based column.
 * @returns {number} Offset.
 */
function toOffset(sourceFile, line, column) {
  // A file edited after `bun lint` read it may be shorter than the report says: clamp instead of failing.
  const lineStarts = sourceFile.getLineStarts();
  const lineIndex = Math.min(Math.max(line - 1, 0), lineStarts.length - 1);
  const lineEnd = lineIndex + 1 < lineStarts.length ? lineStarts[lineIndex + 1] : sourceFile.text.length;
  return Math.min(lineStarts[lineIndex] + Math.max(column - 1, 0), lineEnd);
}

/**
 * Finds the deepest node that spans exactly a range, or else the smallest node that contains it.
 * @param {ts.SourceFile} sourceFile - Parsed file.
 * @param {number} start - Offset where the range starts.
 * @param {number} end - Offset where the range ends.
 * @returns {ts.Node} The node.
 */
function findNodeAt(sourceFile, start, end) {
  /** @type {ts.Node} */
  let found = sourceFile;
  /** @param {ts.Node} node - Node to visit. */
  const visit = (node) => {
    const nodeStart = node.getStart(sourceFile);
    if (nodeStart <= start && node.end >= end) {
      found = node;
      ts.forEachChild(node, visit);
    }
  };
  ts.forEachChild(sourceFile, visit);
  return found;
}

/**
 * Moves from the name of a member access to the whole access: `bun lint` may point at `aborted` in
 * `signal.aborted`.
 * @param {ts.Node} node - Node at the reported range.
 * @returns {ts.Node} The member access, or the same node.
 */
function widenPropertyName(node) {
  const { parent } = node;
  return parent !== undefined && ts.isPropertyAccessExpression(parent) && parent.name === node ? parent : node;
}

/**
 * Strips the wrappers that do not change which value a report is about: `!`, `x!`, `as` and parentheses.
 * @param {ts.Node} node - Reported expression.
 * @returns {ts.Node} The value whose type the rule judged.
 */
function unwrapCheckedValue(node) {
  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.ExclamationToken) {
    return unwrapCheckedValue(node.operand);
  }
  if (ts.isParenthesizedExpression(node) || ts.isNonNullExpression(node) || ts.isAsExpression(node)) {
    return unwrapCheckedValue(node.expression);
  }
  return node;
}

/**
 * Finds the values a report is about.
 * @param {ts.SourceFile} sourceFile - Parsed file.
 * @param {LintMessage} message - Report of the rule.
 * @returns {ts.Node[]} The values; none when the report is not about the type of a value.
 */
function findCheckedValues(sourceFile, message) {
  const start = toOffset(sourceFile, message.line, message.column);
  const end = toOffset(sourceFile, message.endLine ?? message.line, message.endColumn ?? message.column);
  if (message.messageId === OPTIONAL_CHAIN_MESSAGE_ID) {
    // The report points at `?.`: the value is what the chain link reads from.
    const link = findNodeAt(sourceFile, start, start);
    /** @type {ts.Node | undefined} */
    let current = link;
    while (current !== undefined && !hasQuestionDotAt(current, start)) {
      current = current.parent;
    }
    return current === undefined
      ? []
      : [unwrapCheckedValue(/** @type {{ expression: ts.Node }} */ (/** @type {unknown} */ (current)).expression)];
  }
  const node = widenPropertyName(findNodeAt(sourceFile, start, end));
  if (message.messageId === NO_OVERLAP_MESSAGE_ID && ts.isBinaryExpression(node)) {
    return [unwrapCheckedValue(node.left), unwrapCheckedValue(node.right)];
  }
  return message.messageId !== undefined && NARROWABLE_MESSAGE_IDS.has(message.messageId) ? [unwrapCheckedValue(node)] : [];
}

/**
 * Checks whether a chain link has its `?.` at an offset.
 * @param {ts.Node} node - Candidate link.
 * @param {number} offset - Offset of the reported `?.`.
 * @returns {boolean} Whether it is the link the report is about.
 */
function hasQuestionDotAt(node, offset) {
  const questionDot = /** @type {{ questionDotToken?: ts.Node }} */ (node).questionDotToken;
  return (
    (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node) || ts.isCallExpression(node)) &&
    questionDot !== undefined &&
    questionDot.getStart() === offset
  );
}

/**
 * Returns the value a member access or call reads from: `target` in `target.id`, `target?.id` or `target.load()`.
 * @param {ts.Node} node - Link of a chain.
 * @returns {ts.Node | undefined} The previous link, or `undefined` at the start of the chain.
 */
function chainObject(node) {
  if (
    ts.isNonNullExpression(node) ||
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isPropertyAccessExpression(node) ||
    ts.isElementAccessExpression(node) ||
    ts.isCallExpression(node)
  ) {
    return node.expression;
  }
  return undefined;
}

/**
 * Writes a member path the same way whether it uses `?.`, `!` or a static bracket: `user?.profile!["name"]` is
 * `user.profile.name`.
 * @param {ts.Node} node - Member access or identifier.
 * @returns {string | undefined} The path, or `undefined` when it is not made of names.
 */
function memberPath(node) {
  if (ts.isIdentifier(node) || node.kind === ts.SyntaxKind.ThisKeyword) {
    return node.getText();
  }
  if (ts.isNonNullExpression(node) || ts.isParenthesizedExpression(node)) {
    return memberPath(node.expression);
  }
  const name = memberName(node);
  if (name === undefined) {
    return undefined;
  }
  const objectPath = memberPath(/** @type {ts.PropertyAccessExpression | ts.ElementAccessExpression} */ (node).expression);
  return objectPath === undefined ? undefined : `${objectPath}.${name}`;
}

/**
 * Reads the property name of a member access: `aborted` in `signal.aborted` and in `signal["aborted"]`.
 * @param {ts.Node} node - Candidate member access.
 * @returns {string | undefined} The name, or `undefined` when the node is not a member access with a static name.
 */
function memberName(node) {
  if (ts.isPropertyAccessExpression(node)) {
    return node.name.text;
  }
  if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression)) {
    return node.argumentExpression.text;
  }
  return undefined;
}

/**
 * Finds the function or file a node belongs to.
 * @param {ts.Node} node - Node of the file.
 * @returns {ts.Node} Its innermost function, or the file.
 */
function enclosingFunction(node) {
  /** @type {ts.Node | undefined} */
  let current = node.parent;
  while (current !== undefined && !ts.isFunctionLike(current) && !ts.isSourceFile(current)) {
    current = current.parent;
  }
  return current ?? node.getSourceFile();
}

/** Operators whose left operand TypeScript narrows for the right one. */
const NARROWING_OPERATORS = new Set([
  ts.SyntaxKind.AmpersandAmpersandToken,
  ts.SyntaxKind.BarBarToken,
  ts.SyntaxKind.QuestionQuestionToken,
  ts.SyntaxKind.EqualsEqualsToken,
  ts.SyntaxKind.EqualsEqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsToken,
  ts.SyntaxKind.ExclamationEqualsEqualsToken,
  ts.SyntaxKind.InstanceOfKeyword,
]);

/**
 * Checks whether a read narrows its type for the code after it: it is checked (in a condition, a ternary, a
 * comparison, `&&`, `||` or `??`) or assigned.
 * @param {ts.Node} read - Earlier read of the same path.
 * @returns {boolean} Whether it narrows.
 */
function narrowsType(read) {
  /** @type {ts.Node} */
  let node = read;
  while (node.parent !== undefined) {
    const verdict = narrowingVerdict(node.parent, node);
    if (verdict !== undefined) {
      return verdict;
    }
    node = node.parent;
  }
  return false;
}

/**
 * Decides what an expression's parent says about narrowing.
 * @param {ts.Node} parent - Parent of the expression.
 * @param {ts.Node} node - The expression, or a wrapper of the read.
 * @returns {boolean | undefined} `true` when the parent narrows it, `false` when it does not, `undefined` when the
 * parent only wraps it (`!`, parentheses, `typeof`) and the next parent decides.
 */
function narrowingVerdict(parent, node) {
  if (ts.isBinaryExpression(parent)) {
    if (parent.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      return parent.left === node;
    }
    if (NARROWING_OPERATORS.has(parent.operatorToken.kind)) {
      return true;
    }
  }
  if (isConditionOf(parent, node) || isAssertionArgument(parent, node)) {
    return true;
  }
  const passesThrough =
    ts.isParenthesizedExpression(parent) ||
    ts.isNonNullExpression(parent) ||
    ts.isTypeOfExpression(parent) ||
    (ts.isPrefixUnaryExpression(parent) && parent.operator === ts.SyntaxKind.ExclamationToken);
  return passesThrough ? undefined : false;
}

/**
 * Checks whether an expression is the argument of a call whose result is discarded (`assert(!signal.aborted);`), the
 * shape of an `asserts value` function, which narrows its argument for the code after it. Without types the filter
 * cannot read the signature, so every such call counts.
 * @param {ts.Node} parent - Candidate call.
 * @param {ts.Node} node - Candidate argument.
 * @returns {boolean} Whether `node` is an argument of a call used as a statement.
 */
function isAssertionArgument(parent, node) {
  return (
    ts.isCallExpression(parent) &&
    parent.arguments.some((argument) => argument === node) &&
    ts.isExpressionStatement(parent.parent)
  );
}

/**
 * Checks whether an expression is the condition of a statement or a ternary.
 * @param {ts.Node} parent - Statement or expression.
 * @param {ts.Node} node - Candidate condition.
 * @returns {boolean} Whether `node` is its condition.
 */
function isConditionOf(parent, node) {
  if (ts.isIfStatement(parent) || ts.isWhileStatement(parent) || ts.isDoStatement(parent) || ts.isSwitchStatement(parent)) {
    return parent.expression === node;
  }
  return (ts.isConditionalExpression(parent) || ts.isForStatement(parent)) && parent.condition === node;
}

/**
 * Checks whether a declaration list is `const` (or `using`), whose bindings cannot be reassigned.
 * @param {ts.Node} list - Parent of a variable declaration.
 * @returns {boolean} Whether its bindings are constant.
 */
function isConstList(list) {
  return ts.isVariableDeclarationList(list) && (list.flags & ts.NodeFlags.BlockScoped) !== 0 &&
    (list.flags & ts.NodeFlags.Let) === 0;
}

/**
 * Lists the reads of a member path or name that come before a node in the same function, skipping nested
 * functions, whose narrowing does not reach it.
 * @param {ts.Node} node - Reported read.
 * @param {(candidate: ts.Node) => boolean} matches - Whether a node reads the same path.
 * @returns {ts.Node[]} Earlier reads, in order.
 */
function earlierReadsInFunction(node, matches) {
  const scope = enclosingFunction(node);
  const readStart = node.getStart();
  /** @type {ts.Node[]} */
  const reads = [];
  /** @param {ts.Node} candidate - Node to visit. */
  const visit = (candidate) => {
    if (candidate.getStart() >= readStart || ts.isFunctionLike(candidate)) {
      return;
    }
    if (candidate.end <= readStart && matches(candidate)) {
      reads.push(candidate);
    }
    ts.forEachChild(candidate, visit);
  };
  const body = ts.isFunctionLike(scope) ? /** @type {{ body?: ts.Node }} */ (/** @type {unknown} */ (scope)).body : undefined;
  ts.forEachChild(body ?? scope, visit);
  return reads;
}

/**
 * Checks whether a property read got its type from narrowing an `await`, a call or another write can make wrong:
 * the same function checked the same path before. Without types, a check on a discriminated union (`if (!result.ok)`)
 * looks the same, so those reports go too.
 * @param {ts.Node} node - Property read.
 * @returns {boolean} Whether its type may come from stale narrowing.
 */
function isNarrowedPropertyRead(node) {
  if (memberName(node) === undefined) {
    return false;
  }
  const readPath = memberPath(node);
  if (readPath === undefined) {
    return false;
  }
  return earlierReadsInFunction(
    node,
    (candidate) => memberName(candidate) !== undefined && memberPath(candidate) === readPath,
  ).some((read) => narrowsType(read));
}

/**
 * Checks whether a binding name or pattern binds a name.
 * @param {ts.BindingName} bindingName - Name or pattern.
 * @param {string} name - Name to find.
 * @returns {ts.Node | undefined} The identifier or binding element that binds it.
 */
function findInBindingName(bindingName, name) {
  if (ts.isIdentifier(bindingName)) {
    return bindingName.text === name ? bindingName : undefined;
  }
  for (const element of bindingName.elements) {
    if (ts.isBindingElement(element)) {
      const found = findInBindingName(element.name, name);
      if (found !== undefined) {
        return ts.isIdentifier(element.name) ? element : found;
      }
    }
  }
  return undefined;
}

/**
 * Finds the declaration a scope gives a name, looking at its own statements, parameters and loop or catch
 * bindings.
 * @param {ts.Node} scope - Block, function, loop, catch clause or file.
 * @param {string} name - Name to find.
 * @returns {ts.Node | undefined} A variable declaration, a binding element, a parameter or another declaration.
 */
function findDeclarationInScope(scope, name) {
  if (ts.isFunctionLike(scope)) {
    return scope.parameters.find((parameter) => findInBindingName(parameter.name, name) !== undefined);
  }
  if (ts.isCatchClause(scope)) {
    const binding = scope.variableDeclaration;
    return binding !== undefined && findInBindingName(binding.name, name) !== undefined ? binding : undefined;
  }
  if (ts.isForStatement(scope) || ts.isForOfStatement(scope) || ts.isForInStatement(scope)) {
    const { initializer } = scope;
    return initializer !== undefined && ts.isVariableDeclarationList(initializer)
      ? findInDeclarations(initializer.declarations, name)
      : undefined;
  }
  if (ts.isBlock(scope) || ts.isSourceFile(scope) || ts.isModuleBlock(scope)) {
    for (const statement of scope.statements) {
      const declaration = findInStatement(statement, name);
      if (declaration !== undefined) {
        return declaration;
      }
    }
  }
  return undefined;
}

/**
 * Finds the declaration of a name in a declaration list.
 * @param {ts.NodeArray<ts.VariableDeclaration>} declarations - Declarations of a `let`, `const` or `var`.
 * @param {string} name - Name to find.
 * @returns {ts.Node | undefined} The variable declaration, or the binding element of a destructured name.
 */
function findInDeclarations(declarations, name) {
  for (const declaration of declarations) {
    const binding = findInBindingName(declaration.name, name);
    if (binding !== undefined) {
      return ts.isBindingElement(binding) ? binding : declaration;
    }
  }
  return undefined;
}

/**
 * Finds the declaration of a name in a statement of a block or file.
 * @param {ts.Statement} statement - Statement.
 * @param {string} name - Name to find.
 * @returns {ts.Node | undefined} The declaration, or `undefined` when the statement does not declare the name.
 */
function findInStatement(statement, name) {
  if (ts.isVariableStatement(statement)) {
    return findInDeclarations(statement.declarationList.declarations, name);
  }
  if (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement) || ts.isEnumDeclaration(statement)) {
    return statement.name?.text === name ? statement : undefined;
  }
  return ts.isImportDeclaration(statement) && importsName(statement, name) ? statement : undefined;
}

/**
 * Checks whether an import declaration binds a local name.
 * @param {ts.ImportDeclaration} statement - Import.
 * @param {string} name - Local name.
 * @returns {boolean} Whether it imports it.
 */
function importsName(statement, name) {
  const clause = statement.importClause;
  if (clause === undefined) {
    return false;
  }
  if (clause.name?.text === name) {
    return true;
  }
  const bindings = clause.namedBindings;
  if (bindings === undefined) {
    return false;
  }
  return ts.isNamespaceImport(bindings)
    ? bindings.name.text === name
    : bindings.elements.some((element) => element.name.text === name);
}

/**
 * Resolves an identifier to its declaration in the file, walking out from the innermost scope.
 * @param {ts.Identifier} identifier - Name at its point of use.
 * @returns {{ declaration: ts.Node; scope: ts.Node } | undefined} The declaration and the scope that holds it, or
 * `undefined` for a global.
 */
function resolveDeclaration(identifier) {
  /** @type {ts.Node | undefined} */
  let scope = identifier.parent;
  while (scope !== undefined) {
    const declaration = findDeclarationInScope(scope, identifier.text);
    if (declaration !== undefined) {
      return { declaration, scope };
    }
    scope = scope.parent;
  }
  return undefined;
}

/**
 * Checks whether a node writes a name: `name = value`, `name += value`, `name++` or `[name] = values`.
 * @param {ts.Node} node - Node that may write.
 * @param {string} name - Variable name.
 * @returns {boolean} Whether it assigns the name.
 */
function assignsName(node, name) {
  if (ts.isBinaryExpression(node) && node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
    node.operatorToken.kind <= ts.SyntaxKind.LastAssignment) {
    return targetsName(node.left, name);
  }
  if ((ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
    (node.operator === ts.SyntaxKind.PlusPlusToken || node.operator === ts.SyntaxKind.MinusMinusToken)) {
    return targetsName(node.operand, name);
  }
  return false;
}

/**
 * Checks whether an assignment target is a name, directly or inside a destructuring pattern.
 * @param {ts.Expression} target - Left side of an assignment.
 * @param {string} name - Variable name.
 * @returns {boolean} Whether it writes the name.
 */
function targetsName(target, name) {
  if (ts.isIdentifier(target)) {
    return target.text === name;
  }
  if (ts.isParenthesizedExpression(target)) {
    return targetsName(target.expression, name);
  }
  if (ts.isArrayLiteralExpression(target)) {
    return target.elements.some((element) => targetsName(ts.isSpreadElement(element) ? element.expression : element, name));
  }
  if (ts.isObjectLiteralExpression(target)) {
    return target.properties.some((property) =>
      ts.isShorthandPropertyAssignment(property)
        ? property.name.text === name
        : ts.isPropertyAssignment(property) && targetsName(property.initializer, name),
    );
  }
  return false;
}

/** Initializers and assigned values whose literal type is narrower than the declared type of a `let`. */
const LITERAL_KINDS = new Set([
  ts.SyntaxKind.TrueKeyword,
  ts.SyntaxKind.FalseKeyword,
  ts.SyntaxKind.NullKeyword,
  ts.SyntaxKind.NumericLiteral,
  ts.SyntaxKind.StringLiteral,
  ts.SyntaxKind.NoSubstitutionTemplateLiteral,
]);

/**
 * Checks whether an expression is a literal that narrows a `let` below its declared type (`let done = false`).
 * @param {ts.Expression | undefined} value - Initializer or assigned value.
 * @returns {boolean} Whether it is such a literal.
 */
function isNarrowingLiteral(value) {
  return value !== undefined && (LITERAL_KINDS.has(value.kind) || (ts.isIdentifier(value) && value.text === "undefined"));
}

/**
 * Checks whether a value is a `let` or `var` whose narrowed type TypeScript cannot follow: code assigns it again
 * (often in a callback, a cleanup or after an `await`), and the same function narrowed it before the read, with a
 * check, a literal assignment or a declaration whose initializer is narrower than its type.
 * @param {ts.Node} node - Value the rule judged.
 * @returns {boolean} Whether its type may come from stale narrowing.
 */
function isNarrowedMutableVariable(node) {
  if (!ts.isIdentifier(node)) {
    return false;
  }
  const resolved = resolveDeclaration(node);
  const declaration = resolved?.declaration;
  if (resolved === undefined || declaration === undefined || !ts.isVariableDeclaration(declaration) ||
    isConstList(declaration.parent)) {
    return false;
  }
  const { text } = node;
  let reassigned = false;
  /** @param {ts.Node} candidate - Node to visit. */
  const visit = (candidate) => {
    if (!reassigned && assignsName(candidate, text)) {
      reassigned = true;
    }
    if (!reassigned) {
      ts.forEachChild(candidate, visit);
    }
  };
  ts.forEachChild(resolved.scope, visit);
  if (!reassigned) {
    return false;
  }
  // TypeScript keeps the narrowing of a declaration inside closures created after it (since TypeScript 5.4), so the
  // declaration counts from any function.
  let narrowed =
    declaration.initializer !== undefined &&
    (declaration.type !== undefined || isNarrowingLiteral(declaration.initializer));
  // Later in the same function, a check or a literal assignment narrows again. Any assignment narrows a variable
  // declared with a union (`let current: Item | undefined; current = await load()` leaves `Item`); without one, a
  // nonliteral assignment gives the variable back its declared type.
  const declaredAsUnion = declaration.type !== undefined && ts.isUnionTypeNode(declaration.type);
  for (const read of earlierReadsInFunction(node, (candidate) => ts.isIdentifier(candidate) && candidate.text === text)) {
    if (isAssignmentTarget(read)) {
      narrowed = declaredAsUnion || isLiteralAssignmentTarget(read);
    } else if (narrowsType(read)) {
      narrowed = true;
    }
  }
  return narrowed;
}

/**
 * Checks whether a name is the target of a plain assignment (`name = value`).
 * @param {ts.Node} read - Occurrence of the name.
 * @returns {boolean} Whether a value is assigned to it there.
 */
function isAssignmentTarget(read) {
  const { parent } = read;
  return (
    parent !== undefined &&
    ts.isBinaryExpression(parent) &&
    parent.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
    parent.left === read
  );
}

/**
 * Checks whether a name is the target of an assignment of a literal (`isCurrent = false`).
 * @param {ts.Node} read - Occurrence of the name.
 * @returns {boolean} Whether a literal is assigned to it there.
 */
function isLiteralAssignmentTarget(read) {
  const { parent } = read;
  return (
    parent !== undefined &&
    ts.isBinaryExpression(parent) &&
    parent.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
    parent.left === read &&
    isNarrowingLiteral(parent.right)
  );
}

/**
 * Checks whether a chain starts at a global of the host environment that the file does not declare itself.
 * @param {ts.Node} node - Link of a chain.
 * @returns {boolean} Whether it is a host global.
 */
function isHostGlobal(node) {
  return ts.isIdentifier(node) && HOST_GLOBALS.has(node.text) && resolveDeclaration(node) === undefined;
}

/**
 * Checks whether an expression reads an element by index (`items[0]`, `countsById[id]`), looking through `??`,
 * `||`, `&&`, ternaries, `as`, `!` and parentheses.
 * @param {ts.Node} expression - Expression to inspect.
 * @returns {boolean} Whether some branch reads by index.
 */
function readsIndexedElement(expression) {
  if (ts.isParenthesizedExpression(expression) || ts.isAsExpression(expression) || ts.isNonNullExpression(expression)) {
    return readsIndexedElement(expression.expression);
  }
  if (ts.isBinaryExpression(expression)) {
    return readsIndexedElement(expression.left) || readsIndexedElement(expression.right);
  }
  if (ts.isConditionalExpression(expression)) {
    return readsIndexedElement(expression.whenTrue) || readsIndexedElement(expression.whenFalse);
  }
  return ts.isElementAccessExpression(expression);
}

/**
 * Checks whether a variable holds an element read by index or taken from an array pattern.
 * @param {ts.Node} node - Value the rule judged.
 * @returns {boolean} Whether its value comes from an index.
 */
function isIndexedElementVariable(node) {
  if (!ts.isIdentifier(node)) {
    return false;
  }
  const declaration = resolveDeclaration(node)?.declaration;
  if (declaration === undefined) {
    return false;
  }
  if (ts.isBindingElement(declaration)) {
    return ts.isArrayBindingPattern(declaration.parent);
  }
  return ts.isVariableDeclaration(declaration) && declaration.initializer !== undefined
    ? readsIndexedElement(declaration.initializer)
    : false;
}

/**
 * Checks every link of a chain: in `target?.id ?? ""` the verdict on `target?.id` rests on the type of `target`.
 * @param {ts.Node} value - Value the rule judged.
 * @param {boolean} checksIndexedAccess - Whether `noUncheckedIndexedAccess` is on.
 * @returns {boolean} Whether some link has a type the code does not show can be trusted.
 */
function isUnreliableChain(value, checksIndexedAccess) {
  /** @type {ts.Node | undefined} */
  let link = value;
  while (link !== undefined) {
    if (isNarrowedPropertyRead(link) || isNarrowedMutableVariable(link) || isHostGlobal(link)) {
      return true;
    }
    if (!checksIndexedAccess && (ts.isElementAccessExpression(link) || isIndexedElementVariable(link))) {
      return true;
    }
    link = chainObject(link);
  }
  return false;
}

/**
 * Decides whether a report of `@typescript-eslint/no-unnecessary-condition` stays.
 * @param {LintMessage} message - Report of `bun lint`.
 * @param {FileContext} file - File it is about.
 * @returns {boolean} Whether the report rests on types the code shows can be trusted.
 */
export function isReliableConditionReport(message, file) {
  if (message.ruleId !== UNNECESSARY_CONDITION_RULE) {
    return true;
  }
  return !findCheckedValues(file.sourceFile, message).some((value) =>
    isUnreliableChain(value, file.checksIndexedAccess),
  );
}

/**
 * Builds a reader of the files a report mentions, which parses each file once and reads `noUncheckedIndexedAccess`
 * from the `tsconfig.json` nearest to it.
 * @param {(filePath: string) => string | undefined} readText - Reads a file by absolute path.
 * @returns {(filePath: string) => FileContext | undefined} The reader; `undefined` when the file cannot be read.
 */
export function createFileContextReader(readText) {
  /** @type {Map<string, boolean>} */
  const indexedAccessByConfig = new Map();
  /** @type {Map<string, FileContext | undefined>} */
  const files = new Map();
  /** @param {string} configPath - Absolute path of a tsconfig. */
  const checksIndexedAccess = (configPath) => {
    if (!indexedAccessByConfig.has(configPath)) {
      const parsed = ts.getParsedCommandLineOfConfigFile(configPath, {}, {
        ...ts.sys,
        onUnRecoverableConfigFileDiagnostic: () => {},
      });
      indexedAccessByConfig.set(configPath, parsed?.options.noUncheckedIndexedAccess === true);
    }
    return indexedAccessByConfig.get(configPath) === true;
  };
  return (filePath) => {
    if (!files.has(filePath)) {
      const text = readText(filePath);
      const configPath = ts.findConfigFile(path.dirname(filePath), ts.sys.fileExists);
      files.set(
        filePath,
        text === undefined
          ? undefined
          : {
              sourceFile: ts.createSourceFile(filePath, text, ts.ScriptTarget.Latest, true, scriptKindOf(filePath)),
              checksIndexedAccess: configPath === undefined ? false : checksIndexedAccess(configPath),
            },
      );
    }
    return files.get(filePath);
  };
}

/**
 * Picks the TypeScript script kind for a file, so JSX parses in `.tsx`.
 * @param {string} filePath - File path.
 * @returns {ts.ScriptKind} Script kind.
 */
function scriptKindOf(filePath) {
  return filePath.endsWith(".tsx") || filePath.endsWith(".jsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
}
