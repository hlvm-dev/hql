import { ai } from "../../api/ai.ts";
import { initializeRuntime } from "../../../common/runtime-initializer.ts";
import {
  ensureDefaultModelInstalled,
  pullModelWithProgress,
} from "../../../common/ai-default-model.ts";
import { parseModelString } from "../../providers/index.ts";

export function showAiHelp(): void {
  console.log(`
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
      await ensureDefaultModelInstalled({ log: (message) => console.log(message) });
      return;
    }
    case "pull": {
      const modelArg = args[1];
      if (!modelArg) {
        throw new Error("Missing model name. Usage: hlvm ai pull <model>");
      }
      const [providerName, modelName] = parseModelString(modelArg);
      console.log(`Downloading model (${modelName})...`);
      await pullModelWithProgress(modelName, providerName ?? undefined, (message) => console.log(message));
      console.log(`Model ready: ${modelName}`);
      return;
    }
    case "list": {
      const models = await ai.models.list();
      if (models.length === 0) {
        console.log("No models installed.");
        return;
      }
      for (const model of models) {
        console.log(model.name);
      }
      return;
    }
    default:
      throw new Error(`Unknown ai command: ${subcommand}`);
  }
}
