/**
 * @module react-doctor/subscription-call Decides whether a call that react-doctor's `effect-needs-cleanup` takes
 * for a subscription by its name (`observe`, `subscribe`, `listen`...) is an asynchronous operation of the project.
 * Browser subscriptions (`IntersectionObserver.observe`, `addEventListener`) return nothing or a handle to release;
 * a method that the project declares as `Promise<void>` finishes on its own and leaves nothing to release. A
 * `Promise` of a value, which may be an unsubscribe function, is still reported.
 */
import ts from "typescript";
import { findCallAt, followImport } from "./project-modules.js";
import { findDeclaration, unwrapExpression } from "./source-scope.js";

/** @typedef {import("./project-modules.js").SourceReader} SourceReader */
/** @typedef {import("./project-modules.js").ModuleContext} ModuleContext */

/** Type declarations followed before giving up, so a cycle cannot loop forever. */
const MAX_TYPE_DEPTH = 6;

/** Name in backquotes at the start of the finding: "`observe` creates a subscription...". */
const RESOURCE_NAME_PATTERN = /^`([\w$]+)`/u;

/**
 * Finds the members of an object type: a type literal, an interface or a type alias of one, declared in the module
 * or imported from another module of the project.
 * @param {ts.TypeNode} type - Declared type.
 * @param {ModuleContext} context - Module of the type.
 * @param {SourceReader} readSource - Reads files of the project.
 * @param {number} depth - Declarations followed so far.
 * @returns {{ members: readonly ts.TypeElement[]; context: ModuleContext } | undefined} The members and their module.
 */
function resolveMembers(type, context, readSource, depth) {
  if (depth >= MAX_TYPE_DEPTH) {
    return undefined;
  }
  if (ts.isParenthesizedTypeNode(type)) {
    return resolveMembers(type.type, context, readSource, depth);
  }
  if (ts.isTypeLiteralNode(type)) {
    return { members: type.members, context };
  }
  if (!ts.isTypeReferenceNode(type) || !ts.isIdentifier(type.typeName) || type.typeArguments !== undefined) {
    return undefined;
  }
  return resolveNamedMembers(type.typeName.text, context, readSource, depth + 1);
}

/**
 * Finds the members of a type that a module declares at its top level or imports.
 * @param {string} name - Type name in the module.
 * @param {ModuleContext} context - Module.
 * @param {SourceReader} readSource - Reads files of the project.
 * @param {number} depth - Declarations followed so far.
 * @returns {{ members: readonly ts.TypeElement[]; context: ModuleContext } | undefined} The members and their module.
 */
function resolveNamedMembers(name, context, readSource, depth) {
  for (const statement of context.sourceFile.statements) {
    if (ts.isTypeAliasDeclaration(statement) && statement.name.text === name) {
      return statement.typeParameters === undefined ? resolveMembers(statement.type, context, readSource, depth) : undefined;
    }
    if (ts.isInterfaceDeclaration(statement) && statement.name.text === name) {
      // Members of an extended interface are not followed, but a member the interface declares is its own.
      return statement.typeParameters === undefined ? { members: statement.members, context } : undefined;
    }
  }
  const imported = depth < MAX_TYPE_DEPTH ? followImport(name, context, readSource) : undefined;
  return imported === undefined ? undefined : resolveNamedMembers(imported.name, imported.context, readSource, depth + 1);
}

/**
 * Checks whether a module declares or imports a name `Promise` that would hide the global type.
 * @param {ModuleContext} context - Module.
 * @returns {boolean} Whether `Promise` there may be another type.
 */
function shadowsPromise(context) {
  return context.sourceFile.statements.some((statement) => {
    if (ts.isTypeAliasDeclaration(statement) || ts.isInterfaceDeclaration(statement) || ts.isClassDeclaration(statement)) {
      return statement.name?.text === "Promise";
    }
    if (!ts.isImportDeclaration(statement) || statement.importClause === undefined) {
      return false;
    }
    const { name, namedBindings } = statement.importClause;
    return (
      name?.text === "Promise" ||
      (namedBindings !== undefined &&
        (ts.isNamespaceImport(namedBindings)
          ? namedBindings.name.text === "Promise"
          : namedBindings.elements.some((element) => element.name.text === "Promise")))
    );
  });
}

/**
 * Checks whether a type is `Promise<void>` or `Promise<undefined>`: an operation that resolves without a value.
 * @param {ts.TypeNode | undefined} type - Return type.
 * @returns {boolean} Whether it promises no handle to release.
 */
function isEmptyPromise(type) {
  if (type === undefined || !ts.isTypeReferenceNode(type) || !ts.isIdentifier(type.typeName) || type.typeName.text !== "Promise") {
    return false;
  }
  const result = type.typeArguments?.length === 1 ? type.typeArguments[0] : undefined;
  return result !== undefined && (result.kind === ts.SyntaxKind.VoidKeyword || result.kind === ts.SyntaxKind.UndefinedKeyword);
}

/**
 * Reads the declared result of a member: the return type of a method or of a property holding a function.
 * @param {ts.TypeElement} member - Member of an object type.
 * @returns {ts.TypeNode | undefined} Its return type.
 */
function readReturnType(member) {
  if (ts.isMethodSignature(member)) {
    return member.type;
  }
  if (ts.isPropertySignature(member) && member.type !== undefined) {
    const type = ts.isParenthesizedTypeNode(member.type) ? member.type.type : member.type;
    return ts.isFunctionTypeNode(type) ? type.type : undefined;
  }
  return undefined;
}

/**
 * Reads the declared type of the variable a receiver starts at, and the properties read after it.
 * @param {ts.Expression} receiver - Object whose method is called (`options` in `options.observe(...)`).
 * @returns {{ type: ts.TypeNode; properties: string[] } | undefined} The type annotation and the property chain.
 */
function readReceiverType(receiver) {
  const value = unwrapExpression(receiver);
  if (ts.isPropertyAccessExpression(value)) {
    const owner = readReceiverType(value.expression);
    return owner === undefined ? undefined : { type: owner.type, properties: [...owner.properties, value.name.text] };
  }
  if (!ts.isIdentifier(value)) {
    return undefined;
  }
  const declaration = findDeclaration(value);
  const declared = declaration?.parent;
  if (declared === undefined || !(ts.isParameter(declared) || ts.isVariableDeclaration(declared)) || declared.name !== declaration) {
    return undefined;
  }
  return declared.type === undefined ? undefined : { type: declared.type, properties: [] };
}

/**
 * Checks whether the call that react-doctor reports as a subscription calls a method the project declares as
 * `Promise<void>`.
 * @param {{ filePath: string; line: number; column: number; message: string }} finding - Path relative to the
 * project, 1-based line and column of the call, and the message, which names the subscribing function.
 * @param {SourceReader} readSource - Reads files of the project.
 * @returns {boolean} Whether the call is an asynchronous operation with nothing to release.
 */
export function callsPromiseMethod({ filePath, line, column, message }, readSource) {
  const resourceName = RESOURCE_NAME_PATTERN.exec(message)?.[1];
  const found = findCallAt(filePath, line, column, readSource);
  if (found === undefined) {
    return false;
  }
  const { context, call } = found;
  const callee = unwrapExpression(call.expression);
  if (!ts.isPropertyAccessExpression(callee) || callee.name.text !== resourceName) {
    return false;
  }
  const receiver = readReceiverType(callee.expression);
  if (receiver === undefined) {
    return false;
  }
  let resolved = resolveMembers(receiver.type, context, readSource, 0);
  for (const property of receiver.properties) {
    const member = resolved?.members.find((candidate) => candidate.name?.getText(resolved?.context.sourceFile) === property);
    resolved =
      member !== undefined && ts.isPropertySignature(member) && member.type !== undefined && resolved !== undefined
        ? resolveMembers(member.type, resolved.context, readSource, 0)
        : undefined;
  }
  const methods = resolved?.members.filter((member) => member.name?.getText(resolved?.context.sourceFile) === resourceName) ?? [];
  return (
    resolved !== undefined &&
    methods.length > 0 &&
    !shadowsPromise(resolved.context) &&
    methods.every((method) => isEmptyPromise(readReturnType(method)))
  );
}
