export interface CommonHomeFolder {
  readonly key: "downloads" | "desktop" | "documents";
  readonly name: "Downloads" | "Desktop" | "Documents";
  readonly queryAliases: readonly string[];
}

export interface CommonHomeFolderEntry extends CommonHomeFolder {
  readonly displayPath: string;
  readonly absolutePath: string;
}

export const COMMON_HOME_FOLDERS: readonly CommonHomeFolder[] = [
  {
    key: "downloads",
    name: "Downloads",
    queryAliases: ["downloads", "download", "down", "dl"],
  },
  {
    key: "desktop",
    name: "Desktop",
    queryAliases: ["desktop", "desk"],
  },
  {
    key: "documents",
    name: "Documents",
    queryAliases: ["documents", "document"],
  },
] as const;

function normalizeHomePath(home: string): string {
  return home.replace(/\/+$/, "");
}

export function getCommonHomeFolderEntries(
  home: string,
): CommonHomeFolderEntry[] {
  const normalizedHome = normalizeHomePath(home);
  if (!normalizedHome) {
    return [];
  }

  return COMMON_HOME_FOLDERS.map((folder) => ({
    ...folder,
    displayPath: `~/${folder.name}/`,
    absolutePath: `${normalizedHome}/${folder.name}`,
  }));
}

export function expandCommonHomePath(path: string, home: string): string {
  if (!path) return path;

  if (path.startsWith("~")) {
    if (!home) return path;
    return path.replace(/^~(?=$|\/)/, normalizeHomePath(home));
  }

  if (!home) return path;
  const normalizedHome = normalizeHomePath(home);

  if (
    normalizedHome &&
    !normalizedHome.startsWith("/home/") &&
    path.startsWith("/home/")
  ) {
    const suffix = path.replace(/^\/home\/[^/]+/, "");
    if (suffix === "") return normalizedHome;
    return `${normalizedHome}${suffix}`;
  }

  const folderMatch = path.match(/^\/(downloads|desktop|documents)(\/.*)?$/i);
  if (folderMatch) {
    const key = folderMatch[1].toLowerCase() as CommonHomeFolder["key"];
    const folder = COMMON_HOME_FOLDERS.find((entry) => entry.key === key);
    if (!folder) return path;
    const suffix = folderMatch[2] ?? "";
    return `${normalizedHome}/${folder.name}${suffix}`;
  }

  return path;
}

export function resolveCommonHomeFolderQuery(
  query: string,
  home: string,
): string | null {
  if (!query.includes("/") || query.startsWith("/") || query.startsWith("~")) {
    return null;
  }

  const slashIndex = query.indexOf("/");
  const head = query.slice(0, slashIndex).toLowerCase();
  const tail = query.slice(slashIndex + 1);
  const folder = COMMON_HOME_FOLDERS.find((entry) =>
    entry.queryAliases.includes(head)
  );
  if (!folder || !home) {
    return null;
  }

  return `~/${folder.name}/${tail}`;
}
