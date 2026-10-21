/** A dependency-cruiser `forbidden` rule. */
export interface ForbiddenRule {
  name: string;
  severity: "error" | "warn" | "info";
  comment?: string;
  from: Record<string, unknown>;
  to: Record<string, unknown>;
}

/** Modules nobody may import. */
export interface ForbiddenPath {
  name: string;
  /** Regular expression of the forbidden modules. */
  path: string;
  /** Why, and what to import instead. */
  comment: string;
}

export interface DependencyCruiserConfigOptions {
  /** Folder whose subfolders are hexagonal modules (`domain`, `application`, `infrastructure`). */
  hexagonalModulesPath?: string;
  forbiddenPaths?: ForbiddenPath[];
  /** `tsconfig.json` whose `paths` aliases resolve imports. */
  tsConfigFileName?: string;
}

/** Builds a dependency-cruiser config from the shared rules. */
export function createDependencyCruiserConfig(options?: DependencyCruiserConfigOptions): {
  forbidden: ForbiddenRule[];
  options: Record<string, unknown>;
};
