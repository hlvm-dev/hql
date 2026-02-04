/**
 * Request Pattern Helpers
 *
 * SSOT for request pattern detection shared by tool selection and hints.
 */

import {
  buildGlobForExtensions,
  getMimeTypeForExtension,
} from "../../common/file-kinds.ts";

const PATH_TOKEN =
  /(~\/[^\s"'`]+|\/[^\s"'`]+|\.\.?\/[^\s"'`]+|[A-Za-z]:\\[^\s"'`]+)/;
const FILE_EXTENSION_PATTERN = /\.[a-z0-9]{2,6}\b/gi;
const FILE_EXTENSION_TEST = /\.[a-z0-9]{2,6}\b/i;
const EXTENSION_STOP_TOKENS = new Set([
  "list",
  "show",
  "find",
  "get",
  "all",
  "every",
  "each",
  "any",
  "my",
  "file",
  "files",
  "image",
  "images",
  "photo",
  "photos",
  "picture",
  "pictures",
  "video",
  "videos",
]);

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
  return FILE_EXTENSION_TEST.test(request);
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
  const explicitExtensions = extractExplicitExtensions(requestLower);
  if (explicitExtensions.length > 0) {
    return buildGlobForExtensions(explicitExtensions);
  }
  return undefined;
}

function extractExplicitExtensions(requestLower: string): string[] {
  const matches = requestLower.match(FILE_EXTENSION_PATTERN);
  const fromDots = matches
    ? matches.map((value) => value.replace(/^\./, ""))
    : [];
  const tokenPattern =
    /\b([a-z0-9]{2,6})s?\b(?=\s+(files?|in|from|within|inside|under|at)\b)/gi;
  const fromTokens: string[] = [];
  for (const match of requestLower.matchAll(tokenPattern)) {
    let token = match[1];
    if (EXTENSION_STOP_TOKENS.has(token)) continue;
    if (fromDots.includes(token)) continue;
    let mime = getMimeTypeForExtension(token);
    if (!mime && token.endsWith("s")) {
      const singular = token.slice(0, -1);
      if (EXTENSION_STOP_TOKENS.has(singular)) continue;
      mime = getMimeTypeForExtension(singular);
      if (mime) token = singular;
    }
    if (mime) fromTokens.push(token);
  }
  return Array.from(new Set([...fromDots, ...fromTokens]));
}

export function inferMimePrefix(requestLower: string): string | undefined {
  if (/\b(images?|photos?|pictures?|pics?|screenshots?)\b/.test(requestLower)) {
    return "image/";
  }
  if (/\b(videos?|video\s+files?|movies?|movie\s+files?|clips?)\b/.test(requestLower)) {
    return "video/";
  }
  return undefined;
}
