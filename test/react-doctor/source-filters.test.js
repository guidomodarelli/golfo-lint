import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isReportedDiagnostic } from "../../src/react-doctor/react-doctor-report.js";

/** @typedef {import("../../src/react-doctor/react-doctor-report.js").ReactDoctorDiagnostic} ReactDoctorDiagnostic */

/**
 * Builds a react-doctor finding that points at the first occurrence of a text in a file.
 * @param {string} rule - Rule name.
 * @param {string} filePath - File of the finding.
 * @param {string} source - Text of the file.
 * @param {string} marker - Text where the finding starts.
 * @param {string} [message] - Message of the finding.
 * @returns {ReactDoctorDiagnostic} Finding.
 */
function findingAt(rule, filePath, source, marker, message = "Finding.") {
  const offset = source.indexOf(marker);
  assert.notEqual(offset, -1, `marker not found: ${marker}`);
  const before = source.slice(0, offset).split("\n");
  return {
    filePath,
    plugin: "react-doctor",
    rule,
    severity: "warning",
    message,
    line: before.length,
    column: (before.at(-1)?.length ?? 0) + 1,
  };
}

/**
 * Builds a reader over in-memory files.
 * @param {Record<string, string>} files - Files of the project.
 * @returns {(filePath: string) => string | undefined} Reader.
 */
function reader(files) {
  return (filePath) => files[filePath];
}

/**
 * Checks whether golfo-lint reports a finding of a single file.
 * @param {string} rule - Rule name.
 * @param {string} source - Text of `src/view.tsx`.
 * @param {string} marker - Text where the finding starts.
 * @param {string} [message] - Message of the finding.
 * @returns {boolean} Whether it is reported.
 */
function reportsIn(rule, source, marker, message) {
  const filePath = "src/view.tsx";
  return isReportedDiagnostic(findingAt(rule, filePath, source, marker, message), reader({ [filePath]: source }));
}

describe("raw-sql-injection-risk con valores resueltos por tipo", () => {
  const rule = "raw-sql-injection-risk";

  /**
   * Checks whether golfo-lint reports `sql.raw` in a repository module.
   * @param {Record<string, string>} files - Files of the project, with `src/repository.ts`.
   * @returns {boolean} Whether it is reported.
   */
  const reportsRepository = (files) =>
    isReportedDiagnostic(
      { filePath: "src/repository.ts", plugin: "react-doctor", rule, severity: "warning", message: "Raw SQL.", line: 1, column: 1 },
      reader(files),
    );

  it("descarta un ternario entre propiedades de un objeto as const importado", () => {
    const files = {
      "src/constants/locks.ts": 'export const LOCK_SQL = { share: "for share", update: "for update" } as const;\n',
      "src/repository.ts": [
        'import { LOCK_SQL } from "./constants/locks";',
        "export function lock(shared: boolean) {",
        "  const scopeLock = shared ? LOCK_SQL.share : LOCK_SQL.update;",
        `  return sql\`select 1 \${sql.raw(scopeLock)}\`;`,
        "}",
        "",
      ].join("\n"),
    };
    assert.equal(reportsRepository(files), false);
    const fromInput = { ...files, "src/repository.ts": files["src/repository.ts"].replace("LOCK_SQL.update", "request.lock") };
    assert.equal(reportsRepository(fromInput), true);
  });

  it("descarta un parámetro tipado como valor de un objeto as const, también por alias importado", () => {
    const local = [
      'const CTE = { deleted: "deleted_exception", saved: "saved_exception" } as const;',
      "function touched(cte: (typeof CTE)[keyof typeof CTE]) {",
      `  return sql\`select 1 from \${sql.raw(cte)}\`;`,
      "}",
      "",
    ].join("\n");
    assert.equal(reportsRepository({ "src/repository.ts": local }), false);
    const aliased = {
      "src/constants/cte.ts": [
        'export const CTE = { deleted: "deleted_exception", saved: "saved_exception" } as const;',
        "export type CteName = (typeof CTE)[keyof typeof CTE];",
        "",
      ].join("\n"),
      "src/repository.ts": [
        'import type { CteName } from "@/src/constants/cte";',
        "function touched(cte: CteName) {",
        "  return sql.raw(cte);",
        "}",
        "",
      ].join("\n"),
    };
    assert.equal(reportsRepository(aliased), false);
  });

  it("descarta un template literal cuyo parámetro es una unión de typeof de propiedades constantes", () => {
    const source = [
      'const PAYLOAD_KEY = { startsAt: "startsAt", eventId: "eventId" } as const;',
      "type InstantField = typeof PAYLOAD_KEY.startsAt | \"occurrenceStartsAt\";",
      "function castable(key: InstantField) {",
      `  return sql.raw(\`payload ->> '\${key}'\`);`,
      "}",
      "",
    ].join("\n");
    assert.equal(reportsRepository({ "src/repository.ts": source }), false);
  });

  it("mantiene parámetros de tipo abierto, genéricos, reasignados o de objetos mutables", () => {
    const cases = [
      "function run(key: string) {\n  return sql.raw(key);\n}\n",
      "function run<Key extends string>(key: Key) {\n  return sql.raw(key);\n}\n",
      "type Key = \"a\" | \"b\";\nfunction run(key: Key) {\n  key = request.key;\n  return sql.raw(key);\n}\n",
      'const CTE = { a: "a" };\nfunction run(key: (typeof CTE)[keyof typeof CTE]) {\n  return sql.raw(key);\n}\n',
      'const CTE = { a: "a" } as const;\nCTE.a = request.key;\nfunction run(key: typeof CTE.a) {\n  return sql.raw(key);\n}\n',
      'const A = { a: "a" } as const;\nconst B = { b: request.key } as const;\nfunction run(key: (typeof A)[keyof typeof B]) {\n  return sql.raw(key);\n}\n',
      "function run(key: Imported) {\n  return sql.raw(key);\n}\n",
      'type Key = "a";\nfunction run() {\n  type Key = string;\n  return (key: Key) => sql.raw(key);\n}\n',
      `function run(key = "a") {\n  return sql.raw(\`x \${key}\`);\n}\n`,
    ];
    for (const source of cases) {
      assert.equal(reportsRepository({ "src/repository.ts": source }), true, source);
    }
  });
});

describe("no-set-state-after-await-in-effect con cancelación en el cleanup", () => {
  const rule = "no-set-state-after-await-in-effect";
  const marker = "useEffect(() =>";

  const withAbortedSignal = [
    "function useComments(id: string) {",
    "  const [comments, setComments] = useState([]);",
    "  useEffect(() => {",
    "    const controller = new AbortController();",
    `    fetch(\`/api/\${id}\`, { signal: controller.signal }).then(async (response) => {`,
    "      const payload = await response.json();",
    "      if (controller.signal.aborted) return;",
    "      setComments(payload);",
    "    });",
    "    return () => controller.abort();",
    "  }, [id]);",
    "  return comments;",
    "}",
    "",
  ].join("\n");

  const withFlagAndCall = [
    "function useVerify(slug: string) {",
    "  const [message, setMessage] = useState(null);",
    "  useEffect(() => {",
    "    if (!slug) return undefined;",
    "    let isActive = true;",
    "    async function verify() {",
    "      try {",
    "        const response = await submit(slug);",
    "        if (!isActive) return;",
    "        setMessage(response.message);",
    "      } catch (error) {",
    "        if (!isActive || isAbortError(error)) return;",
    "        setMessage(readError(error));",
    "      } finally {",
    "        if (isActive) setMessage(null);",
    "      }",
    "    }",
    "    void verify();",
    "    return () => {",
    "      isActive = false;",
    "    };",
    "  }, [slug]);",
    "  return message;",
    "}",
    "",
  ].join("\n");

  it("descarta los setters protegidos por signal.aborted de un controller que el cleanup aborta", () => {
    assert.equal(reportsIn(rule, withAbortedSignal, marker), false);
  });

  it("descarta los setters protegidos por una bandera que el cleanup apaga, también combinada con una llamada", () => {
    assert.equal(reportsIn(rule, withFlagAndCall, marker), false);
  });

  it("mantiene un setter sin guarda después del await", () => {
    const unguarded = withAbortedSignal.replace("      if (controller.signal.aborted) return;\n", "");
    assert.equal(reportsIn(rule, unguarded, marker), true);
    const catchUnguarded = withFlagAndCall.replace("if (!isActive || isAbortError(error)) return;", "if (isAbortError(error)) return;");
    assert.equal(reportsIn(rule, catchUnguarded, marker), true);
    const guardAfterCall = withFlagAndCall.replace("if (!isActive || isAbortError(error)) return;", "if (isAbortError(error) || !isActive) return;");
    assert.equal(reportsIn(rule, guardAfterCall, marker), true);
  });

  it("mantiene guardas sobre banderas o controllers que el cleanup no cambia", () => {
    const notAborted = withAbortedSignal.replace("return () => controller.abort();", "return () => undefined;");
    assert.equal(reportsIn(rule, notAborted, marker), true);
    const flagNotFlipped = withFlagAndCall.replace("      isActive = false;\n", "      console.log(isActive);\n");
    assert.equal(reportsIn(rule, flagNotFlipped, marker), true);
    const flagReset = withFlagAndCall.replace("void verify();", "isActive = true;\n    void verify();");
    assert.equal(reportsIn(rule, flagReset, marker), true);
    const conditionalCleanup = withFlagAndCall.replace("      isActive = false;\n", "      if (slug) isActive = false;\n");
    assert.equal(reportsIn(rule, conditionalCleanup, marker), true);
    const shadowed = withFlagAndCall.replace("        if (!isActive) return;", "        const isActive = true;\n        if (!isActive) return;");
    assert.equal(reportsIn(rule, shadowed, marker), true);
  });

  it("mantiene efectos que inician trabajo sin devolver cleanup en algún camino", () => {
    const earlyReturnAfterWork = withFlagAndCall.replace("    void verify();\n", "    void verify();\n    if (slug === \"x\") return;\n");
    assert.equal(reportsIn(rule, earlyReturnAfterWork, marker), true);
  });

  it("mantiene setters después del await en funciones del módulo que el efecto llama", () => {
    const source = [
      "async function load(setValue: (value: string) => void) {",
      "  const value = await read();",
      "  setValue(value);",
      "}",
      "function useValue() {",
      "  const [value, setValue] = useState(\"\");",
      "  useEffect(() => {",
      "    let isActive = true;",
      "    if (isActive) void load(setValue);",
      "    return () => {",
      "      isActive = false;",
      "    };",
      "  }, []);",
      "  return value;",
      "}",
      "",
    ].join("\n");
    assert.equal(reportsIn(rule, source, marker), true);
  });
});

describe("no-loading-flag-reset-outside-finally con el reset en finally", () => {
  const rule = "no-loading-flag-reset-outside-finally";
  const source = [
    "function useRun() {",
    "  const [inFlight, setInFlight] = useState(false);",
    "  const controller = useRef(null);",
    "  const run = async (work) => {",
    "    const current = new AbortController();",
    "    controller.current = current;",
    "    setInFlight(true);",
    "    try {",
    "      await work(current.signal);",
    "    } finally {",
    "      if (controller.current === current) {",
    "        setInFlight(false);",
    "      }",
    "    }",
    "  };",
    "  return { inFlight, run };",
    "}",
    "",
  ].join("\n");

  it("descarta el reset en finally condicionado a algo que el try no asigna", () => {
    assert.equal(reportsIn(rule, source, "setInFlight(false)"), false);
  });

  it("mantiene el reset cuya condición depende de cómo terminó el try", () => {
    const dependsOnTry = source
      .replace("    try {", "    let finished = false;\n    try {")
      .replace("      await work(current.signal);", "      await work(current.signal);\n      finished = true;")
      .replace("if (controller.current === current)", "if (finished)");
    assert.equal(reportsIn(rule, dependsOnTry, "setInFlight(false)"), true);
    const callInCondition = source.replace("if (controller.current === current)", "if (isOwner(current))");
    assert.equal(reportsIn(rule, callInCondition, "setInFlight(false)"), true);
    const earlyExit = source.replace("      if (controller.current === current) {", "      if (current.signal.aborted) return;\n      if (controller.current === current) {");
    assert.equal(reportsIn(rule, earlyExit, "setInFlight(false)"), true);
  });

  it("mantiene el reset fuera de finally", () => {
    const afterAwait = source.replace("      await work(current.signal);", "      await work(current.signal);\n      setInFlight(false);");
    assert.equal(reportsIn(rule, afterAwait, "setInFlight(false);\n    } finally"), true);
  });
});

describe("no-prop-callback-in-render con el setter del propio componente", () => {
  const rule = "no-prop-callback-in-render";
  const marker = "setStep(steps.indexOf(milestone))";
  const source = [
    'import { useMemo, useState } from "react";',
    "function useWorkflowState() {",
    "  const [step, setStep] = useState(0);",
    "  const setters = useMemo(() => ({ setStep }), []);",
    "  return { setters, values: { step } };",
    "}",
    "function useMilestoneStep(milestone: string | null, steps: string[], setStep: (step: number) => void) {",
    "  const [seen, setSeen] = useState<string | null>(null);",
    "  if (milestone !== seen) { setSeen(milestone); if (milestone) setStep(steps.indexOf(milestone)); }",
    "}",
    "function usePresentation({ workflow, steps }: { workflow: ReturnType<typeof useWorkflowState>; steps: string[] }) {",
    "  const { setters } = workflow;",
    "  useMilestoneStep(steps[0] ?? null, steps, setters.setStep);",
    "}",
    "export function Container({ steps }: { steps: string[] }) {",
    "  const workflow = useWorkflowState();",
    "  usePresentation({ workflow, steps });",
    "  return null;",
    "}",
    "",
  ].join("\n");

  it("descarta el setter de useState que llega por otros hooks del mismo componente", () => {
    assert.equal(reportsIn(rule, source, marker), false);
  });

  it("mantiene callbacks que llegan por props, exports, valores mutables u otros archivos", () => {
    const fromProps = source.replace(
      "export function Container({ steps }: { steps: string[] }) {\n  const workflow = useWorkflowState();",
      "export function Container({ steps, onStep }: { steps: string[]; onStep: (step: number) => void }) {\n  const workflow = { setters: { setStep: onStep } };",
    );
    assert.equal(reportsIn(rule, fromProps, marker), true);
    const exported = source.replace("function useMilestoneStep(", "export function useMilestoneStep(");
    assert.equal(reportsIn(rule, exported, marker), true);
    const mutated = source.replace("  const { setters } = workflow;", "  const { setters } = workflow;\n  setters.setStep = console.log;");
    assert.equal(reportsIn(rule, mutated, marker), true);
    const notReact = source.replace('import { useMemo, useState } from "react";', 'import { useMemo, useState } from "./hooks";');
    assert.equal(reportsIn(rule, notReact, marker), true);
    const firstElement = source.replace("const [step, setStep] = useState(0);", "const [setStep, step] = useState(0);");
    assert.equal(reportsIn(rule, firstElement, marker), true);
  });
});

describe("effect-needs-cleanup con métodos del proyecto que devuelven Promise<void>", () => {
  const rule = "effect-needs-cleanup";
  const message = "`observe` creates a subscription in a function that outlives the render, with no cleanup path.";
  const source = [
    "type Options = {",
    "  observe: <Value>(request: (signal: AbortSignal) => Promise<Value>, settle: (value: Value) => void) => Promise<void>;",
    "};",
    "export function useResource(options: Options) {",
    "  const read = async () => {",
    "    await options.observe((signal) => load(signal), (value) => apply(value));",
    "  };",
    "  return { read };",
    "}",
    "",
  ].join("\n");

  it("descarta la llamada a un método declarado como Promise<void>, también en un tipo importado", () => {
    assert.equal(reportsIn(rule, source, "options.observe(", message), false);
    const files = {
      "src/options.ts": "export interface Options {\n  observe(request: () => Promise<void>): Promise<void>;\n}\n",
      "src/view.tsx": 'import type { Options } from "./options";\nexport function useResource(options: Options) {\n  return () => options.observe(() => load());\n}\n',
    };
    const finding = findingAt(rule, "src/view.tsx", files["src/view.tsx"], "options.observe(", message);
    assert.equal(isReportedDiagnostic(finding, reader(files)), false);
  });

  it("mantiene observadores del navegador, promesas de un handle y tipos desconocidos", () => {
    const browser = "export function useSize(target: Element, observer: ResizeObserver) {\n  observer.observe(target);\n}\n";
    assert.equal(reportsIn(rule, browser, "observer.observe(", message), true);
    const handle = source.replace("=> Promise<void>;\n};", "=> Promise<() => void>;\n};");
    assert.equal(reportsIn(rule, handle, "options.observe(", message), true);
    const untyped = source.replace("export function useResource(options: Options)", "export function useResource(options)");
    assert.equal(reportsIn(rule, untyped, "options.observe(", message), true);
    const otherName = source.replace("options.observe(", "options.observe.call(options, ");
    assert.equal(reportsIn(rule, otherName, "options.observe.call(", message), true);
  });
});

describe("reglas de react-doctor que son consejos", () => {
  it("descarta no-layout-property-animation, no-array-index-as-key y no-locale-format-in-render", () => {
    for (const rule of ["no-layout-property-animation", "no-array-index-as-key", "no-locale-format-in-render"]) {
      assert.equal(reportsIn(rule, "export const value = 1;\n", "export"), false, rule);
    }
  });

  it("sigue reportando las reglas cercanas que encuentran defectos", () => {
    for (const rule of ["motion-animate-presence-must-outlive-child", "no-create-object-url-without-revoke"]) {
      assert.equal(reportsIn(rule, "export const value = 1;\n", "export"), true, rule);
    }
  });
});
