import { DEFAULT_CONFIG, type HlvmConfig } from "./types.ts";

export const CURRENT_CONFIG_VERSION = DEFAULT_CONFIG.version;

export type MigrationFn = (
  config: Record<string, unknown>,
) => Record<string, unknown>;

const MIGRATIONS: Record<number, MigrationFn> = {
  0: (config) => ({
    ...config,
    version: 1,
  }),
  1: (config) => ({
    ...config,
    version: 2,
  }),
};

function normalizeVersion(raw: unknown): number {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return Math.max(0, Math.floor(raw));
  }
  if (typeof raw === "string") {
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) {
      return Math.max(0, Math.floor(parsed));
    }
  }
  return 0;
}

export function migrateConfig(
  raw: Record<string, unknown> | null,
): { config: Record<string, unknown> | null; migrated: boolean } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { config: null, migrated: false };
  }

  let current: Record<string, unknown> = { ...raw };
  let version = normalizeVersion(current.version);
  let migrated = version !== CURRENT_CONFIG_VERSION;

  while (version < CURRENT_CONFIG_VERSION) {
    const migrate = MIGRATIONS[version];
    current = migrate ? migrate(current) : { ...current, version: version + 1 };
    const nextVersion = normalizeVersion(current.version);
    if (nextVersion <= version) {
      current = { ...current, version: version + 1 };
    }
    version = normalizeVersion(current.version);
    migrated = true;
  }

  current.version = CURRENT_CONFIG_VERSION;
  return { config: current, migrated };
}

export function stampCurrentConfigVersion<T extends HlvmConfig>(
  config: T,
): T {
  return {
    ...config,
    version: CURRENT_CONFIG_VERSION,
  };
}
