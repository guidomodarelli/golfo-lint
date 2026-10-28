# Changelog

Todos los cambios relevantes de `@golfo/lint` se documentan en este archivo, según [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y [Semantic Versioning](https://semver.org/lang/es/).

## [Unreleased]

### Fixed

- `golfo-lint unused` ya no reporta como archivos sin uso las configs en JavaScript de dependency-cruiser (`.dependency-cruiser.mjs`) y de Stylelint que cargan `golfo-lint architecture` y `golfo-lint styles`: knip no las encontraba porque el proyecto no depende de esas herramientas, sino de golfo-lint.

## [0.3.0] - 2026-10-28

### Added

- Con `react`, el preset apaga reglas cuyos reportes en TuTribu eran todos código correcto: `react-you-might-not-need-an-effect/no-event-handler` y `no-pass-data-to-parent` (efectos que sincronizan la URL, un store externo, el reloj o el foco), `jsx-a11y-x/no-autofocus` (el foco que pasa al paso siguiente cuando desaparece el control que lo abrió) y `unicorn/no-document-cookie` (la Cookie Store API llegó a Safari 18.4 y Firefox 140). `jsx-a11y-x/no-noninteractive-tabindex` acepta `role="region"`, porque una región con scroll tiene que poder enfocarse (WCAG 2.1.1).
- Los configs con punto (`.dependency-cruiser.mjs`, `.prettierrc.mjs`) cuentan como archivos de config y pueden armar su config en el nivel superior.
- `@typescript-eslint/no-unused-vars` deja descartar propiedades con un resto (`const { password: _password, ...user } = row`) y marcar con `_` los parámetros que una firma necesita pero el cuerpo no lee, en lugar de obligar a `void name;`, que `no-meaningless-void-operator` rechaza.
- `golfo-lint lint` corre el preset con `bun lint` (también dentro de `golfo-lint all`), unas cinco veces más rápido que ESLint (50 s contra 4 a 5 minutos en TuTribu) con los mismos hallazgos. Con la opción `linter: "bun"`, el preset usa la versión nativa de `@typescript-eslint/no-unnecessary-condition`, porque `bun lint` no les da tipos a las reglas de los plugins, y `golfo-lint lint` descarta los reportes que se apoyan en tipos que TypeScript no puede conocer, igual que `golfo-lint/no-unnecessary-condition`.
- `vitest/valid-expect` acepta el mensaje como segundo argumento de `expect`.
- `golfo-lint/no-lint-disable` reemplaza a `eslint-comments/no-use`: también rechaza `oxlint-disable`.
- dependency-cruiser, con `hexagonalModulesPath`: `layers-not-to-setup` impide que una capa importe un `setup.ts`, la raíz de composición.
- `@typescript-eslint/no-magic-numbers` exige `const`: un número en un `let` puede cambiar en la línea siguiente.

### Changed

- SonarJS deja de usar su `recommended`: quedan la complejidad cognitiva y las reglas que encontraron defectos reales en TuTribu. El resto no encontró nada, repetía otra regla o solo elegía una forma de escribir.
- En los tests ya no se exigen `max-params`, la complejidad cognitiva, `no-base-to-string`, `only-throw-error`, `preserve-caught-error` ni `prefer-dom-node-text-content` (Playwright).
- `id-length` acepta una mayúscula sola, el nombre de un parámetro de tipo (`<T>`).

### Removed

- `@typescript-eslint/prefer-nullish-coalescing`, `vitest/no-conditional-expect`, `no-control-regex` y `unicorn/prefer-event-target`: en TuTribu reportaban sobre todo código correcto (un `||` que cae al valor por defecto con `""` o `0` a propósito, aserciones por caso en tests parametrizados, patrones que rechazan caracteres de control, dobles de `pg` que necesitan un `EventEmitter`).

## [0.2.1] - 2026-10-27

### Fixed

- El workflow de release instala Bun, que `npm run ci` usa para el typecheck: la publicación de 0.2.0 falló por eso y su contenido sale en esta versión.

## [0.2.0] - 2026-10-27

### Added

- Opción `awsCdk` (por defecto `false`): las reglas `sonarjs/aws-*` solo corren en proyectos con `aws-cdk-lib`. En los demás no podían reportar nada y se llevaban cerca del 10 % del tiempo de ESLint en TuTribu.
- `golfo-lint/no-unnecessary-condition` reemplaza a `@typescript-eslint/no-unnecessary-condition`: reporta lo mismo, salvo las condiciones que dependen de tipos que TypeScript no puede conocer (una propiedad que pudo cambiar después de un `await`, un `let` que reasigna un callback, elementos de arrays y records sin `noUncheckedIndexedAccess`, APIs del entorno que pueden faltar), que llevaban a borrar chequeos necesarios.
- `@typescript-eslint/require-array-sort-compare`: ordenar números u objetos sin función de comparación es un error; los arrays de strings se pueden ordenar sin ella. En JavaScript, o con `typeChecked: false`, sigue `unicorn/require-array-sort-compare`, que pide la función en todo `sort`.
- `golfo-lint unused` usa la configuración compartida de knip cuando el proyecto no tiene la suya. `createKnipConfig()` toma como entrada la config de `@golfo/rp`, los scripts de `.golfo-rp/` y `scripts/` y `open-next.config.ts`; le pasa al plugin de Playwright todas las configs `playwright*.config.*`; en Next.js acepta `server-only` y `client-only` sin declararlos; y suma el `entry` del proyecto a esas entradas en vez de reemplazarlas.
- `golfo-lint workflows` entiende los pasos en segundo plano de GitHub Actions (`background`, `wait`, `wait-all`, `cancel` y `parallel`), que actionlint marcaba como errores de sintaxis, y revisa los pasos de cada grupo `parallel`.

### Changed

- `golfo-lint react` muestra solo los hallazgos de react-doctor que ningún otro análisis reporta: deja afuera las reglas que ya corre ESLint (React Compiler, jsx-a11y, tamaño y complejidad), las páginas HTML y los workflows, y los consejos que rompen código válido si se aplican sin mirar. También descarta la lectura del cuerpo de un `fetch` que se revisa después y `sql.raw(...)` con SQL fijo en el código (literales o `const` que los guardan, aunque vengan de otro módulo del proyecto). Termina con código 1 cuando encuentra problemas.
- La complejidad de las funciones se mide solo con `sonarjs/cognitive-complexity`; `complexity` (ciclomática) reportaba las mismas funciones otra vez.
- Los imports que no resuelven y los paquetes que faltan en `package.json` los reporta solo `golfo-lint unused` (knip); `golfo-lint architecture` los repetía.
- Las carpetas `mocks/`, `__mocks__/` y `dev-mocks/` pueden importar devDependencies (por ejemplo, los handlers de MSW que se cargan solo en desarrollo).
- En los tests se permiten `any` y `!`.
- `import-x/no-duplicates` usa `prefer-inline` y `@typescript-eslint/consistent-type-imports` usa `fixStyle: "inline-type-imports"`, con `@typescript-eslint/no-import-type-side-effects`. Con las opciones por defecto, `eslint --fix` dejaba imports que no compilan: movía valores a un `import type` o escribía `import type { type A, B }`.
- `@typescript-eslint/no-misused-promises` acepta funciones async como handlers de eventos de JSX (`onClick={save}`): React ignora lo que devuelven.
- Requiere Node.js 22.15 o superior.
- El typecheck del paquete corre con `bun check` (Bun 1.4.4, fijado en `.bun-version`) en lugar de `tsc`. No cambia nada para quien instala `@golfo/lint`.

### Removed

- `sonarjs/no-redundant-assignments`: en TuTribu su único hallazgo fue un falso positivo (una variable que un handler cambia después de un `await`), y era de las reglas más lentas del preset (7 % del tiempo).
- `golfo-lint complexity` y `@golfo/lint/lizard`: lizard solo analizaba JavaScript y TypeScript, que el preset de ESLint ya cubre.
- Reglas de ESLint que solo eligen entre formas equivalentes de escribir lo mismo: `sonarjs/no-nested-template-literals`, `sonarjs/no-unenclosed-multiline-block` (depende de cómo está formateado el código), `sonarjs/prefer-specific-assertions`, `unicorn/no-array-sort`, `unicorn/no-array-reverse` y `vitest/prefer-called-exactly-once-with`.
- Reglas de ESLint que reportan lo mismo que otra: `sonarjs/no-unused-vars`, `sonarjs/unused-import`, `sonarjs/no-dead-store`, `sonarjs/no-nested-functions`, `sonarjs/no-alphabetical-sort`, `unicorn/require-array-sort-compare`, `unicorn/no-useless-coercion` (con tipos), `sonarjs/assertions-in-tests` (con Vitest) y `sonarjs/no-hardcoded-passwords` y `sonarjs/no-hardcoded-secrets` (gitleaks).
- Reglas de ESLint que marcan código válido: los *security hotspots* de SonarJS (`no-os-command-from-path`, `os-command`, `no-hardcoded-ip`, `no-clear-text-protocols`, `pseudo-random`), `no-promise-executor-return`, `no-unmodified-loop-condition`, `unicorn/no-exports-in-scripts`, `unicorn/no-error-property-assignment`, `@typescript-eslint/unbound-method`, `@typescript-eslint/no-dynamic-delete` y `@typescript-eslint/no-invalid-void-type`.
- En TypeScript, `sonarjs/no-extra-arguments` (TypeScript ya lo rechaza), `sonarjs/different-types-comparison` (lo reporta `golfo-lint/no-unnecessary-condition`) y `unicorn/no-useless-switch-case`, que pide borrar el `case` que `@typescript-eslint/switch-exhaustiveness-check` exige.
- Reglas de Stylelint que solo eligen entre formas equivalentes: `declaration-block-no-redundant-longhand-properties` y `shorthand-property-no-redundant-values`.

### Fixed

- `golfo-lint styles --fix` (y cualquier análisis que reciba solo opciones) sigue analizando los archivos del proyecto; antes Stylelint esperaba el código por la entrada estándar y fallaba con «Empty source».
- ESLint ya no se cae con "Fix objects must not be overlapped" cuando `toHaveBeenCalledOnce()` y `toHaveBeenCalledWith()` están en la misma línea de un test.
- `golfo-lint architecture` analiza los archivos TypeScript de proyectos que usan TypeScript 7: dependency-cruiser no lo soporta y los salteaba en silencio, así que el chequeo pasaba sin analizar nada. Ahora usa el TypeScript 6 de `@golfo/lint`.
- `golfo-lint secrets` no reporta los hashes de contenido que golfo-kit guarda en `.golfo/skill-coverage/`.

## [0.1.0] - 2026-10-25

### Added

- Preset de ESLint (`@golfo/lint/eslint`) para código escrito por agentes de IA, con reglas de calidad de ESLint, typescript-eslint, SonarJS, unicorn, import-x, promise y regexp. No incluye reglas de formato ni preferencias de estilo, reporta todo como error y prohíbe los comentarios `eslint-disable` (salvo con `allowDisableComments`, que exige explicarlos).
- Opciones `react` (hooks, accesibilidad en JSX y `useEffect` innecesarios), `next` (Next.js y Core Web Vitals) y `vitest` (tests enfocados, salteados o sin asserts) en el preset de ESLint.
- Configuración de Stylelint (`@golfo/lint/stylelint`) que solo detecta errores en CSS y SCSS, con nombres de clase BEM opcionales, y el comando `golfo-lint styles`.
- Configuración de dependency-cruiser (`@golfo/lint/dependency-cruiser`) con ciclos, paquetes no declarados, devDependencies en producción y reglas de capas hexagonales, y el comando `golfo-lint architecture`.
- `golfo-lint duplicates` (jscpd), `golfo-lint unused` (knip) y `golfo-lint complexity` (lizard, con los mismos límites que ESLint).
- `golfo-lint package` (publint y Are the Types Wrong), `golfo-lint workflows` (actionlint y zizmor), `golfo-lint secrets` (gitleaks) y `golfo-lint monorepo` (sherif).
- `golfo-lint react` (react-doctor): bugs de estado y efectos, rendimiento, seguridad y accesibilidad en proyectos React, con las advertencias como errores, sin comentarios que silencien reglas y sin telemetría. react-doctor es opcional: se instala en el proyecto con `pnpm add -D react-doctor@0.9.18`.
- `golfo-lint all`: ejecuta todos los análisis que aplican al proyecto y falla si alguno falla.
- `golfo-lint react-scan`: en proyectos React con Next.js 15.3 o posterior (App y Pages Router) o Vite, instala `react-scan@0.5.7` como devDependency exacta si falta y conecta react-scan para ver re-renders solo en desarrollo, mostrando el diff; es idempotente, no forma parte de `golfo-lint all` y termina con código 4, sin cambiar nada, si no detecta dónde conectarlo.
- `@golfo/lint/react-scan`: `startReactScan(options)` inicia react-scan desde el paquete instalado solo en el navegador y en desarrollo, sin CDN ni consultas a react-grab.com, y los builds de producción no lo incluyen. react-scan queda como dependencia par opcional.
- Todas las herramientas se instalan en versiones exactas, así una versión nueva de un plugin no puede sumar reglas sin validarlas.
- El preset de ESLint usa `tsconfig.json` y `tsconfig.test.json` cuando existe el segundo, para que las reglas con tipos no tarden horas en proyectos cuyo `tsconfig.json` excluye los tests (opción `tsconfigFiles`).

### Fixed

- La configuración de dependency-cruiser ahora detecta devDependencies importadas desde código de producción y paquetes que no están en `package.json`: excluir `node_modules` descartaba también las dependencias hacia paquetes. `@golfo/lint/react-scan` es la única devDependency permitida en producción.
