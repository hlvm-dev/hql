import { RuntimeError } from "../../common/error.ts";
import { HLVMErrorCode } from "../../common/error-codes.ts";
import { getPlatform } from "../../platform/platform.ts";

const GIB = 1024 ** 3;
const MEMORY_PROBE_TIMEOUT_MS = 5_000;

export interface BootstrapModelTier {
  minMemoryGiB: number;
  modelId: string;
}

export interface BootstrapModelTierConfig {
  defaultModelId: string;
  tiers: BootstrapModelTier[];
}

export interface SelectedBootstrapModel {
  modelId: string;
  tier: BootstrapModelTier;
  detectedMemoryBytes: number | null;
}

function getEmbeddedModelTierConfigCandidates(platform = getPlatform()): string[] {
  return [
    platform.path.fromFileUrl(
      new URL("../../../embedded-model-tiers.json", import.meta.url),
    ),
    platform.path.join(
      platform.path.fromFileUrl(new URL("../../../", import.meta.url)),
      "embedded-model-tiers.json",
    ),
  ];
}

function normalizeTierConfig(
  parsed: unknown,
): BootstrapModelTierConfig | null {
  if (!parsed || typeof parsed !== "object") return null;
  const rawDefaultModelId = (parsed as { defaultModelId?: unknown }).defaultModelId;
  const rawTiers = (parsed as { tiers?: unknown }).tiers;
  if (typeof rawDefaultModelId !== "string" || !Array.isArray(rawTiers)) {
    return null;
  }
  const tiers = rawTiers
    .filter((tier): tier is BootstrapModelTier =>
      !!tier &&
      typeof tier === "object" &&
      typeof (tier as { minMemoryGiB?: unknown }).minMemoryGiB === "number" &&
      Number.isFinite((tier as { minMemoryGiB: number }).minMemoryGiB) &&
      typeof (tier as { modelId?: unknown }).modelId === "string"
    )
    .map((tier) => ({
      minMemoryGiB: tier.minMemoryGiB,
      modelId: tier.modelId.trim(),
    }))
    .filter((tier) => tier.modelId.length > 0)
    .sort((a, b) => b.minMemoryGiB - a.minMemoryGiB);
  if (tiers.length === 0) return null;
  return {
    defaultModelId: rawDefaultModelId.trim(),
    tiers,
  };
}

export async function readPinnedBootstrapModelTierConfig(
  platform = getPlatform(),
): Promise<BootstrapModelTierConfig> {
  for (const candidate of getEmbeddedModelTierConfigCandidates(platform)) {
    try {
      const raw = await platform.fs.readTextFile(candidate);
      const parsed = normalizeTierConfig(JSON.parse(raw));
      if (parsed) return parsed;
    } catch {
      // Try next candidate.
    }
  }

  throw new RuntimeError(
    "Could not read pinned model tier config from embedded-model-tiers.json.",
    { code: HLVMErrorCode.BOOTSTRAP_FAILED },
  );
}

function parsePositiveInteger(value: string | null): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const parsed = BigInt(trimmed);
    if (parsed <= 0n || parsed > BigInt(Number.MAX_SAFE_INTEGER)) {
      return null;
    }
    return Number(parsed);
  } catch {
    return null;
  }
}

async function readCommandOutput(
  cmd: string[],
  platform = getPlatform(),
): Promise<string | null> {
  try {
    const result = await platform.command.output({
      cmd,
      stdout: "piped",
      stderr: "piped",
      timeout: MEMORY_PROBE_TIMEOUT_MS,
    });
    if (!result.success) return null;
    return new TextDecoder().decode(result.stdout).trim();
  } catch {
    return null;
  }
}

export async function detectSystemMemoryBytes(
  platform = getPlatform(),
): Promise<number | null> {
  switch (platform.build.os) {
    case "darwin":
      return parsePositiveInteger(
        await readCommandOutput(["sysctl", "-n", "hw.memsize"], platform),
      );
    case "linux": {
      const [pages, pageSize] = await Promise.all([
        readCommandOutput(["getconf", "_PHYS_PAGES"], platform),
        readCommandOutput(["getconf", "PAGE_SIZE"], platform),
      ]);
      const parsedPages = parsePositiveInteger(pages);
      const parsedPageSize = parsePositiveInteger(pageSize);
      if (!parsedPages || !parsedPageSize) return null;
      const total = BigInt(parsedPages) * BigInt(parsedPageSize);
      if (total <= 0n || total > BigInt(Number.MAX_SAFE_INTEGER)) return null;
      return Number(total);
    }
    case "windows":
      return parsePositiveInteger(
        await readCommandOutput([
          "powershell.exe",
          "-NoProfile",
          "-Command",
          "[Console]::Out.Write((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory)",
        ], platform),
      );
  }
}

export function selectBootstrapModelForMemory(
  config: BootstrapModelTierConfig,
  memoryBytes: number | null,
): SelectedBootstrapModel {
  const defaultTier = config.tiers.find((tier) =>
    tier.modelId === config.defaultModelId
  ) ?? config.tiers[config.tiers.length - 1];
  if (memoryBytes == null) {
    return {
      modelId: defaultTier.modelId,
      tier: defaultTier,
      detectedMemoryBytes: null,
    };
  }
  const selectedTier = config.tiers.find((tier) =>
    memoryBytes >= tier.minMemoryGiB * GIB
  ) ?? defaultTier;
  return {
    modelId: selectedTier.modelId,
    tier: selectedTier,
    detectedMemoryBytes: memoryBytes,
  };
}

export async function selectBootstrapModelForHost(
  platform = getPlatform(),
): Promise<SelectedBootstrapModel> {
  const [config, memoryBytes] = await Promise.all([
    readPinnedBootstrapModelTierConfig(platform),
    detectSystemMemoryBytes(platform),
  ]);
  return selectBootstrapModelForMemory(config, memoryBytes);
}
