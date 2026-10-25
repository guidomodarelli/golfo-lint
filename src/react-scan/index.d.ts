import type { Options } from "react-scan";

/**
 * Starts react-scan in the browser while the app runs in development (`next dev`, `vite`); anywhere else it does
 * nothing, and production bundles leave react-scan out.
 */
export function startReactScan(options?: Options): void;
