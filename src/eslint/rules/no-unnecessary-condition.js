/**
 * @module eslint/rules/no-unnecessary-condition `@typescript-eslint/no-unnecessary-condition` without the false
 * positives that come from TypeScript's control-flow narrowing. TypeScript keeps a property narrowed after an
 * `await` or a function call, although they can change it: after `if (signal.aborted) return;` and an `await`,
 * `signal.aborted` can be `true` again, but the type says `false` and the rule reports the check as always falsy.
 * Without `noUncheckedIndexedAccess`, a variable read from an array (`const first = items[0]`) has a type that
 * cannot be `undefined`, and the rule reports its guard. A `let` that a callback or a cleanup reassigns
 * (`let isCurrent = true; ... return () => { isCurrent = false; }`) keeps the type TypeScript narrowed it to, because
 * TypeScript does not follow assignments made in other functions. An agent that follows those reports deletes a check
 * the code needs, so this rule drops them and keeps every other report of the original rule.
 */
import ts from "typescript";
import tseslint from "typescript-eslint";

/** @typedef {import("eslint").Rule.RuleModule} RuleModule */
/** @typedef {import("eslint").Rule.RuleContext} RuleContext */
/** @typedef {import("eslint").Rule.ReportDescriptor} ReportDescriptor */
/** @typedef {import("eslint").Rule.Node} EstreeNode */

/** Name of the wrapped rule in the typescript-eslint plugin. */
const WRAPPED_RULE_NAME = "no-unnecessary-condition";

/** Reports about the truthiness or nullishness of a value, the ones control-flow narrowing can fake. */
const NARROWABLE_MESSAGE_IDS = new Set(["alwaysTruthy", "alwaysFalsy", "alwaysNullish", "neverNullish", "never"]);

/** Report about an optional chain on a value whose type cannot be nullish. */
const OPTIONAL_CHAIN_MESSAGE_ID = "neverOptionalChain";

/** Report about a comparison whose operands have types that cannot be equal (`record[key] !== undefined`). */
const NO_OVERLAP_MESSAGE_ID = "noOverlapBooleanExpression";

/**
 * Globals of the host environment. Their types say every API is there, but code checks them on purpose: a browser
 * API is missing on the server, in old browsers or outside secure contexts (`globalThis.crypto?.randomUUID`).
 */
const HOST_GLOBALS = new Set(["globalThis", "window", "self", "document", "navigator"]);

const wrappedRule = /** @type {RuleModule} */ (
  /** @type {{ rules: Record<string, unknown> }} */ (/** @type {unknown} */ (tseslint.plugin)).rules[WRAPPED_RULE_NAME]
);

/**
 * @typedef {object} TypeServices
 * @property {ts.TypeChecker} checker - Type checker of the program.
 * @property {(node: EstreeNode) => ts.Node | undefined} toTsNode - Maps an ESLint node to its TypeScript node.
 * @property {boolean} checksIndexedAccess - Whether `noUncheckedIndexedAccess` is on.
 * @property {(sourceFile: ts.SourceFile) => boolean} isDefaultLibrary - Whether a file is one of TypeScript's `lib`
 * files (`lib.dom.d.ts`...).
 */

/**
 * Strips the wrappers that do not change which value a report is about: `!`, `?.` chains, `x!` and parentheses.
 * @param {EstreeNode} node - Reported expression.
 * @returns {EstreeNode} The value whose type the rule judged.
 */
function unwrapCheckedValue(node) {
  const anyNode = /** @type {{ type: string; operator?: string; expression?: EstreeNode; argument?: EstreeNode }} */ (
    /** @type {unknown} */ (node)
  );
  if (anyNode.type === "UnaryExpression" && anyNode.operator === "!" && anyNode.argument !== undefined) {
    return unwrapCheckedValue(anyNode.argument);
  }
  if ((anyNode.type === "ChainExpression" || anyNode.type === "TSNonNullExpression") && anyNode.expression !== undefined) {
    return unwrapCheckedValue(anyNode.expression);
  }
  return node;
}

/**
 * Finds the values a report is about.
 * @param {ReportDescriptor} descriptor - Report of the wrapped rule.
 * @returns {EstreeNode[]} The values; none when the report is not about the type of a value.
 */
function findCheckedValue(descriptor) {
  const { node, messageId } = /** @type {{ node?: EstreeNode | null; messageId?: string }} */ (
    /** @type {unknown} */ (descriptor)
  );
  if (node === undefined || node === null || messageId === undefined) {
    return [];
  }
  if (messageId === OPTIONAL_CHAIN_MESSAGE_ID) {
    const chainLink = /** @type {{ object?: EstreeNode; callee?: EstreeNode }} */ (/** @type {unknown} */ (node));
    const target = chainLink.object ?? chainLink.callee;
    return target === undefined ? [] : [unwrapCheckedValue(target)];
  }
  if (messageId === NO_OVERLAP_MESSAGE_ID) {
    const comparison = /** @type {{ left?: EstreeNode; right?: EstreeNode }} */ (/** @type {unknown} */ (node));
    return [comparison.left, comparison.right].flatMap((operand) =>
      operand === undefined ? [] : [unwrapCheckedValue(operand)],
    );
  }
  return NARROWABLE_MESSAGE_IDS.has(messageId) ? [unwrapCheckedValue(node)] : [];
}

/**
 * Checks whether a property read got its type from control-flow narrowing, which an `await` or a call in between
 * can make wrong.
 * @param {ts.Node} tsNode - TypeScript node of the value.
 * @param {ts.TypeChecker} checker - Type checker.
 * @returns {boolean} Whether its type is narrower than the declared type of the property.
 */
function isNarrowedPropertyRead(tsNode, checker) {
  if (!ts.isPropertyAccessExpression(tsNode)) {
    return false;
  }
  const property = checker.getPropertyOfType(checker.getTypeAtLocation(tsNode.expression), tsNode.name.text);
  if (property === undefined) {
    return false;
  }
  const declaredType = checker.getTypeOfSymbol(property);
  const flowType = checker.getTypeAtLocation(tsNode);
  return declaredType !== flowType && checker.typeToString(declaredType) !== checker.typeToString(flowType);
}

/**
 * Checks whether a `let` or `var` read got its type from control-flow narrowing. TypeScript does not see
 * assignments made inside callbacks or cleanups, so `if (!isCurrent)` after an `await` looks always falsy.
 * @param {ts.Node} tsNode - TypeScript node of the value.
 * @param {ts.TypeChecker} checker - Type checker.
 * @returns {boolean} Whether it is a mutable variable whose type is narrower than its declared type.
 */
function isNarrowedMutableVariable(tsNode, checker) {
  if (!ts.isIdentifier(tsNode)) {
    return false;
  }
  const symbol = checker.getSymbolAtLocation(tsNode);
  const declaration = symbol?.valueDeclaration;
  if (symbol === undefined || declaration === undefined || !ts.isVariableDeclaration(declaration)) {
    return false;
  }
  const declarationList = declaration.parent;
  // Only `let` and `var` can be reassigned; `const`, `using` and `await using` cannot.
  const keyword = ts.isVariableDeclarationList(declarationList) ? declarationList.getFirstToken()?.kind : undefined;
  if (keyword !== ts.SyntaxKind.LetKeyword && keyword !== ts.SyntaxKind.VarKeyword) {
    return false;
  }
  const declaredType = checker.getTypeOfSymbol(symbol);
  const flowType = checker.getTypeAtLocation(tsNode);
  return declaredType !== flowType && checker.typeToString(declaredType) !== checker.typeToString(flowType);
}

/**
 * Checks whether an expression reads an element of an array or tuple by index (`items[0]`), looking through
 * `??`, `||`, `&&`, ternaries, `as`, `!` and parentheses.
 * @param {ts.Expression} expression - Expression to inspect.
 * @param {ts.TypeChecker} checker - Type checker.
 * @returns {boolean} Whether some branch of the expression reads an array element.
 */
function readsArrayElement(expression, checker) {
  if (ts.isParenthesizedExpression(expression) || ts.isAsExpression(expression) || ts.isNonNullExpression(expression)) {
    return readsArrayElement(expression.expression, checker);
  }
  if (ts.isBinaryExpression(expression)) {
    return readsArrayElement(expression.left, checker) || readsArrayElement(expression.right, checker);
  }
  if (ts.isConditionalExpression(expression)) {
    return readsArrayElement(expression.whenTrue, checker) || readsArrayElement(expression.whenFalse, checker);
  }
  return isUncheckedIndexAccess(expression, checker);
}

/**
 * Checks whether an expression reads an array element or a record entry by key (`items[0]`, `countsById[id]`),
 * whose type says it is always there unless `noUncheckedIndexedAccess` is on.
 * @param {ts.Node} tsNode - Expression to inspect.
 * @param {ts.TypeChecker} checker - Type checker.
 * @returns {boolean} Whether it reads through an index signature.
 */
function isUncheckedIndexAccess(tsNode, checker) {
  if (!ts.isElementAccessExpression(tsNode)) {
    return false;
  }
  const objectType = checker.getTypeAtLocation(tsNode.expression);
  return checker.isArrayType(objectType) || checker.getIndexInfosOfType(objectType).length > 0;
}

/**
 * Checks whether a chain starts at a global of the host environment, which code checks to detect features
 * (`globalThis.crypto?.randomUUID`, `if (!Element.prototype.scrollIntoView)` before a polyfill).
 * @param {ts.Node} tsNode - Link of a chain.
 * @param {TypeServices} services - Type information.
 * @returns {boolean} Whether it is one of `HOST_GLOBALS` or a global declared by TypeScript's own `lib` files.
 */
function isHostGlobal(tsNode, services) {
  if (!ts.isIdentifier(tsNode)) {
    return false;
  }
  if (HOST_GLOBALS.has(tsNode.text)) {
    return true;
  }
  // Packages merge their own declarations into these globals (`@types/react` declares an empty `Element`), so one
  // declaration in a `lib` file is enough.
  const declarations = services.checker.getSymbolAtLocation(tsNode)?.declarations ?? [];
  return declarations.some((declaration) => services.isDefaultLibrary(declaration.getSourceFile()));
}

/**
 * Checks whether a variable holds an element read from an array, whose type cannot say it is missing unless
 * `noUncheckedIndexedAccess` is on: `const first = items[0]` or `const [first] = items`.
 * @param {ts.Node} tsNode - TypeScript node of the value.
 * @param {ts.TypeChecker} checker - Type checker.
 * @returns {boolean} Whether the value comes from an array element.
 */
function isArrayElementVariable(tsNode, checker) {
  if (!ts.isIdentifier(tsNode)) {
    return false;
  }
  const declaration = checker.getSymbolAtLocation(tsNode)?.valueDeclaration;
  if (declaration === undefined) {
    return false;
  }
  if (ts.isBindingElement(declaration)) {
    // `const [first] = items`, but not the elements of a tuple, whose length is known.
    const pattern = declaration.parent;
    if (!ts.isArrayBindingPattern(pattern)) {
      return false;
    }
    const owner = pattern.parent;
    const source = ts.isVariableDeclaration(owner) && owner.initializer !== undefined ? owner.initializer : pattern;
    return checker.isArrayType(checker.getTypeAtLocation(source));
  }
  return ts.isVariableDeclaration(declaration) && declaration.initializer !== undefined
    ? readsArrayElement(declaration.initializer, checker)
    : false;
}

/**
 * Decides whether a report of the wrapped rule rests on a type TypeScript cannot know.
 * @param {ReportDescriptor} descriptor - Report of the wrapped rule.
 * @param {TypeServices} services - Type information.
 * @returns {boolean} Whether the report is a false positive.
 */
function isUnreliableReport(descriptor, services) {
  return findCheckedValue(descriptor).some((checkedValue) => isUnreliableChain(services.toTsNode(checkedValue), services));
}

/**
 * Checks every link of a chain: in `target?.id ?? ""` the verdict on `target?.id` rests on the type of `target`.
 * @param {ts.Node | undefined} value - Value the rule judged.
 * @param {TypeServices} services - Type information.
 * @returns {boolean} Whether some link has a type TypeScript cannot know.
 */
function isUnreliableChain(value, services) {
  /** @type {ts.Node | undefined} */
  let link = value;
  while (link !== undefined) {
    if (
      isNarrowedPropertyRead(link, services.checker) ||
      isNarrowedMutableVariable(link, services.checker) ||
      isHostGlobal(link, services)
    ) {
      return true;
    }
    const readsIndex =
      isUncheckedIndexAccess(link, services.checker) || isArrayElementVariable(link, services.checker);
    if (!services.checksIndexedAccess && readsIndex) {
      return true;
    }
    link = chainObject(link);
  }
  return false;
}

/**
 * Returns the value a member access or call reads from: `target` in `target.id`, `target?.id` or `target.load()`.
 * @param {ts.Node} tsNode - Link of a chain.
 * @returns {ts.Node | undefined} The previous link, or `undefined` at the start of the chain.
 */
function chainObject(tsNode) {
  if (ts.isNonNullExpression(tsNode) || ts.isParenthesizedExpression(tsNode)) {
    return tsNode.expression;
  }
  if (ts.isPropertyAccessExpression(tsNode) || ts.isElementAccessExpression(tsNode) || ts.isCallExpression(tsNode)) {
    return tsNode.expression;
  }
  return undefined;
}

/**
 * Reads the type information of the file being linted.
 * @param {RuleContext} context - Rule context.
 * @returns {TypeServices | undefined} Type information, or `undefined` without a TypeScript program.
 */
function readTypeServices(context) {
  const parserServices = /** @type {{ program?: ts.Program | null; esTreeNodeToTSNodeMap?: WeakMap<object, ts.Node> }} */ (
    context.sourceCode.parserServices
  );
  const { program, esTreeNodeToTSNodeMap } = parserServices ?? {};
  if (program === undefined || program === null || esTreeNodeToTSNodeMap === undefined) {
    return undefined;
  }
  return {
    checker: program.getTypeChecker(),
    toTsNode: (node) => esTreeNodeToTSNodeMap.get(node),
    checksIndexedAccess: program.getCompilerOptions().noUncheckedIndexedAccess === true,
    isDefaultLibrary: (sourceFile) => program.isSourceFileDefaultLibrary(sourceFile),
  };
}

/** @type {RuleModule} */
export const noUnnecessaryCondition = {
  meta: { ...wrappedRule.meta, docs: { ...wrappedRule.meta?.docs } },
  create(context) {
    const services = readTypeServices(context);
    const filteredContext = Object.create(context, {
      report: {
        value: (/** @type {ReportDescriptor} */ descriptor) => {
          if (services === undefined || !isUnreliableReport(descriptor, services)) {
            context.report(descriptor);
          }
        },
      },
    });
    return wrappedRule.create(/** @type {RuleContext} */ (filteredContext));
  },
};
