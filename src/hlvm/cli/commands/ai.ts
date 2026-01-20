import { ai } from "../../api/ai.ts";
import { log } from "../../api/log.ts";
import { initializeRuntime } from "../../../common/runtime-initializer.ts";
import {
  ensureDefaultModelInstalled,
  pullModelWithProgress,
} from "../../../common/ai-default-model.ts";
import { parseModelString } from "../../providers/index.ts";
import { ValidationError } from "../../../common/error.ts";

export function showAiHelp(): void {
  log.raw.log(`
HLVM AI - Model Setup

USAGE:
  hlvm ai setup            Ensure the default model is installed
  hlvm ai pull <model>     Download a model (e.g., ollama/llama3.2:latest)
  hlvm ai list             List installed models

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
      const models = await ai.models.list();
      if (models.length === 0) {
        log.raw.log("No models installed.");
        return;
      }
      for (const model of models) {
        log.raw.log(model.name);
      }
      return;
    }
    default:
      throw new ValidationError(`Unknown ai command: ${subcommand}`);
  }
}
