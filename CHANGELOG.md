# Changelog

Todos los cambios relevantes de `@golfo/lint` se documentan en este archivo, según [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y [Semantic Versioning](https://semver.org/lang/es/).

## [Unreleased]

### Added

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

### Removed

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
