# @golfo/lint

## Audience: AI agents

The rules in this package are read and acted on by AI coding agents, not by humans. Every rule, tool and default must serve that audience:

- **Only rules that detect real defects.** A rule belongs here when it catches a bug, dead code, excessive complexity, duplicated code, an unclear name, an accessibility problem, invalid or fragile CSS, a broken published package, a broken or insecure GitHub Actions workflow, a committed secret, a violated architecture boundary or an inconsistent monorepo.
- **No formatting or style preferences.** Never enable rules about whitespace, indentation, quotes, semicolons, line breaks, letter case of literals, import or key ordering, or choices between equivalent spellings of the same code (`if` versus ternary, `String.raw`, `return;` versus `return undefined;`). They change no behavior and only add churn. Formatting belongs to a formatter.
  - ESLint: `listFormattingRules` turns off every rule typed `layout` in the plugins the preset uses, plus `STYLISTIC_SUGGESTION_RULES` in `src/eslint/formatting-rules.js`. When adding a plugin, add it to `PLUGINS_BY_PREFIX` and add its style-only rules to that list. unicorn is used through `unopinionated`, not `recommended`.
  - Stylelint: extend `stylelint-config-recommended-scss` (errors only), never `stylelint-config-standard`.
  - sherif: `unordered-dependencies` stays ignored.
  - react-doctor: keep its `design` rules off (they are visual preferences); run it with `--blocking warning` and `--no-respect-inline-disables`.
- **Every problem is an error.** Agents act on failures and ignore warnings, so no rule is left as `warn`: `promoteWarningsToErrors` turns them into errors, dependency-cruiser rules use `severity: "error"`, and tests check it.
- **No silencing.** Agents must fix the code, not hide the finding: the ESLint preset forbids directive comments (`eslint-comments/no-use`) unless a project opts into `allowDisableComments`, which still requires a description; Stylelint uses `ignoreDisables`; react-doctor runs with `--no-respect-inline-disables`.
- **Nothing leaves the machine.** Tools run without telemetry or uploads (react-doctor with `--no-telemetry --no-supply-chain`).
- **Actionable messages.** Prefer rules and custom rule `comment`s that say what is wrong and what to do instead, in Spanish for messages written here.
- **Shared limits.** Size and complexity limits live in `src/shared/thresholds.js` so ESLint and lizard flag the same functions; change them there.
- Before adding a tool or rule, check that it works with the pinned runtimes (ESLint 10, Node.js from `.nvmrc`), that it is maintained, and that it does not duplicate a check the package already has. Document the choice in `README.md`.

## Validation

- `npm run ci` runs ESLint with the package's own preset, the typecheck, the tests and `npm pack --dry-run`. `node bin/golfo-lint.js all` runs every analysis on the package itself. Both must pass before closing a change.
- Tests run the real tools (ESLint, Stylelint, jscpd, knip, lizard, dependency-cruiser, react-doctor, publint, attw, actionlint, zizmor, gitleaks, sherif) on `test/fixtures`; do not mock them. Tests that need `uvx` or `gitleaks` are skipped when the tool is missing, and CI installs both.
- Never commit a real or realistic secret, not even in a fixture: tests that need one build it at runtime.

## Changelog governance

- Every change that alters rules, defaults, CLI behavior or output, or the public API (`package.json` `exports`) must update `CHANGELOG.md` in the same work item.
- Add entries only inside the `## [Unreleased]` block, never under a released version, and never write the version or date by hand: `npm run create-version` (`@golfo/rp`) closes the block.
- Follow [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) sections in order (`Added`, `Changed`, `Deprecated`, `Removed`, `Fixed`, `Security`), one `- ` line per change, in Spanish, describing what changes for the projects that use the package.
- A new rule that can make a passing project fail is a breaking change for the release type.
