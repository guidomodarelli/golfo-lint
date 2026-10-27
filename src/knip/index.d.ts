/** knip config; see https://knip.dev/reference/configuration. */
export interface KnipConfig {
  ignoreExportsUsedInFile?: Record<string, boolean> | boolean;
  ignore?: string[];
  ignoreDependencies?: string[];
  ignoreBinaries?: string[];
  entry?: string[];
  project?: string[];
  [option: string]: unknown;
}

export const KNIP_DEFAULTS: KnipConfig;

/**
 * Builds a knip config from the shared defaults, to export from `knip.config.js`. In a Next.js project it also
 * accepts `server-only` and `client-only`, which Next.js resolves without installing them.
 */
export function createKnipConfig(overrides?: KnipConfig, options?: { projectDirectory?: string }): KnipConfig;
