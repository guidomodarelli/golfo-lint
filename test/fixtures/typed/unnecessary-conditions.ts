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
