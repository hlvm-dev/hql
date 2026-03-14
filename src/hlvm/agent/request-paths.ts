import { getPlatform } from "../../platform/platform.ts";

const FILE_PATH_PATTERN =
  /(?:~\/|\.{1,2}\/|\/)?(?:[\w@-]+\/)*[\w.-]+\.[A-Za-z0-9]+/g;

function normalizeMatchedPath(match: string): string {
  return match.replace(/^[`"'(\[]+|[`"',.;:)\]]+$/g, "");
}

export function extractMentionedFilePaths(text: string): string[] {
  const matches = text.match(FILE_PATH_PATTERN) ?? [];
  const paths = matches
    .map(normalizeMatchedPath)
    .filter((value) => value.length > 0);
  return [...new Set(paths)];
}

function resolveMentionedPath(path: string, workspace: string): string {
  const platform = getPlatform();
  if (path.startsWith("~/")) {
    const home = platform.env.get("HOME") ?? "";
    return home ? platform.path.join(home, path.slice(2)) : path;
  }
  if (platform.path.isAbsolute(path)) {
    return path;
  }
  return platform.path.join(workspace, path);
}

export async function resolveExistingMentionedFiles(
  text: string,
  workspace: string,
): Promise<string[]> {
  const platform = getPlatform();
  const mentionedPaths = extractMentionedFilePaths(text);
  const existing: string[] = [];
  for (const mentionedPath of mentionedPaths) {
    try {
      const stat = await platform.fs.stat(
        resolveMentionedPath(mentionedPath, workspace),
      );
      if (stat.isFile) {
        existing.push(mentionedPath);
      }
    } catch {
      // Ignore non-existent or inaccessible paths.
    }
  }
  return existing;
}
