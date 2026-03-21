import { getPlatform } from "../../../platform/platform.ts";
import {
  isRemoteModule,
  isRemoteUrl,
} from "../../../common/import-utils.ts";

const path = () => getPlatform().path;

const SPECIAL_MODULE_IDS = new Set(["<builtin>", "<special-form>"]);

export function canonicalizeModuleId(
  modulePath: string,
  resolvedPath?: string,
): string {
  if (SPECIAL_MODULE_IDS.has(modulePath)) {
    return modulePath;
  }

  if (modulePath.startsWith("@hlvm/")) {
    return modulePath;
  }

  if (modulePath.startsWith("npm:") || modulePath.startsWith("jsr:")) {
    return modulePath;
  }

  if (isRemoteUrl(modulePath) || isRemoteModule(modulePath)) {
    return new URL(modulePath).toString();
  }

  const localPath = resolvedPath ?? modulePath;
  return path().normalize(localPath);
}

export function canonicalizeCurrentFileModuleId(filePath: string): string {
  return canonicalizeModuleId(filePath, filePath);
}
