import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { rewriteBackgroundSteps, usesBackgroundSteps } from "../../src/workflows/background-steps.js";

const WORKFLOW = [
  "jobs:",
  "  build:",
  "    steps:",
  "      - name: Start server",
  "        id: server",
  "        run: npm start",
  "        background: true",
  "      - parallel:",
  "          - name: Lint",
  "            run: npm run lint",
  "          - name: Test",
  "            run: npm test",
  "      - name: Wait for the server",
  "        wait: server",
  "      - name: Wait for several",
  "        wait:",
  "          - server",
  "      - wait-all:",
  "      - name: Stop",
  "        cancel: server",
  "",
].join("\n");

describe("rewriteBackgroundSteps", () => {
  it("detecta los workflows con pasos en segundo plano", () => {
    assert.equal(usesBackgroundSteps(WORKFLOW), true);
    assert.equal(usesBackgroundSteps("jobs:\n  build:\n    steps:\n      - run: npm test\n"), false);
  });

  it("deja cada línea en su lugar y convierte los pasos nuevos en pasos que actionlint entiende", () => {
    const { text, columnShifts } = rewriteBackgroundSteps(WORKFLOW);
    const lines = text.split("\n");
    assert.equal(lines.length, WORKFLOW.split("\n").length);
    assert.equal(lines[6], "        # background: true");
    assert.equal(lines[7], "      # parallel:");
    assert.equal(lines[8], "      - name: Lint");
    assert.equal(lines[11], "        run: npm test");
    assert.equal(lines[13], '        run: "true"');
    assert.equal(lines[15], '        run: "true"');
    assert.equal(lines[16], "          # - server");
    assert.equal(lines[17], '      - run: "true"');
    assert.equal(lines[19], '        run: "true"');
    assert.equal(columnShifts.get(9), 4);
    assert.equal(columnShifts.get(12), 4);
    assert.equal(columnShifts.get(13), undefined);
  });

  it("no toca claves con el mismo nombre que no son de un paso", () => {
    const workflow = "jobs:\n  build:\n    steps:\n      - uses: actions/example@v1\n        with:\n          wait: 5\n";
    assert.equal(rewriteBackgroundSteps(workflow).text, workflow);
  });

  it("cuando background abre el paso, usa una clave que el paso no tiene, para no repetir name", () => {
    const workflow = "jobs:\n  build:\n    steps:\n      - background: true\n        name: Start server\n        run: npm start\n";
    const lines = rewriteBackgroundSteps(workflow).text.split("\n");
    assert.equal(lines[3], "      - continue-on-error: false");
    assert.equal(lines[4], "        name: Start server");
  });

  it("si el paso ya tiene todas las claves de reemplazo, lo abre con su clave siguiente", () => {
    const workflow = [
      "jobs:",
      "  build:",
      "    steps:",
      "      - background: true",
      "        name: Server",
      "        continue-on-error: true",
      "        timeout-minutes: 5",
      "        shell: bash",
      "        run: npm start",
      "",
    ].join("\n");
    const lines = rewriteBackgroundSteps(workflow).text.split("\n");
    assert.equal(lines[3], "      - name: Server");
    assert.equal(lines[4], "        # background: true");
    assert.equal(lines.length, workflow.split("\n").length);
  });

  it("reconoce los pasos alineados con steps:, que YAML permite", () => {
    const workflow = "jobs:\n  build:\n    steps:\n    - run: npm start\n      background: true\n    - wait: server\n    env:\n      CI: true\n";
    assert.equal(usesBackgroundSteps(workflow), true);
    const lines = rewriteBackgroundSteps(workflow).text.split("\n");
    assert.equal(lines[4], "      # background: true");
    assert.equal(lines[5], '    - run: "true"');
    assert.equal(lines[7], "      CI: true");
  });

  it("comenta la lista de wait aunque sus elementos estén en la columna de la clave", () => {
    const workflow = "jobs:\n  build:\n    steps:\n      - name: Wait\n        wait:\n        - server\n        - worker\n        timeout-minutes: 5\n";
    const lines = rewriteBackgroundSteps(workflow).text.split("\n");
    assert.equal(lines[4], '        run: "true"');
    assert.equal(lines[5], "        # - server");
    assert.equal(lines[6], "        # - worker");
    assert.equal(lines[7], "        timeout-minutes: 5");
  });

  it("reconoce steps: y parallel: con un comentario al final", () => {
    const workflow = "jobs:\n  build:\n    steps: # services\n      - run: npm start\n        background: true\n      - parallel: # checks\n          - run: npm test\n";
    assert.equal(usesBackgroundSteps(workflow), true);
    const lines = rewriteBackgroundSteps(workflow).text.split("\n");
    assert.equal(lines[4], "        # background: true");
    assert.equal(lines[6], "      - run: npm test");
  });

  it("no toma como pasos el texto de un script run: |, aunque escriba YAML", () => {
    const workflow = [
      "jobs:",
      "  build:",
      "    steps:",
      "      - run: |",
      "          cat > ci.yml <<'EOF'",
      "          steps:",
      "            - wait: server",
      "          EOF",
      "        background: true",
      "",
    ].join("\n");
    const lines = rewriteBackgroundSteps(workflow).text.split("\n");
    assert.equal(lines[6], "            - wait: server");
    assert.equal(lines[8], "        # background: true");
  });

  it("no confunde con pasos las entradas de otras listas, como las de una matriz", () => {
    const workflow = [
      "jobs:",
      "  build:",
      "    strategy:",
      "      matrix:",
      "        include:",
      "          - background: true",
      "            name: server",
      "    steps:",
      "      - run: npm test",
      "",
    ].join("\n");
    assert.equal(usesBackgroundSteps(workflow), false);
    assert.equal(rewriteBackgroundSteps(workflow).text, workflow);
  });
});
