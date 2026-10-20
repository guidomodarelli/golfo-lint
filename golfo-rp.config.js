/**
 * `golfo-rp create-version` configuration of `@golfo/lint`: validate with
 * `npm run ci`, then publish to npm from the `release.yml` workflow through npm
 * trusted publishing (OIDC), so no npm token is stored in the repository.
 *
 * @module golfo-rp.config
 */

/** @type {import("@golfo/rp/create-version").CreateVersionConfig} */
export default {
  releaseTypeDescriptions: {
    patch: "Solo arreglos o cambios internos; las reglas, la API pública y la CLI no cambian.",
    minor: "Reglas, análisis u opciones nuevas compatibles; lo existente sigue funcionando igual.",
    major: "Regla nueva que puede hacer fallar proyectos que hoy pasan, o cambio incompatible en la API o la CLI.",
  },
  checks: ["npm run ci"],
  publish: "npm",
  publication: { authentication: "oidc" },
  releaseTimeZone: "America/Argentina/Buenos_Aires",
  changelogDraft: true,
  summary: ["Consumidores: pnpm add -D @golfo/lint@^{version}"],
};

/** GitHub Actions workflow used by create-version. */
export const ci = {"workflow":"release.yml","secrets":[],"variables":[],"deployment":null};
