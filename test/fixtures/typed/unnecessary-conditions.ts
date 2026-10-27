/** Cases for `golfo-lint/no-unnecessary-condition`: only `checksAnArrayAsIfItCouldBeMissing` is a real report. */

/** A cancellation flag that something else can set while the code awaits. */
interface CancelSignal {
  readonly aborted: boolean;
}

declare function waitForNetwork(): Promise<void>;

/** The flag can change during the `await`, although TypeScript keeps it narrowed to `false`. */
export async function stopsWhenAborted(signal: CancelSignal): Promise<string> {
  if (signal.aborted) {
    return "before";
  }
  await waitForNetwork();
  return signal.aborted ? "after" : "done";
}

/** Without `noUncheckedIndexedAccess`, `names[0]` is typed as always there, but the array can be empty. */
export function firstName(names: string[]): string {
  const first = names[0];
  return first ?? "nobody";
}

/** A record entry is typed as always there, but the key can be missing. */
export function countOf(countsById: Record<string, number>, id: string): number {
  const count = countsById[id];
  return count === undefined ? 0 : count;
}

/** An array is always truthy: the check is dead code. */
export function checksAnArrayAsIfItCouldBeMissing(items: string[]): number {
  return items ? items.length : 0;
}

/** The callback sets `found` to `true`, but TypeScript does not see assignments made in another function. */
export function hasEmptyName(names: readonly string[]): boolean {
  let found = false;
  names.forEach((name) => {
    if (name === "") {
      found = true;
    }
  });
  if (found) {
    return true;
  }
  return false;
}

/** Old runtimes lack `Array.prototype.at`, although its type says it is always there. */
export function lastItem(items: readonly string[]): string | undefined {
  if (!Array.prototype.at) {
    return items[items.length - 1];
  }
  return items.at(-1);
}
