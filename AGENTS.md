# @golfo/lint

## Audience: AI agents

The rules in this package are read and acted on by AI coding agents, not by humans. Every rule, tool and default must serve that audience:

- **Only rules that detect real defects.** A rule belongs here when it catches a bug, dead code, excessive complexity, duplicated code, an unclear name, an accessibility problem, invalid or fragile CSS, a broken published package, a broken or insecure GitHub Actions workflow, a committed secret, a violated architecture boundary or an inconsistent monorepo.
  - The one exception is react-scan (`golfo-lint react-scan` and `@golfo/lint/react-scan`), added because the user decided it: a tool that measures re-renders while the app runs in development and finds no defect. It never runs in CI or in production bundles, is not part of `golfo-lint all` and never makes a check fail. It does not open the door to other measurement tools, and every other rule below still applies to it: exact version, installed from the local package (never a CDN), and nothing leaves the machine (`startReactScan()` sets `window.__REACT_GRAB__` so react-scan does not query react-grab.com).
- **No formatting or style preferences.** Never enable rules about whitespace, indentation, quotes, semicolons, line breaks, letter case of literals, import or key ordering, or choices between equivalent spellings of the same code (`if` versus ternary, `String.raw`, `return;` versus `return undefined;`). They change no behavior and only add churn. Formatting belongs to a formatter.
  - ESLint: `listFormattingRules` turns off every rule typed `layout` in the plugins the preset uses, plus `STYLISTIC_SUGGESTION_RULES` in `src/eslint/formatting-rules.js`. When adding a plugin, add it to `PLUGINS_BY_PREFIX` and add its style-only rules to that list. unicorn is used through `unopinionated`, not `recommended`.
  - Stylelint: extend `stylelint-config-recommended-scss` (errors only), never `stylelint-config-standard`.
  - sherif: `unordered-dependencies` stays ignored.
  - react-doctor: keep its `design` rules off (they are visual preferences); run it with `--blocking warning` and `--no-respect-inline-disables`.
- **One finding, one rule.** When two enabled rules report the same problem, keep one and add the other to `DUPLICATED_RULES` in `src/eslint/formatting-rules.js`, with a comment naming the rule that stays. Prefer the faster tool when two of them overlap (cycles: dependency-cruiser, not `import-x/no-cycle`), and leave to TypeScript what it already checks.
- **Validate against real projects.** Before adding a plugin or preset, run it on TuTribu and agenda-mensual and review what it reports: a rule that mostly flags valid code, or only asks for another spelling, does not belong here.
- **Every problem is an error.** Agents act on failures and ignore warnings, so no rule is left as `warn`: `promoteWarningsToErrors` turns them into errors, dependency-cruiser rules use `severity: "error"`, and tests check it.
- **No silencing.** Agents must fix the code, not hide the finding: the ESLint preset forbids directive comments (`eslint-comments/no-use`) unless a project opts into `allowDisableComments`, which still requires a description; Stylelint uses `ignoreDisables`; react-doctor runs with `--no-respect-inline-disables`.
- **Nothing leaves the machine.** Tools run without telemetry or uploads (react-doctor with `--no-telemetry --no-supply-chain`).
- **Actionable messages.** Prefer rules and custom rule `comment`s that say what is wrong and what to do instead, in Spanish for messages written here.
- **Shared limits.** Size and complexity limits live in `src/shared/thresholds.js`; change them there. Complexity is measured once, by `sonarjs/cognitive-complexity`.
- **No false alarms.** A rule that reports valid code (a security hotspot that asks to review something usually fine, advice that breaks correct code when applied blindly, a verdict based on types TypeScript cannot know) goes to `NON_DEFECT_RULES`, gets filtered (react-doctor findings in `src/react-doctor/react-doctor-report.js`) or gets wrapped (`src/eslint/rules/`). An agent cannot tell when to ignore a report.
- Before adding a tool or rule, check that it works with the pinned runtimes (ESLint 10, Node.js from `.nvmrc`), that it is maintained, and that it does not duplicate a check the package already has. Document the choice in `README.md`.

## Pinned versions

Every tool runs at an exact version, because a new version of a linter or plugin can add rules that make a passing project fail, or style rules that break the policy above.

- `dependencies` and `devDependencies` in `package.json` use exact versions, without `^` or `~`; `.npmrc` sets `save-exact=true` so `npm install <package>` keeps it that way. Update one tool at a time, rerun the validation below on TuTribu and agenda-mensual, and review what changed before committing.
- `peerDependencies` keep ranges (`eslint`, and `react-doctor` and `react-scan` as optional peers): pinning a peer would force every project to that exact version. The version golfo-lint is tested with is the one in `devDependencies`.
- Tools that npm cannot install are pinned in code; change them in these constants and in the CI workflow together:

| Tool | Version | Where |
| --- | --- | --- |
| actionlint | 1.7.12 (`actionlint-py~=1.7.12.0`) | `ACTIONLINT_PY_REQUIREMENT` in `src/workflows/workflow-tools.js` |
| zizmor | 1.31.1 | `ZIZMOR_VERSION` in `src/workflows/workflow-tools.js` |
| gitleaks | 8.30.1 | `GITLEAKS_VERSION` in `src/secrets/gitleaks-tool.js` and `.github/workflows/ci.yml` |
| react-doctor (optional peer) | 0.9.18 | `REACT_DOCTOR_VERSION` in `src/cli/commands/code-analysis.js` and `devDependencies` |
| react-scan (optional peer) | 0.5.7 | `REACT_SCAN_VERSION` in `src/cli/react-scan/install-react-scan.js` and `devDependencies` |
| pnpm (packed install check) | 12.14.0 | `.github/workflows/ci.yml` |

- GitHub Actions are pinned to a commit SHA with the tag as a comment (zizmor requires it).

## Validation

- `npm run ci` runs ESLint with the package's own preset, the typecheck, the tests and `npm pack --dry-run`. `node bin/golfo-lint.js all` runs every analysis on the package itself. `npm run check:packed-install` installs the packed package with pnpm in a throwaway project and checks that every tool resolves; run it whenever dependencies, `exports` or the way a tool is located change. All three must pass before closing a change.
- Tests run the real tools (ESLint, Stylelint, jscpd, knip, dependency-cruiser, react-doctor, publint, attw, actionlint, zizmor, gitleaks, sherif) on `test/fixtures`; do not mock them. Tests that need `uvx` or `gitleaks` are skipped when the tool is missing, and CI installs both.
- Never commit a real or realistic secret, not even in a fixture: tests that need one build it at runtime.

## Changelog governance

- Every change that alters rules, defaults, CLI behavior or output, or the public API (`package.json` `exports`) must update `CHANGELOG.md` in the same work item.
- Add entries only inside the `## [Unreleased]` block, never under a released version, and never write the version or date by hand: `npm run create-version` (`@golfo/rp`) closes the block.
- Follow [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) sections in order (`Added`, `Changed`, `Deprecated`, `Removed`, `Fixed`, `Security`), one `- ` line per change, in Spanish, describing what changes for the projects that use the package.
- A new rule that can make a passing project fail is a breaking change for the release type.
