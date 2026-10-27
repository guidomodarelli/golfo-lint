/**
 * @module react-doctor/fetch-status Decides whether the response of a `fetch` call is checked: react-doctor's
 * `no-fetch-response-used-without-status-check` only accepts a check of `ok` or `status` before the body is read,
 * but reading the body first, to show the error message of the API, and then checking `response.ok` is valid.
 */
import ts from "typescript";

/**
 * Reads a file of the project.
 * @callback SourceReader
 * @param {string} filePath - Path relative to the project.
 * @returns {string | undefined} Its text, or `undefined` when it cannot be read.
 */

/** Properties of a `Response` that tell a successful status from an error. */
const STATUS_PROPERTIES = new Set(["ok", "status"]);

/**
 * @typedef {object} FetchAssignment
 * @property {string} name - Variable that receives the response.
 * @property {ts.Node} node - Declaration or assignment that stores it.
 */

/**
 * Checks whether an expression is a `fetch(...)` call, maybe awaited.
 * @param {ts.Expression} expression - Expression to inspect.
 * @returns {boolean} Whether it calls `fetch`.
 */
function isFetchCall(expression) {
  const call = ts.isAwaitExpression(expression) ? expression.expression : expression;
  return ts.isCallExpression(call) && ts.isIdentifier(call.expression) && call.expression.text === "fetch";
}

/**
 * Reads the variable a node stores a `fetch` response in: `const response = await fetch(...)` or
 * `response = await fetch(...)`.
 * @param {ts.Node} node - Node to inspect.
 * @returns {string | undefined} Name of the variable.
 */
function readFetchTarget(node) {
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer !== undefined) {
    return isFetchCall(node.initializer) ? node.name.text : undefined;
  }
  if (
    ts.isBinaryExpression(node) &&
    node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
    ts.isIdentifier(node.left) &&
    isFetchCall(node.right)
  ) {
    return node.left.text;
  }
  return undefined;
}

/**
 * Finds where a `fetch` response is stored on a line.
 * @param {ts.SourceFile} sourceFile - Parsed file.
 * @param {number} line - 1-based line of the `fetch` call.
 * @returns {FetchAssignment | undefined} The variable and the node that stores it.
 */
function findFetchAssignment(sourceFile, line) {
  /** @type {FetchAssignment | undefined} */
  let found;
  /** @param {ts.Node} node - Node to visit. */
  const visit = (node) => {
    if (found !== undefined) {
      return;
    }
    const name = readFetchTarget(node);
    if (name !== undefined && sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1 === line) {
      found = { name, node };
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

/**
 * Finds the function or module whose body holds a declaration or an assignment.
 * @param {ts.Node} node - Declaration or assignment.
 * @returns {ts.Node} Closest enclosing function, or the file.
 */
function enclosingScope(node) {
  let current = node.parent;
  while (!ts.isSourceFile(current) && !ts.isFunctionLike(current)) {
    current = current.parent;
  }
  return current;
}

/**
 * Checks whether a node declares a binding with a name, which hides an outer variable of that name.
 * @param {ts.Node} node - Node to inspect.
 * @param {string} name - Variable name.
 * @returns {boolean} Whether it is a variable declaration or a parameter named so.
 */
function declaresName(node, name) {
  return (
    (ts.isVariableDeclaration(node) || ts.isParameter(node)) && ts.isIdentifier(node.name) && node.name.text === name
  );
}

/**
 * Checks whether a node contains another one.
 * @param {ts.Node} container - Possible ancestor.
 * @param {ts.Node} node - Possible descendant.
 * @returns {boolean} Whether `node` is inside `container`.
 */
function containsNode(container, node) {
  return node.pos >= container.pos && node.end <= container.end;
}

/**
 * Checks whether a block declares a variable of a name in its own statements.
 * @param {ts.Block} block - Block to inspect.
 * @param {string} name - Variable name.
 * @returns {boolean} Whether one of its variable statements declares it.
 */
function blockDeclaresName(block, name) {
  return block.statements.some(
    (statement) =>
      ts.isVariableStatement(statement) &&
      statement.declarationList.declarations.some((declaration) => declaresName(declaration, name)),
  );
}

/**
 * Checks whether the scope of a `fetch` response reads its `ok` or `status`. Reads inside nested functions that
 * declare their own variable of the same name do not count.
 * @param {ts.Node} scope - Function or file that stores the response.
 * @param {FetchAssignment} assignment - Variable and node that stores it.
 * @returns {boolean} Whether some read of the response checks its status.
 */
function readsStatus(scope, { name, node: anchor }) {
  let checked = false;
  /** @param {ts.Node} node - Node to visit. */
  const visit = (node) => {
    if (checked || (node !== anchor && declaresName(node, name))) {
      return;
    }
    if (ts.isFunctionLike(node) && node.parameters.some((parameter) => declaresName(parameter, name))) {
      return;
    }
    // A block that declares its own variable of that name, away from the response, reads another value.
    if (ts.isBlock(node) && !containsNode(node, anchor) && blockDeclaresName(node, name)) {
      return;
    }
    if (
      ts.isPropertyAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === name &&
      STATUS_PROPERTIES.has(node.name.text)
    ) {
      checked = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(scope, visit);
  return checked;
}

/**
 * Checks whether the response of the `fetch` call on a line has its status checked in the same function.
 * @param {string} filePath - Path of the file, relative to the project.
 * @param {number} line - 1-based line of the `fetch` call.
 * @param {SourceReader} readSource - Reads files of the project.
 * @returns {boolean} Whether `<response>.ok` or `<response>.status` is read in the function that stores it.
 */
export function checksFetchStatus(filePath, line, readSource) {
  const source = readSource(filePath);
  if (source === undefined) {
    return false;
  }
  const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true);
  const assignment = findFetchAssignment(sourceFile, line);
  return assignment !== undefined && readsStatus(enclosingScope(assignment.node), assignment);
}
