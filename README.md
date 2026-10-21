# @golfo/lint

Reglas de calidad de código pensadas para **agentes de IA**, compartidas entre los proyectos golfo. Solo detectan defectos reales: bugs, código muerto o duplicado, complejidad, nombres poco claros, accesibilidad, CSS inválido, paquetes mal publicados, workflows rotos o inseguros, secretos, límites de arquitectura y monorepos inconsistentes.

Tres decisiones definen el paquete:

- **Ninguna regla de formato ni de estilo.** Nada de espacios, comillas, orden de imports o elegir entre dos formas equivalentes de escribir lo mismo: no cambian el comportamiento y solo agregan ruido. El formato es trabajo de un formateador.
- **Todo problema es un error.** Un agente actúa sobre fallas e ignora advertencias, así que no queda ninguna regla en `warn`.
- **No se puede silenciar una regla.** Los comentarios `eslint-disable` y `stylelint-disable` no tienen efecto o fallan: el agente tiene que corregir el código.

| Análisis | Herramienta | Configuración | Comando |
| --- | --- | --- | --- |
| Bugs, código confuso, nombres, accesibilidad, React, Next.js, tests | ESLint | `@golfo/lint/eslint` | `eslint .` |
| CSS y SCSS inválido o frágil | Stylelint | `@golfo/lint/stylelint` | `golfo-lint styles` |
| React: estado y efectos, rendimiento, seguridad, accesibilidad | react-doctor | — | `golfo-lint react` |
| Código duplicado | jscpd | `@golfo/lint/jscpd` | `golfo-lint duplicates` |
| Archivos, exports y dependencias sin uso | knip | `@golfo/lint/knip` | `golfo-lint unused` |
| Complejidad, largo y parámetros por función | lizard | `@golfo/lint/lizard` | `golfo-lint complexity` |
| Ciclos, paquetes no declarados, capas | dependency-cruiser | `@golfo/lint/dependency-cruiser` | `golfo-lint architecture` |
| Paquete publicado: exports, archivos y tipos | publint y Are the Types Wrong | — | `golfo-lint package` |
| Workflows de GitHub Actions | actionlint y zizmor | — | `golfo-lint workflows` |
| Secretos en archivos o en el historial | gitleaks | — | `golfo-lint secrets` |
| Versiones y `package.json` de un monorepo | sherif | — | `golfo-lint monorepo` |

`golfo-lint all` ejecuta todos los análisis que aplican al proyecto (por ejemplo, `package` se saltea en paquetes privados y `monorepo` sin workspaces) y falla si alguno falla.

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

Requiere Node.js 22.13 o superior y ESLint 10. Las herramientas de npm vienen como dependencias, todas en versiones exactas: una versión nueva de un plugin puede sumar reglas que hagan fallar un proyecto que hoy pasa, así que se actualizan a propósito y validadas. lizard, actionlint y zizmor se distribuyen como paquetes de Python: `golfo-lint` los ejecuta con `uvx` en versiones fijas, así que basta con tener [uv](https://docs.astral.sh/uv/). gitleaks es un binario de Go que hay que instalar (`winget install Gitleaks.Gitleaks`, `brew install gitleaks` o desde sus [releases](https://github.com/gitleaks/gitleaks/releases)).

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
| `allowDisableComments` | `false` | Permite `eslint-disable`, siempre con una explicación. |
| `ignores` | `[]` | Globs extra a ignorar, además de dependencias y build. |
| `testFiles` | rutas de test comunes | Archivos de test, con límites relajados. |

Qué incluye:

- **ESLint core** `recommended` más reglas como `eqeqeq` (salvo `== null`, que cubre `null` y `undefined` a propósito), `no-param-reassign`, `no-implicit-coercion`, `no-nested-ternary`, `id-length` y límites de complejidad.
- **typescript-eslint** `strictTypeChecked`, más `switch-exhaustiveness-check`, `prefer-nullish-coalescing`, `consistent-type-imports` y `no-magic-numbers`.
- **SonarJS** `recommended`, con complejidad cognitiva máxima de 15.
- **unicorn** `unopinionated`, más `catch-error-name` (el error del `catch` se llama `error`) y `name-replacements` con una lista propia que solo expande abreviaturas (`err`, `msg`, `btn`, `ctx`...). Los reemplazos de unicorn quedan apagados porque también abrevian (`application` por `app`).
- **import-x**: imports duplicados, exports mutables, auto-imports y rutas inútiles. Las reglas que repiten lo que TypeScript ya verifica (`named`, `default`, `namespace`, `no-unresolved`) quedan apagadas, y los ciclos los revisa `golfo-lint architecture` para todo el repositorio, mucho más rápido.
- **promise** y **regexp** `recommended`.
- **eslint-comments**: prohíbe los comentarios que apagan reglas.
- Con `react`: **react-hooks**, **jsx-a11y** (el fork `eslint-plugin-jsx-a11y-x`, porque el original todavía no soporta ESLint 10) y **react-you-might-not-need-an-effect**.
- Con `next`: **@next/eslint-plugin-next** `core-web-vitals`.
- Con `vitest`: **@vitest/eslint-plugin** `recommended`, más `no-standalone-expect`, `require-to-throw-message` y `valid-title`.

Para garantizar que no haya reglas de formato ni de estilo, el preset apaga al final:

- todas las reglas de tipo `layout` de sus plugins;
- `STYLISTIC_SUGGESTION_RULES`: preferencias de sintaxis, como `window` o `globalThis`, `.replace(/x/g)` o `.replaceAll`, `[^\d]` o `\D`, `if` o ternario, `.then` o `await`. El tipo que declaran los plugins no las distingue (algunas son `problem`), por eso están listadas una por una;
- `DUPLICATED_RULES`: reglas que reportan lo mismo que otra regla activa, para que un agente no reciba dos veces el mismo hallazgo.

Los tests lo verifican sobre la configuración final, igual que que no quede ninguna regla en `warn`. Las listas salieron de correr el preset sobre TuTribu y agenda-mensual.

TypeScript 7 todavía no es compatible con typescript-eslint, así que el paquete trae su propio TypeScript 6 solo para el análisis.

## Límites compartidos

ESLint y lizard usan los mismos límites por función:

| Límite | Valor |
| --- | --- |
| Complejidad ciclomática | 10 |
| Complejidad cognitiva (SonarJS) | 15 |
| Líneas de código (sin vacías ni comentarios) | 80 |
| Parámetros (solo ESLint: lizard cuenta cada prop desestructurada como parámetro) | 4 |
| Profundidad de bloques | 4 |
| Callbacks anidados | 3 |

En los tests se relajan el largo de función, los callbacks anidados, los números mágicos y los strings repetidos.

## Stylelint

`golfo-lint styles` analiza `**/*.{css,scss}`. Parte de `stylelint-config-recommended-scss`, que solo trae reglas que detectan errores, y suma: anidamiento máximo de 3, hasta 4 selectores compuestos y sin propiedades redundantes; en CSS Modules, además, sin `!important` ni ids (los estilos globales pueden usar `html.dark` o `#__next`). Acepta `:global` de CSS Modules y las at-rules de Tailwind 4, y apaga las reglas de estilo de `recommended-scss` (saltos de línea alrededor de operadores, cómo se escribe la ruta de un `@use`, líneas vacías en comentarios). Los comentarios `stylelint-disable` se ignoran.

```js
// stylelint.config.js
import { createStylelintConfig } from "@golfo/lint/stylelint";

export default createStylelintConfig({ bem: true });
```

Con `bem: true`, las clases deben seguir BEM: bloque en PascalCase, elementos en camelCase y modificadores en kebab-case (`CourseCard__title--muted`). Si el proyecto no tiene configuración, `golfo-lint styles` usa la compartida.

## dependency-cruiser

`golfo-lint architecture` analiza `src`, `app`, `components`, `lib`, `hooks` y `bin`. Prohíbe ciclos, imports que no resuelven, paquetes que no están en `package.json`, devDependencies importadas desde código de producción, tests importados desde producción y módulos de Node.js deprecados. Cada regla explica qué hacer en lugar del import prohibido.

```js
// .dependency-cruiser.js
import { createDependencyCruiserConfig } from "@golfo/lint/dependency-cruiser";

export default createDependencyCruiserConfig({
  tsConfigFileName: "tsconfig.json",
  hexagonalModulesPath: "src/modules",
  forbiddenPaths: [{ name: "no-features", path: "^src/features/", comment: "src/features está deprecado: usá src/modules." }],
});
```

Con `hexagonalModulesPath`, cada subcarpeta es un módulo hexagonal: `domain` no puede depender de `application` ni de `infrastructure`, y `application` no puede depender de `infrastructure`.

## jscpd, knip y lizard

- `golfo-lint duplicates` falla cuando más del 1 % de las líneas está duplicado (bloques de al menos 50 tokens y 5 líneas). Un `.jscpd.json` del proyecto reemplaza los valores compartidos.
- `golfo-lint unused` corre knip. Para partir de los valores compartidos, exportá `createKnipConfig()` de `@golfo/lint/knip` en `knip.config.js`.
- `golfo-lint complexity` corre lizard con los límites compartidos. Lo busca instalado, después con `uvx lizard@1.24.1` y después con `python -m lizard`.

## react-doctor

`golfo-lint react`, en proyectos que dependen de `react`, corre [react-doctor](https://github.com/millionco/react-doctor), instalado en el propio proyecto (si falta, termina con código 3 y dice cómo instalarlo): unas 900 reglas de bugs, estado y efectos, rendimiento, seguridad, accesibilidad y mantenibilidad. Sus reglas de diseño visual vienen apagadas, porque el propio react-doctor las considera preferencias de una guía de diseño. `golfo-lint` lo ejecuta con:

- `--blocking warning`: las advertencias también fallan.
- `--no-respect-inline-disables`: los comentarios que silencian reglas no tienen efecto.
- `--no-telemetry` y `--no-supply-chain`: no envía datos de uso, el score ni la lista de dependencias a servicios externos.

Un `doctor.config.ts` del proyecto puede ajustar reglas. react-doctor usa una licencia MIT modificada que pide permiso para usarlo como datos de entrenamiento de IA o para venderlo como servicio; usarlo como linter no está restringido.

## Paquetes, workflows, secretos y monorepos

- `golfo-lint package`, en paquetes publicables: publint en modo estricto y Are the Types Wrong sobre el resultado de `npm pack`, con el perfil `esm-only` cuando el paquete es ESM y no ofrece `require`.
- `golfo-lint workflows`: actionlint (sintaxis, expresiones, scripts de shell) y zizmor (inyecciones, acciones sin fijar a un commit, credenciales persistidas), que falla desde la severidad media.
- `golfo-lint secrets`: gitleaks sobre todo el historial de git, o sobre los archivos de la carpeta fuera de un repositorio, con todas sus reglas. La única excepción es la regla genérica `generic-api-key` en tests y Markdown, donde solo encuentra placeholders; las reglas de proveedores (GitHub, AWS, Stripe...) aplican en todos lados. Un `.gitleaks.toml` del proyecto reemplaza la configuración compartida. Los hallazgos se muestran redactados.
- `golfo-lint monorepo`, con workspaces: sherif (versiones distintas de una dependencia, campos faltantes), sin su regla de ordenar dependencias.

Sin argumentos, cada comando analiza la carpeta actual con los valores compartidos; los argumentos se pasan tal cual a la herramienta.

## Códigos de salida

| Código | Significado |
| --- | --- |
| 0 | El análisis pasó o no aplica al proyecto. |
| 1 o más | El análisis encontró problemas (cada herramienta usa su propio código). |
| 2 | Análisis desconocido o sin análisis. |
| 3 | No se pudo ejecutar la herramienta. |

## Desarrollo

```bash
npm ci
npm run ci
node bin/golfo-lint.js all
npm run check:packed-install
```

`check:packed-install` empaqueta el paquete con `npm pack`, lo instala con pnpm en un proyecto de prueba temporal y verifica que el preset de ESLint, la config de Stylelint y cada subcomando encuentren sus plugins y ejecutables, como le pasaría a un proyecto real. Necesita pnpm y acceso al registry.

Los tests ejecutan las herramientas reales sobre `test/fixtures`. Los que necesitan `uvx` o `gitleaks` se saltean si no están instalados; el CI instala los dos. Los releases se publican con `npm run create-version` (`@golfo/rp`). Las reglas para agentes que trabajan en este repositorio están en [AGENTS.md](AGENTS.md).
