import "server-only";

/** Reads a value that only the server may see. */
export function readSecret(): string {
  return "secret";
}
