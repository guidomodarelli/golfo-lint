/** Limits that `golfo-lint complexity` enforces per function. */
export interface LizardDefaults {
  maxCyclomaticComplexity: number;
  maxLinesOfCode: number;
  languages: string[];
  /** Paths to skip, as `fnmatch` patterns. */
  exclude: string[];
}

/** How to run lizard on this machine. */
export interface ToolCommand {
  command: string;
  prefixArguments: string[];
}

export const LIZARD_DEFAULTS: LizardDefaults;
export const LIZARD_VERSION: string;
export const LIZARD_CANDIDATES: ToolCommand[];

/** Builds the lizard flags that report only the functions above the limits. */
export function createLizardArguments(overrides?: Partial<LizardDefaults>): string[];

/** Returns the first way to run lizard that works, or `undefined` when it is not available. */
export function findLizardCommand(canRun?: (candidate: ToolCommand) => boolean): ToolCommand | undefined;
