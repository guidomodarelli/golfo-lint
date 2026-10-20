/** knip config; see https://knip.dev/reference/configuration. */
export interface KnipConfig {
  ignoreExportsUsedInFile?: Record<string, boolean> | boolean;
  ignore?: string[];
  ignoreDependencies?: string[];
  entry?: string[];
  project?: string[];
  [option: string]: unknown;
}

export const KNIP_DEFAULTS: KnipConfig;

/** Builds a knip config from the shared defaults, to export from `knip.config.js`. */
export function createKnipConfig(overrides?: KnipConfig): KnipConfig;
