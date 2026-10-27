/**
 * @module react-doctor/react-doctor-report Filters and prints the react-doctor report. react-doctor also runs
 * ESLint rules, the React Compiler, jsx-a11y and its own size checks, which the ESLint preset of `@golfo/lint`
 * already reports; it scans HTML pages and workflows that are not React code; and some of its rules only give
 * advice that breaks valid code when applied blindly. golfo-lint keeps one finding per problem, so it drops them.
 */

/** react-doctor plugins whose rules the ESLint preset or another golfo-lint analysis already runs. */
const DUPLICATED_PLUGINS = new Set([
  // ESLint core and typescript-eslint run in `eslint .`.
  "eslint",
  "typescript",
  // React Compiler rules: `eslint-plugin-react-hooks` runs the same compiler in ESLint. react-doctor's copy also
  // takes `useCases` properties and `use...` methods for hooks, and its `todo` rule reports syntax the compiler
  // does not support yet (`try`/`finally`), which is valid code.
  "react-hooks-js",
  // Unused files and exports: `golfo-lint unused`.
  "knip",
]);

/**
 * react-doctor rules that the ESLint preset already reports under another name, or that give advice instead of
 * finding a defect. The comment says what reports it instead, or why it is not a defect.
 */
const EXCLUDED_REACT_DOCTOR_RULES = new Set([
  // Size and complexity: `sonarjs/cognitive-complexity` and `max-lines-per-function`.
  "no-giant-component",
  "no-high-complexity-react-function",
  // `eslint-plugin-react-you-might-not-need-an-effect` (`no-derived-state`, `no-pass-*-to-parent`, ...).
  "no-derived-state-effect",
  "no-pass-data-to-parent",
  "no-pass-live-state-to-parent",
  // jsx-a11y (`recommended`).
  "alt-text",
  "anchor-has-content",
  "anchor-is-valid",
  "aria-activedescendant-has-tabindex",
  "aria-props",
  "aria-proptypes",
  "aria-role",
  "aria-unsupported-elements",
  "autocomplete-valid",
  "click-events-have-key-events",
  "control-has-associated-label",
  "heading-has-content",
  "html-has-lang",
  "iframe-has-title",
  "img-redundant-alt",
  "interactive-supports-focus",
  "label-has-associated-control",
  "media-has-caption",
  "mouse-events-have-key-events",
  "no-access-key",
  "no-autofocus",
  "no-distracting-elements",
  "no-interactive-element-to-noninteractive-role",
  "no-noninteractive-element-interactions",
  "no-noninteractive-element-to-interactive-role",
  "no-noninteractive-tabindex",
  "no-redundant-roles",
  "no-static-element-interactions",
  "role-has-required-aria-props",
  "role-supports-aria-props",
  "scope",
  "tabindex-no-positive",
  // Workflows: `golfo-lint workflows` (zizmor) owns their security.
  "build-pipeline-secret-boundary",
  // Advice that assumes independent operations: running sequential awaits in parallel breaks code whose order
  // matters (writes in one transaction, ordered maintenance steps), and react-doctor cannot tell them apart.
  "async-await-in-loop",
  "server-sequential-independent-await",
  // `array.includes()` or `array.find()` inside a loop over arrays of a few items: no measurable cost.
  "js-index-maps",
  "js-set-map-lookups",
  // Architecture advice, not defects: forms of client components that submit with JavaScript, `useState` seeded
  // from a prop to edit a copy, and requests started by an effect (heartbeats, polling).
  "no-derived-useState",
  "no-fetch-in-effect",
  "no-prevent-default",
  // Fast Refresh in development, not a defect of the app.
  "only-export-components",
  // Migration advice from Zod 3 to Zod 4, also reported on projects that already run Zod 4. APIs that Zod 4
  // deprecates carry `@deprecated`, which `@typescript-eslint/no-deprecated` reports.
  "zod-v4-no-deprecated-schema-apis",
]);

/**
 * `button-has-type` also reports `type={CONSTANT}` as invalid, because it only reads literals. In `.tsx` files
 * TypeScript already checks the value of `type`; in JavaScript an invalid `type` is still reported, and so is a
 * button without `type`.
 */
const INVALID_BUTTON_TYPE_MESSAGE = "invalid `type`";

/** Files whose JSX TypeScript checks. */
const TYPED_JSX_FILE_PATTERN = /\.tsx$/u;

/** Files react-doctor scans that are not React code: inline scripts of HTML pages, workflows. */
const NON_REACT_FILE_PATTERN = /\.(?:html?|ya?ml)$/u;

/**
 * `no-fetch-response-used-without-status-check` only accepts a status check before the body is read, but reading
 * the body first to show the error message of the API and then checking `response.ok` is valid. The finding points
 * at the `fetch` call; it is dropped when the variable that holds the response is checked a few lines below.
 */
const FETCH_STATUS_RULE = "no-fetch-response-used-without-status-check";

/** Lines after the `fetch` call where a check of `ok` or `status` counts. */
const FETCH_STATUS_CHECK_WINDOW = 40;

/** What follows the name of the variable in `const response = await fetch(`, as formatters print it. */
const FETCH_ASSIGNMENT = " = await fetch(";

/** A character of a JavaScript identifier. */
const IDENTIFIER_CHARACTER_PATTERN = /[\w$]/u;

/**
 * `raw-sql-injection-risk` reports one `sql.raw(...)` per file, also when its argument is a string literal or a
 * constant (`sql.raw(EFFECT_SQL.begin)`), which cannot carry user input. The finding is dropped only when every
 * `sql.raw(...)` of the file has such an argument.
 */
const RAW_SQL_RULE = "raw-sql-injection-risk";

/** `sql.raw(` and its argument up to the closing parenthesis, when the argument has no parentheses. */
const RAW_SQL_CALL_PATTERN = /\bsql\.raw\((?<argument>[^()]*)\)/gu;

/** Every `sql.raw(`, also the ones whose argument has calls or parentheses (`sql.raw(String(input))`). */
const RAW_SQL_OPENING_PATTERN = /\bsql\.raw\(/gu;

/** Arguments of `sql.raw` that cannot carry user input: string literals without interpolation and constants. */
const CONSTANT_SQL_ARGUMENT_PATTERNS = [
  /^"[^"]*"$/u,
  /^'[^']*'$/u,
  /^`[^$`]*`$/u,
  // `EFFECT_SQL` or `EFFECT_SQL.begin`.
  /^[A-Z][\dA-Z_]*(?:\.[\w$]+)*$/u,
];

/**
 * Reads a file of the project.
 * @callback SourceReader
 * @param {string} filePath - Path relative to the project, as react-doctor reports it.
 * @returns {string | undefined} Its text, or `undefined` when it cannot be read.
 */

/**
 * Reads the name of the variable a line assigns a `fetch` response to.
 * @param {string} line - Line of the `fetch` call.
 * @returns {string | undefined} `response` in `const response = await fetch(`, or `undefined`.
 */
function readAssignedFetchVariable(line) {
  const assignmentStart = line.indexOf(FETCH_ASSIGNMENT);
  let nameStart = assignmentStart;
  while (nameStart > 0 && IDENTIFIER_CHARACTER_PATTERN.test(line.charAt(nameStart - 1))) {
    nameStart -= 1;
  }
  return assignmentStart > 0 && nameStart < assignmentStart ? line.slice(nameStart, assignmentStart) : undefined;
}

/**
 * Checks whether the response of the `fetch` call a finding points at is checked a few lines below.
 * @param {ReactDoctorDiagnostic} diagnostic - Finding.
 * @param {SourceReader} readSource - Reads files of the project.
 * @returns {boolean} Whether `<response>.ok` or `<response>.status` is read after the call.
 */
function checksFetchStatusLater(diagnostic, readSource) {
  const lines = readSource(diagnostic.filePath)?.split("\n");
  if (lines === undefined) {
    return false;
  }
  const name = readAssignedFetchVariable(lines[diagnostic.line - 1] ?? "");
  if (name === undefined) {
    return false;
  }
  const statusCheck = new RegExp(String.raw`\b${name.replaceAll("$", String.raw`\$`)}\.(?:ok|status)\b`, "u");
  return lines.slice(diagnostic.line, diagnostic.line + FETCH_STATUS_CHECK_WINDOW).some((line) => statusCheck.test(line));
}

/**
 * Checks whether every `sql.raw(...)` of a file takes a literal or a constant.
 * @param {ReactDoctorDiagnostic} diagnostic - Finding.
 * @param {SourceReader} readSource - Reads files of the project.
 * @returns {boolean} Whether the file has `sql.raw` calls and none takes a value built at run time.
 */
function usesOnlyConstantRawSql(diagnostic, readSource) {
  const source = readSource(diagnostic.filePath);
  if (source === undefined) {
    return false;
  }
  const argumentsOfRawSql = [...source.matchAll(RAW_SQL_CALL_PATTERN)].map((match) =>
    (match.groups?.argument ?? "").trim(),
  );
  // A call the pattern could not read, such as `sql.raw(String(input))`, counts as built at run time.
  const rawSqlCallCount = [...source.matchAll(RAW_SQL_OPENING_PATTERN)].length;
  return (
    argumentsOfRawSql.length > 0 &&
    argumentsOfRawSql.length === rawSqlCallCount &&
    argumentsOfRawSql.every((argument) => CONSTANT_SQL_ARGUMENT_PATTERNS.some((pattern) => pattern.test(argument)))
  );
}

/**
 * @typedef {object} ReactDoctorDiagnostic
 * @property {string} filePath - File, relative to the project.
 * @property {string} plugin - Plugin that owns the rule (`react-doctor`, `eslint`, `react-hooks-js`...).
 * @property {string} rule - Rule name, without the plugin.
 * @property {string} severity - `error` or `warning`.
 * @property {string} message - What is wrong.
 * @property {string} [help] - How to fix it.
 * @property {number} line - Line of the finding.
 * @property {number} column - Column of the finding.
 */

/**
 * @typedef {object} ReactDoctorReport
 * @property {ReactDoctorDiagnostic[]} [diagnostics] - Findings.
 * @property {unknown} [error] - Why the scan failed, when it did.
 */

/**
 * Checks whether golfo-lint reports a react-doctor finding.
 * @param {ReactDoctorDiagnostic} diagnostic - Finding.
 * @param {SourceReader} [readSource] - Reads files of the project, to drop findings the code shows are wrong.
 * @returns {boolean} Whether it is a React finding no other golfo-lint rule reports.
 */
export function isReportedDiagnostic(diagnostic, readSource = () => undefined) {
  if (DUPLICATED_PLUGINS.has(diagnostic.plugin) || NON_REACT_FILE_PATTERN.test(diagnostic.filePath)) {
    return false;
  }
  if (
    diagnostic.rule === "button-has-type" &&
    diagnostic.message.includes(INVALID_BUTTON_TYPE_MESSAGE) &&
    TYPED_JSX_FILE_PATTERN.test(diagnostic.filePath)
  ) {
    return false;
  }
  if (diagnostic.rule === FETCH_STATUS_RULE && checksFetchStatusLater(diagnostic, readSource)) {
    return false;
  }
  if (diagnostic.rule === RAW_SQL_RULE && usesOnlyConstantRawSql(diagnostic, readSource)) {
    return false;
  }
  return !EXCLUDED_REACT_DOCTOR_RULES.has(diagnostic.rule);
}

/**
 * Formats the findings like ESLint's `stylish` output: grouped by file, one line per finding with its help.
 * @param {ReactDoctorDiagnostic[]} diagnostics - Findings to print.
 * @returns {string} Report text.
 */
export function formatDiagnostics(diagnostics) {
  /** @type {Map<string, ReactDoctorDiagnostic[]>} */
  const diagnosticsByFile = new Map();
  for (const diagnostic of diagnostics) {
    diagnosticsByFile.set(diagnostic.filePath, [...(diagnosticsByFile.get(diagnostic.filePath) ?? []), diagnostic]);
  }
  const fileSections = [...diagnosticsByFile].map(([filePath, fileDiagnostics]) => {
    const lines = fileDiagnostics
      .toSorted((left, right) => left.line - right.line || left.column - right.column)
      .map((diagnostic) => {
        const help = diagnostic.help === undefined || diagnostic.help === "" ? "" : `\n      ${diagnostic.help}`;
        return `  ${diagnostic.line}:${diagnostic.column}  ${diagnostic.severity}  ${diagnostic.message}  ${diagnostic.plugin}/${diagnostic.rule}${help}`;
      });
    return [filePath, ...lines].join("\n");
  });
  return [...fileSections, `${diagnostics.length} problema(s) de react-doctor.`].join("\n\n");
}
