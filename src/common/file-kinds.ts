import { typeByExtension } from "jsr:@std/media-types@1";

function normalizeExtension(value: string): string {
  return value.trim().toLowerCase().replace(/^\./, "");
}

export function buildGlobForExtensions(extensions: string[]): string | undefined {
  const normalized = extensions
    .map(normalizeExtension)
    .filter((ext) => ext.length > 0);
  const unique = Array.from(new Set(normalized));
  if (unique.length === 0) return undefined;
  if (unique.length === 1) return `*.${unique[0]}`;
  return `*.{${unique.join(",")}}`;
}

export function getMimeTypeForExtension(extension: string): string | undefined {
  return typeByExtension(normalizeExtension(extension));
}
