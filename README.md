# @golfo/lint

Reglas de calidad de código compartidas entre los proyectos golfo. Cada análisis mira un problema distinto y usa los mismos límites, así un proyecto nuevo arranca con la misma vara que los demás:

| Análisis | Herramienta | Exportación | Comando |
| --- | --- | --- | --- |
| Bugs, código confuso, nombres poco claros | ESLint | `@golfo/lint/eslint` | `eslint .` |
| Código duplicado | [jscpd](https://github.com/kucherenko/jscpd) | `@golfo/lint/jscpd` | `golfo-lint duplicates` |
| Archivos, exports y dependencias sin uso | [knip](https://knip.dev) | `@golfo/lint/knip` | `golfo-lint unused` |
| Complejidad, largo y parámetros por función | [lizard](https://github.com/terryyin/lizard) | `@golfo/lint/lizard` | `golfo-lint complexity` |

`golfo-lint all` ejecuta duplicates, unused y complexity, y falla si alguno falla.

## Instalación

```bash
pnpm add -D @golfo/lint eslint
```

Requiere Node.js 22.13 o superior y ESLint 10. jscpd, knip, typescript-eslint y los plugins de ESLint vienen como dependencias.

## ESLint: calidad, nunca formato

El preset solo activa reglas que encuentran bugs, código muerto, complejidad excesiva o nombres poco claros. **No activa ninguna regla de formato** (espacios, indentación, comillas, punto y coma, orden de imports, mayúsculas en literales): eso le corresponde a un formateador como Prettier, Biome u oxfmt, y el preset convive con cualquiera sin conflictos.

Para garantizarlo, el preset apaga al final todas las reglas de tipo `layout` de los plugins que usa, más una lista de reglas que no están marcadas como `layout` pero solo eligen entre dos formas equivalentes de escribir lo mismo (`STYLISTIC_SUGGESTION_RULES`). Un test lo verifica sobre la configuración final.

```js
// eslint.config.js
import { createEslintConfig } from "@golfo/lint/eslint";

export default createEslintConfig({
  tsconfigRootDir: import.meta.dirname,
  react: true,
});
```

| Opción | Valor por defecto | Qué hace |
| --- | --- | --- |
| `tsconfigRootDir` | carpeta actual | Carpeta del `tsconfig.json` raíz, para las reglas con tipos. |
| `typeChecked` | `true` | Activa las reglas que necesitan información de tipos (promesas sin esperar, `any` inseguro, condiciones innecesarias). Son más lentas. |
| `react` | `false` | Activa las reglas de hooks de React. |
| `ignores` | `[]` | Globs extra a ignorar, además de dependencias y build. |
| `testFiles` | rutas de test comunes | Archivos de test, con límites relajados. |

Qué incluye:

- **ESLint core** (`recommended` más reglas como `eqeqeq`, `no-param-reassign`, `no-implicit-coercion`, `prefer-const`, `no-nested-ternary`, `id-length`).
- **typescript-eslint** `strictTypeChecked`, más `switch-exhaustiveness-check`, `prefer-nullish-coalescing`, `consistent-type-imports` y `no-magic-numbers`.
- **SonarJS** `recommended`, con complejidad cognitiva máxima de 15.
- **unicorn** `recommended`, con `name-replacements` (sin abreviaciones, salvo `props`, `params`, `ref`, `args` y `env`) y `catch-error-name` (el error del `catch` se llama `error`).
- **import-x**: ciclos, duplicados, exports mutables y rutas inútiles. Las rutas sin resolver las reporta TypeScript.
- **promise** y **regexp** `recommended`.
- **React hooks** `recommended`, con `react: true`.

TypeScript 7 todavía no es compatible con typescript-eslint, así que el paquete trae su propio TypeScript 6 solo para el análisis. El proyecto puede compilar con TypeScript 7 sin conflicto.

## Límites compartidos

ESLint y lizard usan los mismos límites por función, así el editor avisa lo mismo que el análisis del repositorio:

| Límite | Valor |
| --- | --- |
| Complejidad ciclomática | 10 |
| Complejidad cognitiva (SonarJS) | 15 |
| Líneas de código (sin vacías ni comentarios) | 80 |
| Parámetros | 4 |
| Profundidad de bloques | 4 |
| Callbacks anidados | 3 |

En los tests se relajan el largo de función, los callbacks anidados, los números mágicos y los strings repetidos.

## jscpd: código duplicado

```bash
golfo-lint duplicates          # analiza la carpeta actual
golfo-lint duplicates src app  # analiza esas carpetas
```

Falla cuando más del 1 % de las líneas está duplicado, contando bloques de al menos 50 tokens y 5 líneas en JavaScript, TypeScript, JSX, TSX, CSS y SCSS. Ignora dependencias, build y tests. Si el proyecto tiene un `.jscpd.json`, se usa ese archivo en lugar de los valores compartidos. Los argumentos se pasan tal cual a jscpd.

## knip: código sin uso

```bash
golfo-lint unused
```

Corre knip con los argumentos que se le pasen. Para partir de los valores compartidos:

```js
// knip.config.js
import { createKnipConfig } from "@golfo/lint/knip";

export default createKnipConfig({ ignoreDependencies: ["sharp"] });
```

Los tipos e interfaces pueden quedar exportados aunque solo los use su propio archivo, porque exportarlos documenta un contrato; cualquier otro export sin uso se reporta.

## lizard: complejidad

```bash
golfo-lint complexity
golfo-lint complexity src
```

lizard es una herramienta de Python, así que npm no puede instalarla. `golfo-lint complexity` la busca en este orden: `lizard` instalado, `uvx lizard@1.24.1` (descarga la versión fijada una vez; requiere [uv](https://docs.astral.sh/uv/)) y `python -m lizard`. Si no encuentra ninguna, termina con código 3 y explica cómo instalarla. En CI alcanza con `astral-sh/setup-uv`.

## Códigos de salida

| Código | Significado |
| --- | --- |
| 0 | El análisis pasó. |
| 1 | El análisis encontró problemas. |
| 2 | Análisis desconocido o sin análisis. |
| 3 | No se pudo ejecutar la herramienta. |

## Desarrollo

```bash
npm ci
npm run ci
```

`npm run ci` corre ESLint con el propio preset, el typecheck, los tests (que ejecutan ESLint, jscpd, knip y lizard de verdad sobre `test/fixtures`) y `npm pack --dry-run`. Los releases se publican con `npm run create-version` (`@golfo/rp`).
