/**
 * @module stylelint/create-stylelint-config Builds the shared Stylelint config for CSS and SCSS: rules that catch
 * invalid or dead declarations and specificity problems, never formatting or ordering rules.
 */
import { fileURLToPath } from "node:url";
import { IGNORED_PATH_GLOBS } from "../shared/thresholds.js";

/**
 * Error-only base config, resolved to an absolute path so that it loads from this package even when the
 * consumer's package manager does not hoist it.
 */
const RECOMMENDED_SCSS_CONFIG = fileURLToPath(import.meta.resolve("stylelint-config-recommended-scss"));

/** CSS Modules files, where every selector is scoped to one component. */
const CSS_MODULE_FILE_GLOBS = ["**/*.module.css", "**/*.module.scss"];

/** Pseudo-classes CSS Modules adds to reach outside the module or export values. */
const CSS_MODULES_PSEUDO_CLASSES = ["global", "local", "export", "import"];

/** At-rules of Tailwind CSS 4, valid in the stylesheets Tailwind compiles. */
const TAILWIND_AT_RULES = ["theme", "custom-variant", "utility", "variant", "source", "plugin", "config", "reference", "apply", "tailwind"];

/** Deepest nesting of rules; deeper selectors are fragile and hard to override. */
const MAX_STYLE_NESTING_DEPTH = 3;

/** Most compound selectors in a selector, such as `.a .b .c .d`. */
const MAX_COMPOUND_SELECTORS = 4;

/**
 * BEM class names as the golfo projects write them: a PascalCase block, optional camelCase elements and
 * kebab-case modifiers (`CourseCard`, `CourseCard__title`, `CourseCard__title--muted`).
 */
export const BEM_CLASS_PATTERN = String.raw`^[A-Z][A-Za-z0-9]*(__[a-z][A-Za-z0-9]*)?(--[a-z][a-z0-9-]*)?$`;

/**
 * @typedef {object} StylelintConfigOptions
 * @property {boolean} [bem] - Whether class names must follow {@link BEM_CLASS_PATTERN} (default `false`).
 * @property {string[]} [ignoreFiles] - Extra globs to skip, besides dependencies and build output.
 */

/**
 * Builds the shared Stylelint config. Disable comments are ignored, so a rule can only be fixed, not silenced.
 * Specificity rules (no ids, no `!important`, no type-qualified selectors) apply only to CSS Modules: global
 * stylesheets legitimately target `html.dark`, `#__next` or element defaults.
 * @param {StylelintConfigOptions} [options] - What the project uses.
 * @returns {import("stylelint").Config} Config to export from `stylelint.config.js`.
 */
export function createStylelintConfig(options = {}) {
  const { bem = false, ignoreFiles = [] } = options;
  return {
    extends: [RECOMMENDED_SCSS_CONFIG],
    ignoreDisables: true,
    ignoreFiles: [...IGNORED_PATH_GLOBS, ...ignoreFiles],
    rules: {
      "declaration-block-no-redundant-longhand-properties": true,
      "max-nesting-depth": [MAX_STYLE_NESTING_DEPTH, { ignore: ["pseudo-classes"], ignoreAtRules: ["media", "supports"] }],
      "scss/at-rule-no-unknown": [true, { ignoreAtRules: TAILWIND_AT_RULES }],
      "selector-max-compound-selectors": MAX_COMPOUND_SELECTORS,
      "selector-pseudo-class-no-unknown": [true, { ignorePseudoClasses: CSS_MODULES_PSEUDO_CLASSES }],
      "shorthand-property-no-redundant-values": true,
    },
    overrides: [
      {
        files: CSS_MODULE_FILE_GLOBS,
        rules: {
          "declaration-no-important": true,
          "selector-class-pattern": bem ? BEM_CLASS_PATTERN : null,
          "selector-max-id": 0,
          "selector-no-qualifying-type": true,
        },
      },
    ],
  };
}
