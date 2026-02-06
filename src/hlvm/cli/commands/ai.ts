import { ai } from "../../api/ai.ts";
import { log } from "../../api/log.ts";
import { config } from "../../api/config.ts";
import { initializeRuntime } from "../../../common/runtime-initializer.ts";
import {
  ensureDefaultModelInstalled,
  getProgressPercent,
  pullModelWithProgress,
} from "../../../common/ai-default-model.ts";
import { capabilitiesToDisplayTags, parseModelString } from "../../providers/index.ts";
import { ValidationError } from "../../../common/error.ts";
import { startModelBrowser } from "../repl-ink/model-browser.tsx";
import { getOllamaCatalog } from "../../providers/ollama/catalog.ts";
import { formatBytes } from "../../../common/limits.ts";
import { getPlatform } from "../../../platform/platform.ts";
import { truncate } from "../../../common/utils.ts";
import { getTaskManager, isModelPullTask, type ModelPullTask } from "../repl/task-manager/index.ts";

function resolveDefaultLocalName(
  localModels: { name: string }[],
  configuredModel: string | undefined,
): string | null {
  if (!configuredModel) return null;
  const [, modelName] = parseModelString(configuredModel);
  if (!modelName) return null;
  const normalized = modelName.toLowerCase();
  const hasTag = normalized.includes(":");
  if (hasTag) {
    const exact = localModels.find((m) => m.name.toLowerCase() === normalized);
    return exact?.name ?? null;
  }

  const exact = localModels.find((m) => m.name.toLowerCase() === normalized);
  if (exact) return exact.name;
  const latest = localModels.find((m) => m.name.toLowerCase() === `${normalized}:latest`);
  if (latest) return latest.name;
  const prefix = localModels.find((m) => m.name.toLowerCase().startsWith(`${normalized}:`));
  return prefix?.name ?? null;
}

function buildCatalogIndex(): Map<string, ReturnType<typeof getOllamaCatalog>[number]> {
  const index = new Map<string, ReturnType<typeof getOllamaCatalog>[number]>();
  const catalog = getOllamaCatalog({ maxVariants: Number.POSITIVE_INFINITY });
  for (const entry of catalog) {
    index.set(entry.name.toLowerCase(), entry);
  }
  return index;
}

function findCatalogEntry(
  index: Map<string, ReturnType<typeof getOllamaCatalog>[number]>,
  modelName: string,
): ReturnType<typeof getOllamaCatalog>[number] | null {
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

function formatTags(tags: string[]): string {
  if (tags.length === 0) return "";
  return tags.map((tag) => `[${tag}]`).join(" ");
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
  const bytesText = hasBytes ? `${formatBytes(progress.completed!)} / ${formatBytes(progress.total!)}` : "";
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
  if (args.includes("--help") || args.includes("-h")) {
    showAiHelp();
    return;
  }

  const subcommand = args[0] ?? "setup";

  // Initialize runtime with AI (SSOT for all initialization)
  await initializeRuntime({ stdlib: false, cache: false });

  switch (subcommand) {
    case "setup": {
      await ensureDefaultModelInstalled({ log: (message) => log.raw.log(message) });
      return;
    }
    case "pull": {
      const modelArg = args[1];
      if (!modelArg) {
        throw new ValidationError("Missing model name. Usage: hlvm ai pull <model>");
      }
      const [providerName, modelName] = parseModelString(modelArg);
      log.raw.log(`Downloading model (${modelName})...`);
      await pullModelWithProgress(modelName, providerName ?? undefined, (message) => log.raw.log(message));
      log.raw.log(`Model ready: ${modelName}`);
      return;
    }
    case "list": {
      const configuredModel = config.snapshot.model;
      const [providerName] = parseModelString(configuredModel);
      const models = await ai.models.list(providerName ?? undefined);
      if (models.length === 0) {
        log.raw.log("No models installed.");
        return;
      }
      const isOllama = !providerName || providerName === "ollama";
      const catalogIndex = isOllama ? buildCatalogIndex() : null;
      const defaultLocalName = resolveDefaultLocalName(models, configuredModel);
      if (configuredModel) {
        const defaultStatus = defaultLocalName ? "Default" : "Default (not installed)";
        log.raw.log(`${defaultStatus}: ${configuredModel}`);
      }

      const sortedModels = models.slice().sort((a, b) => {
        if (defaultLocalName && a.name === defaultLocalName) return -1;
        if (defaultLocalName && b.name === defaultLocalName) return 1;
        return a.name.localeCompare(b.name);
      });

      const columns = getPlatform().terminal.consoleSize().columns || 80;
      const nameWidth = Math.min(
        Math.max(...sortedModels.map((m) => m.name.length), 10) + 2,
        28,
      );
      const sizeWidth = 9;
      const paramWidth = 7;
      const quantWidth = 8;
      const tagsWidth = 20;
      const fixed = nameWidth + sizeWidth + paramWidth + quantWidth + tagsWidth + 8;
      const descWidth = Math.max(0, columns - fixed);
      const showDesc = descWidth >= 24;

      const headerParts = [
        pad("MODEL", nameWidth),
        pad("SIZE", sizeWidth),
        pad("PARAMS", paramWidth),
        pad("QUANT", quantWidth),
        pad("TAGS", tagsWidth),
      ];
      if (showDesc) headerParts.push("DESCRIPTION");
      log.raw.log(headerParts.join("  "));

      for (const model of sortedModels) {
        const prefix = defaultLocalName && model.name === defaultLocalName ? "* " : "  ";
        const catalogEntry = catalogIndex ? findCatalogEntry(catalogIndex, model.name) : null;
        const meta = (catalogEntry?.metadata || {}) as Record<string, unknown>;
        const tags = catalogEntry ? capabilitiesToDisplayTags(catalogEntry.capabilities) : [];
        const isInstalled = typeof model.size === "number" && model.size > 0;
        if (meta.cloud === true && !isInstalled) tags.push("cloud");

        const sizeText = isInstalled ? formatBytes(model.size) : "";
        const paramSize = model.parameterSize ?? catalogEntry?.parameterSize ?? "";
        const quant = model.quantization ?? "";

        const lineParts = [
          pad(`${prefix}${model.name}`, nameWidth),
          pad(sizeText, sizeWidth),
          pad(paramSize, paramWidth),
          pad(quant, quantWidth),
          pad(tags.join(" "), tagsWidth),
        ];

        if (showDesc) {
          const description = typeof meta.description === "string" ? meta.description : "";
          lineParts.push(truncate(description, descWidth));
        }

        log.raw.log(lineParts.join("  "));
      }
      return;
    }
    case "downloads": {
      const manager = getTaskManager();
      const pullTasks = Array.from(manager.getTasks().values()).filter(isModelPullTask);
      const active = pullTasks.filter((task) => task.status === "pending" || task.status === "running");
      if (active.length === 0) {
        log.raw.log("No active downloads.");
        return;
      }

      const sorted = active.slice().sort((a, b) => {
        const rank = (task: ModelPullTask) => (task.status === "running" ? 0 : 1);
        return rank(a) - rank(b) || a.createdAt - b.createdAt;
      });

      const columns = getPlatform().terminal.consoleSize().columns || 80;
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
        const status = task.status === "pending" || task.status === "running" ? "downloading" : task.status;
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
      const configuredModel = config.snapshot.model;
      if (!configuredModel) {
        log.raw.log("No default model configured.");
        return;
      }
      const [providerName] = parseModelString(configuredModel);
      const models = await ai.models.list(providerName ?? undefined);
      const defaultLocalName = resolveDefaultLocalName(models, configuredModel);
      const status = defaultLocalName ? "installed" : "not installed";
      log.raw.log(`Default: ${configuredModel} (${status})`);
      return;
    }
    case "browse":
    case "models": {
      const beforeModel = config.snapshot.model;
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
      throw new ValidationError(`Unknown ai command: ${subcommand}`);
  }
}
