import { typeByExtension } from "@std/media-types";

function normalizeExtension(value: string): string {
  return value.trim().toLowerCase().replace(/^\./, "");
}

export function getMimeTypeForExtension(extension: string): string | undefined {
  return typeByExtension(normalizeExtension(extension));
}
