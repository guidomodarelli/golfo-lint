/**
 * @module react-scan Starts react-scan, which highlights the components that re-render, only while the app runs in
 * development (`next dev`, `vite`). The app calls {@link startReactScan} from its client entry, which
 * `golfo-lint react-scan` sets up; production bundles leave react-scan out.
 */

/**
 * Global that tells react-scan the app loads react-grab itself. Without it, react-scan asks react-grab.com for
 * the latest react-grab version every time it starts.
 */
const REACT_GRAB_GLOBAL = "__REACT_GRAB__";

/**
 * Starts react-scan in the browser, in development; anywhere else (production builds, the server, tests) it does
 * nothing. react-scan is imported dynamically inside a `process.env.NODE_ENV === "development"` comparison written
 * with literals, the form Next.js (webpack and Turbopack) and Vite fold into a constant, so their production bundles
 * drop the import and emit no react-scan chunk. Being dynamic, it loads after React: in development react-scan still
 * sees every render through the DevTools hook that Fast Refresh installs before React. It loads react-scan's
 * CommonJS build because its ES build imports a named export from `react-grab/package.json`, which webpack rejects.
 * @param {import("react-scan/dist/index.js").Options} [options] - Options for react-scan's `scan()`.
 * @returns {void}
 */
export function startReactScan(options = {}) {
  if (process.env.NODE_ENV === "development" && "document" in globalThis) {
    if (!(REACT_GRAB_GLOBAL in globalThis)) {
      // react-scan reads this flag from the global object, so it is defined there on purpose.
      Object.defineProperty(globalThis, REACT_GRAB_GLOBAL, { value: {}, writable: true, configurable: true });
    }
    import("react-scan/dist/index.js")
      .then(({ scan }) => {
        scan(options);
      })
      .catch((startError) => {
        console.error(
          "golfo-lint startReactScan: no se pudo iniciar react-scan. Instalalo con golfo-lint react-scan.",
          startError,
        );
      });
  }
}
