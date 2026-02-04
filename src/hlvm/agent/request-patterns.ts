/**
 * Request Pattern Helpers
 *
 * SSOT for request pattern detection shared by tool selection and hints.
 */

const PATH_TOKEN =
  /(~\/[^\s"'`]+|\/[^\s"'`]+|\.\.?\/[^\s"'`]+|[A-Za-z]:\\[^\s"'`]+)/;
const FILE_EXTENSION_PATTERN = /\.[a-z0-9]{2,4}\b/i;

const NAMED_FOLDERS: Array<{ regex: RegExp; path: string }> = [
  { regex: /\bdownloads?\b/i, path: "~/Downloads" },
  { regex: /\bdesktop\b/i, path: "~/Desktop" },
  { regex: /\bdocuments?\b/i, path: "~/Documents" },
];

function stripTrailingPunctuation(value: string): string {
  return value.replace(/[.,;:!?)]$/, "");
}

export function extractPathToken(request: string): string | undefined {
  const match = request.match(PATH_TOKEN);
  if (!match) return undefined;
  return stripTrailingPunctuation(match[0]);
}

export function hasPathLike(request: string): boolean {
  return PATH_TOKEN.test(request);
}

export function hasFileExtension(request: string): boolean {
  return FILE_EXTENSION_PATTERN.test(request);
}

export function inferNamedFolderPath(requestLower: string): string | undefined {
  for (const entry of NAMED_FOLDERS) {
    if (entry.regex.test(requestLower)) {
      return entry.path;
    }
  }
  return undefined;
}

export function inferFilePattern(requestLower: string): string | undefined {
  if (/\bpdfs?\b/.test(requestLower) || /\.pdf\b/.test(requestLower)) {
    return "*.pdf";
  }
  return undefined;
}
