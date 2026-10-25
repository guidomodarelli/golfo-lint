# Changelog

Todos los cambios relevantes de `@golfo/lint` se documentan en este archivo, según [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y [Semantic Versioning](https://semver.org/lang/es/).

## [Unreleased]

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
