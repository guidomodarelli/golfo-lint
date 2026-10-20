export function classify(value, mode, strict, locale) {
  if (value === null) { return "null"; }
  if (typeof value === "number") {
    if (value > 100) { return mode === "a" ? "big-a" : "big"; }
    if (value < 0 && strict) { return "negative"; }
    if (value === 0 || value === 1) { return "unit"; }
  }
  if (typeof value === "string") {
    if (value.length > 10 && locale === "es") { return "long-es"; }
    if (value.length > 10 || mode === "b") { return "long"; }
    if (value.startsWith("x") && strict) { return "x"; }
  }
  if (Array.isArray(value) && value.length > 0) { return "list"; }
  return "other";
}
