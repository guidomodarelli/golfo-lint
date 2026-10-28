# @golfo/lint

Reglas de calidad de código pensadas para **agentes de IA**, compartidas entre los proyectos golfo. Solo detectan defectos reales: bugs, código muerto o duplicado, complejidad, nombres poco claros, accesibilidad, CSS inválido, paquetes mal publicados, workflows rotos o inseguros, secretos, límites de arquitectura y monorepos inconsistentes.

Cuatro decisiones definen el paquete:

- **Ninguna regla de formato ni de estilo.** Nada de espacios, comillas, orden de imports o elegir entre dos formas equivalentes de escribir lo mismo: no cambian el comportamiento y solo agregan ruido. El formato es trabajo de un formateador.
- **Todo problema es un error.** Un agente actúa sobre fallas e ignora advertencias, así que no queda ninguna regla en `warn`.
- **No se puede silenciar una regla.** Los comentarios `eslint-disable` y `stylelint-disable` no tienen efecto o fallan: el agente tiene que corregir el código.
- **Un hallazgo, una regla, sin falsas alarmas.** Cuando dos reglas o dos herramientas reportan lo mismo queda una sola, y las reglas que marcan código válido (sugerencias de seguridad que piden revisar algo que casi siempre está bien, consejos que rompen código correcto si se aplican sin mirar) quedan apagadas: un agente no sabe cuándo ignorar un reporte. Todo se validó corriendo los análisis sobre TuTribu y agenda-mensual.

| Análisis | Herramienta | Configuración | Comando |
| --- | --- | --- | --- |
| Bugs, código confuso, complejidad, nombres, accesibilidad, React, Next.js, tests | bun lint (o ESLint) | `@golfo/lint/eslint` | `bun lint` |
| CSS y SCSS inválido o frágil | Stylelint | `@golfo/lint/stylelint` | `golfo-lint styles` |
| React: estado y efectos, rendimiento, seguridad, accesibilidad | react-doctor | — | `golfo-lint react` |
| Código duplicado | jscpd | `@golfo/lint/jscpd` | `golfo-lint duplicates` |
| Archivos, exports y dependencias sin uso o sin declarar | knip | `@golfo/lint/knip` | `golfo-lint unused` |
| Ciclos, devDependencies en producción, capas | dependency-cruiser | `@golfo/lint/dependency-cruiser` | `golfo-lint architecture` |
| Paquete publicado: exports, archivos y tipos | publint y Are the Types Wrong | — | `golfo-lint package` |
| Workflows de GitHub Actions | actionlint y zizmor | — | `golfo-lint workflows` |
| Secretos en archivos o en el historial | gitleaks | — | `golfo-lint secrets` |
| Versiones y `package.json` de un monorepo | sherif | — | `golfo-lint monorepo` |
| React en desarrollo: qué componentes se re-renderizan (medición, no análisis) | react-scan | `@golfo/lint/react-scan` | `golfo-lint react-scan` |

`golfo-lint all` ejecuta todos los análisis que aplican al proyecto (por ejemplo, `package` se saltea en paquetes privados y `monorepo` sin workspaces) y falla si alguno falla. `golfo-lint react-scan` no forma parte de `all`: no analiza, conecta una herramienta de medición.

## Instalación

```bash
pnpm add -D --save-exact @golfo/lint eslint
```

En proyectos con React, sumá react-doctor, que es opcional porque trae Playwright, Sentry y su propio TypeScript:

```bash
pnpm add -D --save-exact react-doctor@0.9.18
```

Con pnpm 12, aprobá el script de instalación de `unrs-resolver` (lo usa el resolver de TypeScript de import-x para verificar su binario nativo) en `pnpm-workspace.yaml`; si no, `pnpm install` falla:

```yaml
allowBuilds:
  unrs-resolver: true
```

Requiere Node.js 22.15 o superior y ESLint 10. Las herramientas de npm vienen como dependencias, todas en versiones exactas: una versión nueva de un plugin puede sumar reglas que hagan fallar un proyecto que hoy pasa, así que se actualizan a propósito y validadas. actionlint y zizmor se distribuyen como paquetes de Python: `golfo-lint` los ejecuta con `uvx` en versiones fijas, así que basta con tener [uv](https://docs.astral.sh/uv/). gitleaks es un binario de Go que hay que instalar (`winget install Gitleaks.Gitleaks`, `brew install gitleaks` o desde sus [releases](https://github.com/gitleaks/gitleaks/releases)).

## bun lint

Es la forma recomendada de correr el preset: `bun lint` lee el `eslint.config.js` tal cual, corre en nativo las reglas que implementa (las que necesitan tipos, sobre TypeScript 7) y las demás con los plugins de ESLint en JavaScript. Sobre las 200.000 líneas de TuTribu tarda 47 s, contra 4 a 5 minutos de ESLint, con los mismos hallazgos.

```js
// eslint.config.js
import { createEslintConfig } from "@golfo/lint/eslint";

export default createEslintConfig({ tsconfigRootDir: import.meta.dirname, linter: "bun", react: true, next: true, vitest: true });
```

```json
{ "scripts": { "lint": "bun lint --no-script --type-aware" } }
```

- `--no-script` hace falta porque `bun lint` corre el script `lint` del proyecto si existe, que sería él mismo.
- `linter: "bun"` deja afuera `golfo-lint/no-unnecessary-condition`: `bun lint` corre en JavaScript las reglas de los plugins y no les da tipos, y la versión de typescript-eslint trae los falsos positivos que esa regla evita.
- Las reglas con tipos usan, para cada archivo, el `tsconfig.json` más cercano. Si el `tsconfig.json` raíz excluye los tests, sumá uno en la carpeta de tests (por ejemplo `tests/tsconfig.json` con `"extends": "../tsconfig.test.json"` y `"include": ["**/*.ts", "**/*.tsx"]`); si no, sus tipos son `any` y aparecen cientos de falsos reportes.
- `bun lint` todavía está solo en las versiones canary de Bun (`bun upgrade --canary`, o `bun-version: canary` en `oven-sh/setup-bun`), hasta Bun 1.4.5.

## ESLint

```js
// eslint.config.js
import { createEslintConfig } from "@golfo/lint/eslint";

export default createEslintConfig({
  tsconfigRootDir: import.meta.dirname,
  react: true,
  next: true,
  vitest: true,
});
```

| Opción | Por defecto | Qué hace |
| --- | --- | --- |
| `tsconfigRootDir` | carpeta actual | Carpeta del `tsconfig.json` raíz, para las reglas con tipos. |
| `typeChecked` | `true` | Reglas que necesitan tipos: promesas sin esperar, `any` inseguro, condiciones innecesarias. |
| `tsconfigFiles` | detectado | Los tsconfig que cubren todos los archivos. Por defecto, `tsconfig.json` y `tsconfig.test.json` cuando existe el segundo: si el `tsconfig.json` raíz excluye los tests y nadie nombra el otro, typescript-eslint arma un programa de TypeScript por cada test y el análisis pasa de minutos a horas. Pasá la lista cuando los tsconfig tienen otros nombres, o `[]` para que el project service de typescript-eslint los busque. |
| `react` | `false` | Hooks de React, accesibilidad en JSX y `useEffect` innecesarios. |
| `next` | `false` | Reglas de Next.js, Core Web Vitals incluidas. |
| `vitest` | `false` | En los tests: sin `.only` ni `.skip`, sin tests sin asserts, `expect` válidos. |
| `linter` | `eslint` | `bun` para correrlo con `bun lint`: deja afuera `golfo-lint/no-unnecessary-condition`, que necesita tipos. |
| `awsCdk` | `false` | Reglas `sonarjs/aws-*`, que revisan infraestructura escrita con `aws-cdk-lib`. Sin AWS CDK no pueden reportar nada y se llevan cerca de una décima parte del tiempo del lint. |
| `allowDisableComments` | `false` | Permite `eslint-disable`, siempre con una explicación. |
| `ignores` | `[]` | Globs extra a ignorar, además de dependencias y build. |
| `testFiles` | rutas de test comunes | Archivos de test, con límites relajados. |

Qué incluye:

- **ESLint core** `recommended` más reglas como `eqeqeq` (salvo `== null`, que cubre `null` y `undefined` a propósito), `no-param-reassign`, `no-implicit-coercion`, `no-nested-ternary`, `id-length` y límites de largo, profundidad y callbacks anidados.
- **typescript-eslint** `strictTypeChecked`, más `switch-exhaustiveness-check`, `consistent-type-imports`, `no-magic-numbers` y `require-array-sort-compare` (los arrays de strings pueden ordenarse sin función: ids y claves canónicas se ordenan por código a propósito, y `localeCompare` haría depender el orden del idioma).
- **`golfo-lint/no-unnecessary-condition`** en lugar de `@typescript-eslint/no-unnecessary-condition`: la misma regla sin los reportes que se apoyan en tipos que TypeScript no puede conocer. TypeScript sigue considerando estrechada una propiedad después de un `await` o de una llamada, aunque pueda haber cambiado (`if (signal.aborted) return; await fetch(...); if (signal.aborted) ...`); sin `noUncheckedIndexedAccess`, un elemento de un array o una entrada de un record (`items[0]`, `countsById[id]`) parece siempre presente; un `let` que reasigna un callback o una función de limpieza conserva el tipo estrechado, porque TypeScript no sigue las asignaciones hechas en otra función (`let isCurrent = true` y `isCurrent = false` en el cleanup de un efecto); y las APIs del entorno parecen estar siempre, aunque falten en el servidor, en runtimes viejos o fuera de un contexto seguro (`globalThis.crypto?.randomUUID`, `if (!Element.prototype.scrollIntoView)` antes de un polyfill). Un agente que sigue esos reportes borra un chequeo que el código necesita.
- **SonarJS**: complejidad cognitiva máxima de 15, más las reglas que encontraron defectos reales en TuTribu (funciones idénticas, expresiones regulares con backtracking o demasiado complejas, asignaciones anidadas, colecciones que nunca se leen, `reverse()` que muta, esperas fijas en tests, entre otras). El resto de su `recommended` no encontró nada en 200.000 líneas, repetía a TypeScript u otra regla, o solo elegía una forma de escribir; con `bun lint` cada regla de SonarJS corre en JavaScript y cuesta tiempo en cada archivo. La complejidad cognitiva es la única medida de complejidad: cuenta lo que hace difícil leer una función (anidamiento, cortes del flujo) y no cada `case` de un `switch` plano, así que la complejidad ciclomática de ESLint (`complexity`) no se usa.
- **unicorn** `unopinionated`, más `catch-error-name` (el error del `catch` se llama `error`) y `name-replacements` con una lista propia que solo expande abreviaturas (`err`, `msg`, `btn`, `ctx`...). Los reemplazos de unicorn quedan apagados porque también abrevian (`application` por `app`).
- **import-x**: imports duplicados, exports mutables, auto-imports y rutas inútiles. Las reglas que repiten lo que TypeScript ya verifica (`named`, `default`, `namespace`, `no-unresolved`) quedan apagadas, y los ciclos los revisa `golfo-lint architecture` para todo el repositorio, mucho más rápido.
- **promise** y **regexp** `recommended`.
- **`golfo-lint/no-lint-disable`**: prohíbe los comentarios que apagan o reconfiguran reglas, tanto `eslint-disable` como `oxlint-disable`. Con `allowDisableComments`, **eslint-comments** exige que expliquen por qué.
- Con `react`: **react-hooks**, **jsx-a11y** (el fork `eslint-plugin-jsx-a11y-x`, porque el original todavía no soporta ESLint 10) y **react-you-might-not-need-an-effect**.
- Con `next`: **@next/eslint-plugin-next** `core-web-vitals`.
- Con `vitest`: **@vitest/eslint-plugin** `recommended`, más `no-standalone-expect`, `require-to-throw-message` y `valid-title`.
- Con `awsCdk`: las reglas `sonarjs/aws-*` de SonarJS.

Para garantizar que no haya reglas de formato ni de estilo, el preset apaga al final:

- todas las reglas de tipo `layout` de sus plugins;
- `STYLISTIC_SUGGESTION_RULES`: preferencias de sintaxis, como `window` o `globalThis`, `.replace(/x/g)` o `.replaceAll`, `[^\d]` o `\D`, `if` o ternario, `.then` o `await`. El tipo que declaran los plugins no las distingue (algunas son `problem`), por eso están listadas una por una;
- `DUPLICATED_RULES`: reglas que reportan lo mismo que otra regla activa o que otro análisis de golfo-lint (secretos: gitleaks), para que un agente no reciba dos veces el mismo hallazgo;
- `NON_DEFECT_RULES`: reglas que marcan código válido, como `no-promise-executor-return` en `new Promise((resolve) => setTimeout(resolve, ms))`, `prefer-nullish-coalescing` en un `||` que cae al valor por defecto con `""` o `0` a propósito, o `no-control-regex` en un patrón que rechaza caracteres de control.

Los tests lo verifican sobre la configuración final, igual que que no quede ninguna regla en `warn`. Las listas salieron de correr el preset sobre TuTribu y agenda-mensual.

En los tests se permiten `any` (cuerpos JSON sin tipo, `expect.any()`), `!` (si el valor falta, el test falla ahí mismo), funciones largas, complejas o con muchos parámetros (arman fixtures y recorren casos), relanzar lo que se capturó y errores sin `cause` (para no volcar datos privados en la salida del test).

TypeScript 7 todavía no es compatible con typescript-eslint ni con dependency-cruiser, así que el paquete trae su propio TypeScript 6 solo para el análisis, también en proyectos que compilan con TypeScript 7.

En un proyecto grande, el análisis con tipos tarda: unos 12 minutos para las 200.000 líneas de TuTribu en un solo hilo. Dos opciones lo bajan:

- `--concurrency auto` reparte los archivos entre hilos (cada uno arma su propio programa de TypeScript, así que usa más memoria). En TuTribu, con 4 hilos, tarda unos 6 minutos.
- `--cache --cache-strategy content` vuelve a analizar solo los archivos que cambiaron. Guardá la caché en la CI (por ejemplo con `actions/cache`) para que un PR chico tarde segundos. Como las reglas con tipos de un archivo dependen de los tipos de otros, la caché puede dejar un hallazgo viejo o perder uno nuevo cuando cambia un tipo que se usa en otro archivo: corré el análisis completo, sin caché, en la rama principal.

## Límites

Límites por función del preset de ESLint:

| Límite | Valor |
| --- | --- |
| Complejidad cognitiva (SonarJS) | 15 |
| Líneas de código (sin vacías ni comentarios) | 80 |
| Parámetros | 4 |
| Profundidad de bloques | 4 |
| Callbacks anidados | 3 |

En los tests se relajan el largo de función, los callbacks anidados, los números mágicos y los strings repetidos.

## Stylelint

`golfo-lint styles` analiza `**/*.{css,scss}`. Parte de `stylelint-config-recommended-scss`, que solo trae reglas que detectan errores, y suma: anidamiento máximo de 3 y hasta 4 selectores compuestos; en CSS Modules, además, sin `!important` ni ids (los estilos globales pueden usar `html.dark` o `#__next`). Acepta `:global` de CSS Modules y las at-rules de Tailwind 4, y apaga las reglas de estilo de `recommended-scss` (saltos de línea alrededor de operadores, cómo se escribe la ruta de un `@use`, líneas vacías en comentarios). Los comentarios `stylelint-disable` se ignoran.

```js
// stylelint.config.js
import { createStylelintConfig } from "@golfo/lint/stylelint";

export default createStylelintConfig({ bem: true });
```

Con `bem: true`, las clases deben seguir BEM: bloque en PascalCase, elementos en camelCase y modificadores en kebab-case (`CourseCard__title--muted`). Si el proyecto no tiene configuración, `golfo-lint styles` usa la compartida.

## dependency-cruiser

`golfo-lint architecture` analiza `src`, `app`, `components`, `lib`, `hooks` y `bin`. Prohíbe ciclos, devDependencies importadas desde código de producción (salvo desde carpetas `mocks/`, `__mocks__/` y `dev-mocks/`, como los handlers de MSW que se cargan solo en desarrollo), tests importados desde producción y módulos de Node.js deprecados. Cada regla explica qué hacer en lugar del import prohibido. Los imports que no resuelven y los paquetes que faltan en `package.json` los reporta `golfo-lint unused` (knip), que además conoce los paquetes que pone un framework.

dependency-cruiser no soporta TypeScript 7 y, si lo encuentra en el proyecto, saltea en silencio todos los archivos `.ts`: el chequeo pasaba sin analizar nada. `golfo-lint architecture` le hace usar el TypeScript 6 de `@golfo/lint` con un hook de resolución que carga con `--import`.

```js
// .dependency-cruiser.js
import { createDependencyCruiserConfig } from "@golfo/lint/dependency-cruiser";

export default createDependencyCruiserConfig({
  tsConfigFileName: "tsconfig.json",
  hexagonalModulesPath: "src/modules",
  forbiddenPaths: [{ name: "no-features", path: "^src/features/", comment: "src/features está deprecado: usá src/modules." }],
});
```

Con `hexagonalModulesPath`, cada subcarpeta es un módulo hexagonal: `domain` no puede depender de `application` ni de `infrastructure`, `application` no puede depender de `infrastructure`, y ninguna capa importa un `setup.ts` (el del módulo o el general de la carpeta), que es la raíz de composición que arma las capas.

## jscpd y knip

- `golfo-lint duplicates` falla cuando más del 1 % de las líneas está duplicado (bloques de al menos 50 tokens y 5 líneas). Un `.jscpd.json` del proyecto reemplaza los valores compartidos.
- `golfo-lint unused` corre knip con la configuración compartida, salvo que el proyecto tenga la suya. La compartida no reporta los exports de tipos que usa su propio archivo; toma como entrada la config de `@golfo/rp` (golfo-rp lee sus exports), los scripts que golfo-rp escribe en `.golfo-rp/`, `open-next.config.ts` y los scripts de `scripts/` que se corren por su ruta (`node scripts/x.mjs`); le pasa al plugin de Playwright todas las configs `playwright*.config.*`, también las de otras suites que un script elige con `--config`; y, en Next.js, acepta `server-only` y `client-only` sin declararlos: Next.js los resuelve solo y su documentación hace opcional instalarlos. Para sumar entradas o ignorar algo, exportá `createKnipConfig({ ... })` de `@golfo/lint/knip` en `knip.config.js`: `entry` e `ignoreDependencies` se suman a los valores compartidos y el resto de las opciones los reemplaza.

## react-doctor

`golfo-lint react`, en proyectos que dependen de `react`, corre [react-doctor](https://github.com/millionco/react-doctor), instalado en el propio proyecto (si falta, termina con código 3 y dice cómo instalarlo): unas 900 reglas de bugs, estado y efectos, rendimiento, seguridad, accesibilidad y mantenibilidad. Sus reglas de diseño visual vienen apagadas, porque el propio react-doctor las considera preferencias de una guía de diseño. `golfo-lint` lo ejecuta con:

- `--blocking warning`: las advertencias también fallan.
- `--no-respect-inline-disables`: los comentarios que silencian reglas no tienen efecto.
- `--no-telemetry` y `--no-supply-chain`: no envía datos de uso, el score ni la lista de dependencias a servicios externos.

golfo-lint lee el reporte JSON de react-doctor y muestra solo lo que ningún otro análisis reporta:

- las reglas de ESLint, typescript-eslint, React Compiler (`react-hooks-js`) y knip que react-doctor vuelve a correr, más sus copias de jsx-a11y, de `react-you-might-not-need-an-effect` y de los límites de tamaño y complejidad. Su copia de React Compiler además toma por hooks a propiedades como `modules.auth.useCases` y a métodos `use...`, y su regla `todo` reporta sintaxis que el compilador todavía no soporta (`try`/`finally`), que es código válido;
- los consejos que rompen código correcto si se aplican sin mirar: paralelizar `await` en serie (escrituras en una transacción, pasos en orden), usar un `Set` para arrays de pocos elementos, `useState` inicializado desde una prop para editar una copia, formularios que se envían con JavaScript, pedidos desde un efecto, Fast Refresh, y la migración de Zod 3 a 4 en proyectos que ya usan Zod 4;
- la lectura del cuerpo de un `fetch` cuando el código revisa `response.ok` o `response.status` en las líneas siguientes (leer primero el mensaje de error de la API es válido), y `sql.raw(...)` cuando todas sus llamadas del archivo reciben SQL fijo en el código: un string literal, o una `const` que lo guarda, también importada de otro módulo del proyecto (un valor que viene de un parámetro, una llamada o un paquete se sigue reportando);
- `type={CONSTANTE}` en botones de archivos `.tsx`, que react-doctor no sabe leer y TypeScript ya valida (en JavaScript se sigue reportando);
- las páginas HTML y los workflows, que no son código de React.

Un `doctor.config.ts` del proyecto puede ajustar reglas. react-doctor usa una licencia MIT modificada que pide permiso para usarlo como datos de entrenamiento de IA o para venderlo como servicio; usarlo como linter no está restringido.

## react-scan

[react-scan](https://github.com/aidenybai/react-scan) (MIT) resalta en la página los componentes que se re-renderizan, para medir renders de más mientras se desarrolla. No detecta defectos ni falla: corre solo en desarrollo (`next dev`, `vite`), nunca en CI ni en producción.

`golfo-lint react-scan`, en proyectos que dependen de `react`:

1. Si `package.json` no declara `react-scan`, lo instala como devDependency en la versión exacta con la que se testea golfo-lint (`react-scan@0.5.7`), con el package manager del proyecto (el campo `packageManager` o el lockfile, también el del monorepo).
2. Agrega al principio del archivo que arranca la app en el navegador:

   ```ts
   import { startReactScan } from "@golfo/lint/react-scan";

   startReactScan();
   ```

   En Next.js 15.3 o posterior (App Router y Pages Router) es `instrumentation-client.ts` (o `.js`), en la raíz o en `src/`, que crea si no existe; en Vite, el módulo que carga `index.html`.
3. Muestra el diff de cada archivo que cambió. Es idempotente: si el archivo ya inicia react-scan, o lo carga por su cuenta, no lo toca.

Si no detecta Next.js 15.3 o posterior ni Vite, no cambia nada, termina con código 4 y explica cómo conectarlo a mano: las mismas dos líneas en el entry del cliente del bundler. No usa `npx react-scan init`, que carga el script desde unpkg sin versión fija, en Vite no lo limita a desarrollo y ofrece instalar `react-doctor@latest`.

`startReactScan(options)` recibe las opciones de `scan()` de react-scan. Solo actúa en el navegador cuando `process.env.NODE_ENV === "development"`; en producción, en el servidor y en tests no hace nada. Importa react-scan del paquete instalado (nunca de un CDN) con un `import()` dinámico dentro de esa comparación, que Next.js (webpack y Turbopack) y Vite reemplazan por una constante: sus builds de producción no incluyen react-scan (verificado con `next build`, `next build --webpack` y `vite build`). Antes de iniciarlo define `window.__REACT_GRAB__`, porque sin esa marca react-scan consulta la última versión de react-grab en react-grab.com cada vez que arranca; como efecto, se desactiva su atajo Cmd/Ctrl+C para copiar el elemento inspeccionado.

react-scan pide cargarse antes que React. Un `import()` dinámico no lo cumple: React DOM ya se evaluó cuando react-scan llega, así que su renderer no queda registrado en el hook de DevTools. En desarrollo igual ve cada render, porque Fast Refresh (Next.js y Vite) instala ese hook antes que React; medido en Next.js 16 (App y Pages Router, webpack y Turbopack) y Vite 8, react-scan muestra su barra y reporta los renders. A cambio, la lógica de desarrollo vive en golfo-lint y cada proyecto solo tiene esas dos líneas.

`@golfo/lint/react-scan` es la única devDependency que el código de producción puede importar sin que `golfo-lint architecture` lo marque, porque el import desaparece de los builds de producción. Como el código de la app importa `@golfo/lint`, el build tiene que correr con las devDependencies instaladas, como ya pasa con TypeScript o Vite.

Para sacarlo: borrá esas dos líneas (o el `instrumentation-client` que creó, si no tenía otra cosa) y desinstalá `react-scan`.

## Paquetes, workflows, secretos y monorepos

- `golfo-lint package`, en paquetes publicables: publint en modo estricto y Are the Types Wrong sobre el resultado de `npm pack`, con el perfil `esm-only` cuando el paquete es ESM y no ofrece `require`.
- `golfo-lint workflows`: actionlint (sintaxis, expresiones, scripts de shell) y zizmor (inyecciones, acciones sin fijar a un commit, credenciales persistidas), que falla desde la severidad media. actionlint todavía no conoce los pasos en segundo plano de GitHub Actions (`background`, `wait`, `wait-all`, `cancel` y `parallel`) y los marca como errores de sintaxis: golfo-lint le pasa esos workflows reescritos con pasos equivalentes, sin mover ninguna línea, así que igual revisa los pasos de cada grupo `parallel` y reporta la línea y la columna originales.
- `golfo-lint secrets`: gitleaks sobre todo el historial de git, o sobre los archivos de la carpeta fuera de un repositorio, con todas sus reglas. Hay dos excepciones: la regla genérica `generic-api-key` en tests y Markdown, donde solo encuentra placeholders, y los hashes de contenido de 16 caracteres que golfo-kit guarda en `.golfo/skill-coverage/`; las reglas de proveedores (GitHub, AWS, Stripe...) aplican en todos lados, también a cualquier otro valor de esos archivos. Un `.gitleaks.toml` del proyecto reemplaza la configuración compartida. Los hallazgos se muestran redactados.
- `golfo-lint monorepo`, con workspaces: sherif (versiones distintas de una dependencia, campos faltantes), sin su regla de ordenar dependencias.

Sin argumentos, cada comando analiza la carpeta actual con los valores compartidos; los argumentos se pasan tal cual a la herramienta.

## Códigos de salida

| Código | Significado |
| --- | --- |
| 0 | El análisis pasó o no aplica al proyecto. |
| 1 o más | El análisis encontró problemas (cada herramienta usa su propio código; `golfo-lint react` usa 1). |
| 2 | Análisis desconocido o sin análisis. |
| 3 | No se pudo ejecutar la herramienta. |
| 4 | `golfo-lint react-scan` no encontró dónde conectar react-scan y no cambió nada. |

## Desarrollo

```bash
npm ci
npm run ci
node bin/golfo-lint.js all
npm run check:packed-install
```

`check:packed-install` empaqueta el paquete con `npm pack`, lo instala con pnpm en un proyecto de prueba temporal y verifica que el preset de ESLint, la config de Stylelint y cada subcomando encuentren sus plugins y ejecutables, como le pasaría a un proyecto real. Necesita pnpm y acceso al registry.

Los tests ejecutan las herramientas reales sobre `test/fixtures`. Los que necesitan `uvx` (actionlint y zizmor) o `gitleaks` se saltean si no están instalados; el CI instala los dos. Los releases se publican con `npm run create-version` (`@golfo/rp`). Las reglas para agentes que trabajan en este repositorio están en [AGENTS.md](AGENTS.md).
