/**
 * @module dependency-cruiser/create-dependency-cruiser-config Builds the dependency-cruiser config: cycles,
 * imports of dev-only packages from production code, production code that imports tests, deprecated Node.js
 * modules and, optionally, the boundaries of a hexagonal architecture.
 */

/** Production code folders of the golfo projects. */
const PRODUCTION_CODE_PATH = String.raw`^(src|app|components|lib|hooks|bin)/`;

/** Test files and folders. */
const TEST_CODE_PATH = String.raw`(^|/)(test|tests|__tests__|e2e)/|\.(test|spec)\.[cm]?[jt]sx?$`;

/**
 * `@golfo/lint/react-scan`, the only devDependency production code may import: it loads react-scan only in
 * development, and production bundles drop that import.
 */
const DEVELOPMENT_ONLY_PACKAGE_PATH = "/@golfo/lint/src/react-scan/";

/**
 * Folders of generated code that are never cruised. `node_modules` is not one of them: excluding it would also drop
 * the dependencies on packages, which the package rules check; `doNotFollow` keeps their insides out.
 */
const EXCLUDED_PATH = String.raw`(^|/)(dist|build|out|coverage|\.next|\.turbo|\.vercel)/`;

/**
 * @typedef {object} ForbiddenRule
 * @property {string} name - Rule name, shown in the report.
 * @property {"error" | "warn" | "info"} severity - How a violation is reported.
 * @property {string} [comment] - Why the dependency is forbidden, shown in the report.
 * @property {Record<string, unknown>} from - Modules the rule applies to.
 * @property {Record<string, unknown>} to - Dependencies they may not have.
 */

/**
 * @typedef {object} ForbiddenPath
 * @property {string} name - Rule name, shown in the report.
 * @property {string} path - Regular expression of the modules nobody may import.
 * @property {string} comment - Why, and what to import instead.
 */

/**
 * @typedef {object} DependencyCruiserConfigOptions
 * @property {string} [hexagonalModulesPath] - Folder whose subfolders are hexagonal modules with `domain`,
 * `application` and `infrastructure` layers (for example `src/modules`). Enables the layer rules.
 * @property {ForbiddenPath[]} [forbiddenPaths] - Extra modules nobody may import, such as a deprecated folder.
 * @property {string} [tsConfigFileName] - `tsconfig.json` whose `paths` aliases resolve imports.
 */

/** Rules that apply to every project. */
const BASE_RULES = /** @type {ForbiddenRule[]} */ ([
  {
    name: "no-circular",
    severity: "error",
    comment: "Los ciclos impiden entender, testear y cargar los módulos por separado. Extraé lo común a otro módulo.",
    from: {},
    to: { circular: true },
  },
  // Imports that do not resolve and packages missing from `package.json` are reported by `golfo-lint unused`
  // (knip), which also knows the packages a framework provides, such as `server-only` in Next.js.
  {
    name: "not-to-dev-dep",
    severity: "error",
    comment: "El código de producción importa una devDependency, que no se instala en producción.",
    from: { path: PRODUCTION_CODE_PATH, pathNot: TEST_CODE_PATH },
    to: { dependencyTypes: ["npm-dev"], dependencyTypesNot: ["type-only"], pathNot: DEVELOPMENT_ONLY_PACKAGE_PATH },
  },
  {
    name: "not-to-test",
    severity: "error",
    comment: "El código de producción importa un archivo de test.",
    from: { pathNot: TEST_CODE_PATH },
    to: { path: TEST_CODE_PATH },
  },
  {
    name: "no-deprecated-core",
    severity: "error",
    comment: "El módulo de Node.js está deprecado.",
    from: {},
    to: { dependencyTypes: ["core"], path: "^(punycode|domain|constants|sys|_linklist|_stream_wrap)$" },
  },
]);

/**
 * Builds the rules that keep hexagonal layers pointing inwards: `domain` depends on nothing else and
 * `application` does not depend on `infrastructure`.
 * @param {string} modulesPath - Folder whose subfolders are hexagonal modules.
 * @returns {ForbiddenRule[]} Layer rules.
 */
function createHexagonalRules(modulesPath) {
  const escapedModulesPath = modulesPath.replaceAll("/", String.raw`\/`);
  const modulePrefix = `^${escapedModulesPath}/[^/]+/`;
  return [
    {
      name: "domain-depends-on-nothing",
      severity: "error",
      comment: "domain no puede depender de application ni de infrastructure: definí un puerto en domain.",
      from: { path: `${modulePrefix}domain/` },
      to: { path: `${modulePrefix}(application|infrastructure)/` },
    },
    {
      name: "application-not-to-infrastructure",
      severity: "error",
      comment: "application usa puertos de domain; la implementación se inyecta desde setup.ts.",
      from: { path: `${modulePrefix}application/` },
      to: { path: `${modulePrefix}infrastructure/` },
    },
  ];
}

/**
 * Builds a dependency-cruiser config from the shared rules, to export from `.dependency-cruiser.js`.
 * @param {DependencyCruiserConfigOptions} [options] - What the project uses.
 * @returns {{ forbidden: ForbiddenRule[]; options: Record<string, unknown> }} dependency-cruiser config.
 */
export function createDependencyCruiserConfig(options = {}) {
  const { hexagonalModulesPath, forbiddenPaths = [], tsConfigFileName } = options;
  const pathRules = forbiddenPaths.map(
    (forbiddenPath) =>
      /** @type {ForbiddenRule} */ ({
        name: forbiddenPath.name,
        severity: "error",
        comment: forbiddenPath.comment,
        from: {},
        to: { path: forbiddenPath.path },
      }),
  );
  return {
    forbidden: [
      ...BASE_RULES,
      ...(hexagonalModulesPath === undefined ? [] : createHexagonalRules(hexagonalModulesPath)),
      ...pathRules,
    ],
    options: {
      doNotFollow: { path: "node_modules" },
      exclude: { path: EXCLUDED_PATH },
      tsPreCompilationDeps: true,
      ...(tsConfigFileName === undefined ? {} : { tsConfig: { fileName: tsConfigFileName } }),
      enhancedResolveOptions: {
        exportsFields: ["exports"],
        conditionNames: ["import", "require", "node", "default", "types"],
        mainFields: ["module", "main", "types", "typings"],
      },
      skipAnalysisNotInRules: true,
    },
  };
}
