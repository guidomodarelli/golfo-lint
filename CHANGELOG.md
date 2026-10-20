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
- `golfo-lint react` (react-doctor): bugs de estado y efectos, rendimiento, seguridad y accesibilidad en proyectos React, con las advertencias como errores, sin comentarios que silencien reglas y sin telemetría.
- `golfo-lint all`: ejecuta todos los análisis que aplican al proyecto y falla si alguno falla.
