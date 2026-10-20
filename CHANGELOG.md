# Changelog

Todos los cambios relevantes de `@golfo/lint` se documentan en este archivo, según [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y [Semantic Versioning](https://semver.org/lang/es/).

## [Unreleased]

### Added

- Preset de ESLint (`@golfo/lint/eslint`) con reglas de calidad de ESLint, typescript-eslint, SonarJS, unicorn, import-x, promise, regexp y, opcionalmente, React hooks. No incluye ninguna regla de formato.
- `golfo-lint duplicates`: busca código duplicado con jscpd.
- `golfo-lint unused`: busca archivos, exports y dependencias sin uso con knip, con valores compartidos en `@golfo/lint/knip`.
- `golfo-lint complexity`: busca funciones demasiado complejas, largas o con muchos parámetros con lizard, con los mismos límites que ESLint.
- `golfo-lint all`: ejecuta los tres análisis y falla si alguno falla.
