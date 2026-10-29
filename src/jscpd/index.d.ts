/** Defaults of `golfo-lint duplicates`, in the shape of a `.jscpd.json` file. */
export interface JscpdDefaults {
  minTokens: number;
  minLines: number;
  /** Highest share of duplicated lines, in percent, before jscpd fails. */
  threshold: number;
  format: string[];
  ignore: string[];
  reporters: string[];
}

export const JSCPD_DEFAULTS: JscpdDefaults;

/** Builds the jscpd flags for the defaults merged with project overrides. */
export function createJscpdArguments(overrides?: Partial<JscpdDefaults>): string[];
