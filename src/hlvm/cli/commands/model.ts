/**
 * `hlvm model` — Ollama-inspired model management CLI.
 *
 * Subcommands:
 *   (none)         Show current default model
 *   list           List all available models grouped by provider
 *   set <name>     Set default model (persisted to config SSOT)
 *   show <name>    Show model details
 *   pull <name>    Download a model (Ollama only)
 *   rm <name>      Remove a model (Ollama only)
 */

import { log } from "../../api/log.ts";
import { RuntimeError, ValidationError } from "../../../common/error.ts";
import { truncate } from "../../../common/utils.ts";
import { capabilitiesToDisplayTags } from "../../providers/types.ts";
import type { ModelInfo } from "../../providers/types.ts";
import { getProvider, parseModelString } from "../../providers/registry.ts";
import {
  getModelDiscoveryModels,
} from "../../providers/model-discovery-store.ts";
import {
  getRuntimeConfigApi,
  getRuntimeModelDiscovery,
} from "../../runtime/host-client.ts";
import { createRuntimeConfigManager } from "../../runtime/model-config.ts";
import {
  ensureRuntimeModelAvailable,
  getRuntimeModelAvailability,
} from "../../runtime/model-availability.ts";
import { persistSelectedModelConfig } from "../../../common/config/model-selection.ts";
import { hasHelpFlag } from "../utils/common-helpers.ts";

// ── Shared table helpers (also used by ai.ts via re-export) ─────────

export function buildCatalogIndex(
  models: ModelInfo[],
): Map<string, ModelInfo> {
  const index = new Map<string, ModelInfo>();
  for (const entry of models) {
    index.set(entry.name.toLowerCase(), entry);
  }
  return index;
}

export function findCatalogEntry(
  index: Map<string, ModelInfo>,
  modelName: string,
): ModelInfo | null {
  const lower = modelName.toLowerCase();
  if (index.has(lower)) return index.get(lower) ?? null;
  if (!lower.includes(":")) {
    const latest = index.get(`${lower}:latest`);
    if (latest) return latest;
    for (const [name, entry] of index.entries()) {
      if (name.startsWith(`${lower}:`)) return entry;
    }
  }
  return null;
}

export function pad(text: string, width: number): string {
  if (text.length >= width) return truncate(text, width, "…");
  return text.padEnd(width);
}

// ── Command entry point ─────────────────────────────────────────────

export async function modelCommand(args: string[]): Promise<void> {
  if (hasHelpFlag(args)) {
    showModelHelp();
    return;
  }

  const subcommand = args[0] ?? "";

  switch (subcommand) {
    // hlvm model — show current default
    case "": {
      const modelConfig = await createRuntimeConfigManager();
      const configuredModel = modelConfig.getConfig().model;
      if (!configuredModel) {
        log.raw.log("No default model configured. Use `hlvm model set <name>` to set one.");
        return;
      }
      const availability = await getRuntimeModelAvailability(configuredModel);
      const status = availability.available ? "available" : "not available";
      log.raw.log(`${configuredModel} (${status})`);
      return;
    }

    // hlvm model list — grouped table with * on default
    case "list": {
      const modelConfig = await createRuntimeConfigManager();
      const configuredModel = modelConfig.getConfig().model;
      const discoverySnapshot = await getRuntimeModelDiscovery();
      const allModels = getModelDiscoveryModels({
        timestamp: 0,
        remoteModels: discoverySnapshot.remoteModels,
        cloudModels: discoverySnapshot.cloudModels,
      }, {
        localModels: discoverySnapshot.installedModels,
        includeRemoteModels: false,
      });
      if (allModels.length === 0) {
        log.raw.log("No models available.");
        return;
      }

      // Group models by provider
      const byProvider = new Map<string, typeof allModels>();
      for (const m of allModels) {
        const provider =
          (m.metadata as Record<string, unknown>)?.provider as string ??
            "unknown";
        const group = byProvider.get(provider) ?? [];
        group.push(m);
        byProvider.set(provider, group);
      }

      const catalogIndex = buildCatalogIndex(discoverySnapshot.remoteModels);
      const nameWidth = 30;
      const tagsWidth = 20;

      for (const [provider, models] of byProvider) {
        const displayName = (models[0]?.metadata as Record<string, unknown>)
          ?.providerDisplayName as string ?? provider;
        log.raw.log(`\n${displayName}:`);
        log.raw.log(`${pad("MODEL", nameWidth)}  ${pad("TAGS", tagsWidth)}`);

        const sorted = models.slice().sort((a, b) =>
          a.name.localeCompare(b.name)
        );
        for (const model of sorted) {
          const meta = (model.metadata ?? {}) as Record<string, unknown>;
          const tags = model.capabilities
            ? capabilitiesToDisplayTags(model.capabilities)
            : [];
          if (meta.cloud === true) tags.push("cloud");
          const isLocal = typeof model.size === "number" && model.size > 0;
          if (isLocal) {
            const catalogEntry = catalogIndex
              ? findCatalogEntry(catalogIndex, model.name)
              : null;
            if (catalogEntry?.parameterSize) {
              tags.push(catalogEntry.parameterSize);
            }
          }

          const isDefault = configuredModel?.endsWith(`/${model.name}`) ||
            configuredModel === model.name;
          const prefix = isDefault ? "* " : "  ";

          log.raw.log(
            `${pad(`${prefix}${model.name}`, nameWidth)}  ${tags.join(" ")}`,
          );
        }
      }
      return;
    }

    // hlvm model set <name> — persist to config SSOT
    case "set": {
      const modelName = args[1];
      if (!modelName) {
        throw new ValidationError(
          "Missing model name. Usage: hlvm model set <name>",
          "hlvm model set",
        );
      }
      const normalized = await persistSelectedModelConfig(
        getRuntimeConfigApi(),
        modelName,
      );
      log.raw.log(`Default model set to: ${normalized}`);
      return;
    }

    // hlvm model show <name> — print model details
    case "show": {
      const modelName = args[1];
      if (!modelName) {
        throw new ValidationError(
          "Missing model name. Usage: hlvm model show <name>",
          "hlvm model show",
        );
      }
      const [providerName, localName] = parseModelString(modelName);
      const provider = providerName
        ? getProvider(providerName)
        : getProvider();
      if (!provider?.models?.get) {
        throw new ValidationError(
          `Cannot look up model details for: ${modelName}`,
          "hlvm model show",
        );
      }
      const info = await provider.models.get(localName);
      if (!info) {
        throw new ValidationError(
          `Model not found: ${modelName}`,
          "hlvm model show",
        );
      }
      log.raw.log(`Name:     ${info.name}`);
      if (info.parameterSize) log.raw.log(`Params:   ${info.parameterSize}`);
      if (info.size) log.raw.log(`Size:     ${info.size}`);
      if (info.family) log.raw.log(`Family:   ${info.family}`);
      if (info.quantization) {
        log.raw.log(`Quant:    ${info.quantization}`);
      }
      if (info.capabilities?.length) {
        log.raw.log(
          `Tags:     ${capabilitiesToDisplayTags(info.capabilities).join(", ")}`,
        );
      }
      return;
    }

    // hlvm model pull <name> — download (Ollama only)
    case "pull": {
      const modelName = args[1];
      if (!modelName) {
        throw new ValidationError(
          "Missing model name. Usage: hlvm model pull <name>",
          "hlvm model pull",
        );
      }
      const result = await ensureRuntimeModelAvailable(modelName, {
        pull: true,
        log: (message) => log.raw.log(message),
        onPullStart: (target) =>
          log.raw.log(`Downloading model (${target.modelName})...`),
      });
      if (!result.supportsLocalInstall) {
        throw new ValidationError(
          `Model pull is only supported for local Ollama models: ${modelName}`,
          "hlvm model pull",
        );
      }
      if (!result.ok) {
        throw new RuntimeError(
          result.error ?? `Model unavailable: ${result.modelName}`,
        );
      }
      log.raw.log(`Model ready: ${result.modelName}`);
      return;
    }

    // hlvm model rm <name> — remove (Ollama only)
    case "rm":
    case "remove": {
      const modelName = args[1];
      if (!modelName) {
        throw new ValidationError(
          "Missing model name. Usage: hlvm model rm <name>",
          "hlvm model rm",
        );
      }
      const [providerName] = parseModelString(modelName);
      const provider = providerName
        ? getProvider(providerName)
        : getProvider("ollama");
      if (!provider?.models?.remove) {
        throw new ValidationError(
          `Model removal is only supported for Ollama models: ${modelName}`,
          "hlvm model rm",
        );
      }
      const removed = await provider.models.remove(
        providerName ? modelName.split("/").slice(1).join("/") : modelName,
      );
      if (removed) {
        log.raw.log(`Removed: ${modelName}`);
      } else {
        log.raw.log(`Model not found or already removed: ${modelName}`);
      }
      return;
    }

    default:
      throw new ValidationError(
        `Unknown model command: ${subcommand}. Run \`hlvm model --help\` for usage.`,
        "hlvm model",
      );
  }
}

export function showModelHelp(): void {
  log.raw.log(`
HLVM Model - Manage AI models

USAGE:
  hlvm model               Show current default model
  hlvm model list          List all available models (grouped by provider)
  hlvm model set <name>    Set default model (persisted)
  hlvm model show <name>   Show model details (params, capabilities, size)
  hlvm model pull <name>   Download a model (Ollama only)
  hlvm model rm <name>     Remove a model (Ollama only)

OPTIONS:
  --help, -h               Show this help message
`);
}
