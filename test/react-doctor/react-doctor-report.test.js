import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatDiagnostics, isReportedDiagnostic } from "../../src/react-doctor/react-doctor-report.js";

/**
 * Builds a react-doctor finding.
 * @param {Partial<import("../../src/react-doctor/react-doctor-report.js").ReactDoctorDiagnostic>} fields - Fields
 * that change from a React finding in `components/card.tsx`.
 * @returns {import("../../src/react-doctor/react-doctor-report.js").ReactDoctorDiagnostic} Finding.
 */
function diagnostic(fields) {
  return {
    filePath: "components/card.tsx",
    plugin: "react-doctor",
    rule: "no-side-effect-in-state-updater-function",
    severity: "warning",
    message: "This side-effecting call runs inside a state updater.",
    line: 3,
    column: 5,
    ...fields,
  };
}

describe("isReportedDiagnostic", () => {
  it("reporta los hallazgos de React que ninguna otra regla de golfo-lint reporta", () => {
    assert.equal(isReportedDiagnostic(diagnostic({})), true);
    assert.equal(isReportedDiagnostic(diagnostic({ rule: "button-has-type", message: "This button has no `type`." })), true);
  });

  it("descarta las reglas que ESLint ya corre: React Compiler, ESLint y TypeScript", () => {
    for (const plugin of ["react-hooks-js", "eslint", "typescript", "knip"]) {
      assert.equal(isReportedDiagnostic(diagnostic({ plugin, rule: "todo" })), false, plugin);
    }
  });

  it("descarta lo que ya reportan sonarjs, jsx-a11y y react-you-might-not-need-an-effect", () => {
    for (const rule of ["no-giant-component", "no-high-complexity-react-function", "click-events-have-key-events", "no-pass-data-to-parent"]) {
      assert.equal(isReportedDiagnostic(diagnostic({ rule })), false, rule);
    }
  });

  it("descarta los consejos que rompen código válido si se aplican sin mirar", () => {
    for (const rule of ["async-await-in-loop", "server-sequential-independent-await", "no-prevent-default", "no-derived-useState"]) {
      assert.equal(isReportedDiagnostic(diagnostic({ rule })), false, rule);
    }
  });

  it("descarta type={CONSTANTE} en botones de archivos .tsx, que TypeScript ya valida", () => {
    const message = "This button has an invalid `type`, so the browser may treat it like a submit button.";
    assert.equal(isReportedDiagnostic(diagnostic({ rule: "button-has-type", message, filePath: "components/form.tsx" })), false);
  });

  it("mantiene un type inválido en botones de JavaScript, que TypeScript no revisa", () => {
    const message = "This button has an invalid `type`, so the browser may treat it like a submit button.";
    assert.equal(isReportedDiagnostic(diagnostic({ rule: "button-has-type", message, filePath: "components/form.jsx" })), true);
  });

  it("descarta la lectura del cuerpo de un fetch cuando la respuesta se revisa después", () => {
    const source = [
      "async function save() {",
      "  const response = await fetch(\"/api/save\");",
      "  const body = await response.json().catch(() => ({}));",
      "  if (!response.ok) throw new Error(body.message);",
      "  return body;",
      "}",
    ].join("\n");
    const fetchFinding = diagnostic({ rule: "no-fetch-response-used-without-status-check", line: 2 });
    assert.equal(isReportedDiagnostic(fetchFinding, () => source), false);
    const unchecked = source.replace("  if (!response.ok) throw new Error(body.message);\n", "");
    assert.equal(isReportedDiagnostic(fetchFinding, () => unchecked), true);
    assert.equal(isReportedDiagnostic(fetchFinding), true);
  });

  it("descarta sql.raw solo cuando todas sus llamadas del archivo reciben constantes", () => {
    const finding = diagnostic({ rule: "raw-sql-injection-risk", filePath: "src/repository.ts", line: 1 });
    const constants = 'await db.execute(sql.raw(EFFECT_SQL.begin));\nawait db.execute(sql.raw("rollback"));\n';
    assert.equal(isReportedDiagnostic(finding, () => constants), false);
    const dynamic = `${constants}const column = sql.raw(\`payload ->> '\${key}'\`);\n`;
    assert.equal(isReportedDiagnostic(finding, () => dynamic), true);
    const nested = `${constants}await db.execute(sql.raw(String(input)));\n`;
    assert.equal(isReportedDiagnostic(finding, () => nested), true);
  });

  it("descarta páginas HTML y workflows, que no son código de React", () => {
    assert.equal(isReportedDiagnostic(diagnostic({ filePath: "user-guides/index.html" })), false);
    assert.equal(isReportedDiagnostic(diagnostic({ filePath: ".github/workflows/release.yml" })), false);
  });
});

describe("formatDiagnostics", () => {
  it("agrupa por archivo, ordena por línea y cuenta los problemas", () => {
    const text = formatDiagnostics([
      diagnostic({ line: 9, help: "Move it outside the updater." }),
      diagnostic({ line: 2 }),
      diagnostic({ filePath: "app/page.tsx" }),
    ]);
    assert.match(text, /^components\/card\.tsx\n {2}2:5 {2}warning/u);
    assert.match(text, /9:5 {2}warning .*react-doctor\/no-side-effect-in-state-updater-function\n {6}Move it outside the updater\./u);
    assert.match(text, /app\/page\.tsx/u);
    assert.match(text, /3 problema\(s\) de react-doctor\.$/u);
  });
});
