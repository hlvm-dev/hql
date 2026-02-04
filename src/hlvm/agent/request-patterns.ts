/**
 * Request Pattern Helpers
 *
 * SSOT for request pattern detection shared by tool selection and hints.
 */

const PATH_TOKEN =
  /(~\/[^\s"'`]+|\/[^\s"'`]+|\.\.?\/[^\s"'`]+|[A-Za-z]:\\[^\s"'`]+)/;
const FILE_EXTENSION_PATTERN = /\.[a-z0-9]{2,4}\b/i;
const IMAGE_EXTENSIONS = [
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "heic",
  "heif",
  "bmp",
  "tif",
  "tiff",
  "svg",
  "ico",
  "avif",
] as const;
const IMAGE_PATTERN = `*.{${IMAGE_EXTENSIONS.join(",")}}`;

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
  if (
    /\b(images?|photos?|pictures?|pics?|screenshots?)\b/.test(requestLower) ||
    /\.(png|jpe?g|gif|webp|heic|heif|bmp|tiff?|svg|ico|avif)\b/.test(
      requestLower,
    ) ||
    /\b(png|jpe?g|gif|webp|heic|heif|bmp|tiff?|svg|ico|avif)\b/.test(
      requestLower,
    )
  ) {
    return IMAGE_PATTERN;
  }
  return undefined;
}
