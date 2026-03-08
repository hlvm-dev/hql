import { log } from "../../api/log.ts";
import { getProgressPercent } from "../../../common/ai-default-model.ts";
import {
  capabilitiesToDisplayTags,
  parseModelString,
} from "../../providers/index.ts";
import type { ModelInfo } from "../../providers/types.ts";
import { RuntimeError, ValidationError } from "../../../common/error.ts";
import { startModelBrowser } from "../repl-ink/model-browser.tsx";
import { formatBytes } from "../../../common/limits.ts";
import { getPlatform } from "../../../platform/platform.ts";
import { DEFAULT_TERMINAL_WIDTH } from "../repl-ink/ui-constants.ts";
import { truncate } from "../../../common/utils.ts";
import {
  getTaskManager,
  isModelPullTask,
  type ModelPullTask,
} from "../repl/task-manager/index.ts";
import { hasHelpFlag } from "../utils/common-helpers.ts";
import {
  getModelDiscoveryModels,
} from "../../providers/model-discovery-store.ts";
import {
  getRuntimeModelDiscovery,
  listRuntimeInstalledModels,
} from "../../runtime/host-client.ts";
import { createRuntimeConfigManager } from "../../runtime/model-config.ts";
import {
  ensureRuntimeModelAvailable,
  getRuntimeModelAvailability,
} from "../../runtime/model-availability.ts";
import { isOllamaCloudModelId } from "../../runtime/ollama-cloud-access.ts";

function buildCatalogIndex(models: ModelInfo[]): Map<string, ModelInfo> {
  const index = new Map<string, ModelInfo>();
  for (const entry of models) {
    index.set(entry.name.toLowerCase(), entry);
  }
  return index;
}

function findCatalogEntry(
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

function pad(text: string, width: number): string {
  if (text.length >= width) return truncate(text, width, "…");
  return text.padEnd(width);
}

function formatDownloadProgress(task: ModelPullTask): string {
  const progress = task.progress;
  if (!progress) return "";
  const percent = getProgressPercent(progress);
  const hasBytes = typeof progress.completed === "number" &&
    typeof progress.total === "number" &&
    progress.total > 0;
  const bytesText = hasBytes
    ? `${formatBytes(progress.completed!)} / ${formatBytes(progress.total!)}`
    : "";
  const status = (progress.status || "").trim();
  const parts: string[] = [];
  if (typeof percent === "number") parts.push(`${percent}%`);
  if (bytesText) {
    parts.push(bytesText);
  } else if (status) {
    parts.push(status);
  }
  return parts.join(" ");
}

async function ensureConfiguredModelInstalledViaHost(
  logMessage: (message: string) => void,
): Promise<boolean> {
  if (getPlatform().env.get("HLVM_DISABLE_AI_AUTOSTART")) return false;

  const modelConfig = await createRuntimeConfigManager();
  const configuredModel = modelConfig.getConfiguredModel();
  const result = await ensureRuntimeModelAvailable(
    configuredModel,
    {
      pull: true,
      log: logMessage,
      requireCloudAccess: isOllamaCloudModelId(configuredModel),
      onPullStart: (target) =>
        logMessage(`Downloading default model (${target.modelName})...`),
    },
  );
  if (!result.ok) {
    throw new RuntimeError(
      result.error ?? `Default model unavailable: ${result.modelName}`,
    );
  }
  if (result.status === "pulled") {
    logMessage(`Default model ready: ${result.modelName}`);
  }
  return true;
}

export function showAiHelp(): void {
  log.raw.log(`
HLVM AI - Model Setup

USAGE:
  hlvm ai setup            Ensure the default model is installed
  hlvm ai pull <model>     Download a model (e.g., ollama/llama3.2:latest)
  hlvm ai list             List installed models
  hlvm ai downloads        Show active model downloads
  hlvm ai browse           Interactive model browser (download + set default)
  hlvm ai model            Show current default model

OPTIONS:
  --help, -h               Show this help message
`);
}

export async function aiCommand(args: string[]): Promise<void> {
  if (hasHelpFlag(args)) {
    showAiHelp();
    return;
  }

  const subcommand = args[0] ?? "setup";

  switch (subcommand) {
    case "setup": {
      await ensureConfiguredModelInstalledViaHost((message) =>
        log.raw.log(message)
      );
      return;
    }
    case "pull": {
      const modelArg = args[1];
      if (!modelArg) {
        throw new ValidationError(
          "Missing model name. Usage: hlvm ai pull <model>",
          "hlvm ai pull",
        );
      }
      const result = await ensureRuntimeModelAvailable(modelArg, {
        pull: true,
        log: (message) => log.raw.log(message),
        onPullStart: (target) =>
          log.raw.log(`Downloading model (${target.modelName})...`),
      });
      if (!result.supportsLocalInstall) {
        throw new ValidationError(
          `Model pull is only supported for local Ollama models: ${modelArg}`,
          "hlvm ai pull",
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
      if (configuredModel) {
        log.raw.log(`Default: ${configuredModel}`);
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
    case "downloads": {
      const manager = getTaskManager();
      const pullTasks = Array.from(manager.getTasks().values()).filter(
        isModelPullTask,
      );
      const active = pullTasks.filter((task) =>
        task.status === "pending" || task.status === "running"
      );
      if (active.length === 0) {
        log.raw.log("No active downloads.");
        return;
      }

      const sorted = active.slice().sort((a, b) => {
        const rank = (
          task: ModelPullTask,
        ) => (task.status === "running" ? 0 : 1);
        return rank(a) - rank(b) || a.createdAt - b.createdAt;
      });

      const columns = getPlatform().terminal.consoleSize().columns ||
        DEFAULT_TERMINAL_WIDTH;
      const nameWidth = Math.min(
        Math.max(...sorted.map((t) => t.modelName.length), 10) + 2,
        32,
      );
      const statusWidth = 12;
      const fixed = nameWidth + statusWidth + 4;
      const progressWidth = Math.max(0, columns - fixed);

      const headerParts = [
        pad("MODEL", nameWidth),
        pad("STATUS", statusWidth),
      ];
      if (progressWidth > 0) headerParts.push("PROGRESS");
      log.raw.log(headerParts.join("  "));

      for (const task of sorted) {
        const status = task.status === "pending" || task.status === "running"
          ? "downloading"
          : task.status;
        const progress = formatDownloadProgress(task);
        const lineParts = [
          pad(task.modelName, nameWidth),
          pad(status, statusWidth),
        ];
        if (progressWidth > 0) {
          lineParts.push(truncate(progress, progressWidth));
        }
        log.raw.log(lineParts.join("  "));
      }
      return;
    }
    case "model":
    case "current-model":
    case "current": {
      const modelConfig = await createRuntimeConfigManager();
      const configuredModel = modelConfig.getConfig().model;
      if (!configuredModel) {
        log.raw.log("No default model configured.");
        return;
      }
      const availability = await getRuntimeModelAvailability(configuredModel);
      const status = availability.available ? "installed" : "not installed";
      log.raw.log(`Default: ${configuredModel} (${status})`);
      return;
    }
    case "browse":
    case "models": {
      const beforeModel =
        (await createRuntimeConfigManager()).getConfig().model;
      const result = await startModelBrowser();
      if (result.code !== 0) return;
      if (result.selectedModel) {
        if (result.selectedModel !== beforeModel) {
          log.raw.log(`Default model: ${result.selectedModel}`);
        } else {
          log.raw.log(`Default model unchanged: ${result.selectedModel}`);
        }
      } else {
        log.raw.log("No model selected.");
      }
      return;
    }
    default:
      throw new ValidationError(
        `Unknown ai command: ${subcommand}`,
        "hlvm ai",
      );
  }
}
