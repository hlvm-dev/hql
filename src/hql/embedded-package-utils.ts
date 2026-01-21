export interface EmbeddedPackageLookup {
  hasSpecifier: (specifier: string) => boolean;
  getBySpecifier: (specifier: string) => string | undefined;
  getByPath: (path: string) => string | undefined;
  getBySpecifierOrPath: (value: string) => string | undefined;
}

interface PackagePathMatch {
  key: string;
  modPathSuffix: string;
  pathMarker: string;
}

export function createEmbeddedPackageLookup(
  packages: Record<string, string>,
): EmbeddedPackageLookup {
  const keys = Object.keys(packages);
  const matches: PackagePathMatch[] = keys.map((key) => ({
    key,
    modPathSuffix: `packages/${key.replace("@hlvm/", "")}/mod.hql`,
    pathMarker: key.replace("@hlvm/", "packages/"),
  }));

  const normalize = (value: string) => value.replace(/\\/g, "/");

  const getBySpecifier = (specifier: string): string | undefined =>
    packages[specifier];

  const getByPath = (path: string): string | undefined => {
    const normalized = normalize(path);
    for (const match of matches) {
      if (
        normalized.endsWith(match.modPathSuffix) ||
        normalized.includes(match.pathMarker)
      ) {
        return packages[match.key];
      }
    }
    return undefined;
  };

  const getBySpecifierOrPath = (value: string): string | undefined =>
    getBySpecifier(value) ?? getByPath(value);

  return {
    hasSpecifier: (specifier: string) => Boolean(packages[specifier]),
    getBySpecifier,
    getByPath,
    getBySpecifierOrPath,
  };
}
