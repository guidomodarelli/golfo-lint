/**
 * Imports from one module in two statements, with inline `type` specifiers: `eslint --fix` has to leave imports that
 * compile, with `answer` still a value.
 */
import { answer, type Shape } from "./mixed-imports-source.js";
import type { Outline } from "./mixed-imports-source.js";
import { type Shape as Figure, answer as size } from "./mixed-imports-source.js";

/** `size` is only used as a type, so its import becomes type-only. */
export type Size = typeof size;

/** Uses the value and the types. */
export const measure = (shape: Shape, outline: Outline, figure: Figure): number =>
  shape.size + outline.width + figure.size + answer;
