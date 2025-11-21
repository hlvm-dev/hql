import { resolve } from "https://deno.land/std@0.224.0/path/resolve.ts";
import { join } from "https://deno.land/std@0.224.0/path/join.ts";
import { SimpleReadline } from "./simple-readline.ts";
import { analyzeContinuation } from "./multiline.ts";
import type {
  EvalResult,
  CompletionItem,
  CompletionRequest,
  REPLCommand,
  REPLConfig,
  REPLContext,
  REPLPlugin,
} from "./plugin-interface.ts";

const EXIT_COMMANDS = new Set(["close()", "(close)"]);
const INITIAL_MODULE = `// Pure REPL persistent module\n// Auto-generated - do not edit\n\nexport const __repl_exports = {};\n`;
const INITIAL_LINES = INITIAL_MODULE.trim().split("\n").length + 1;

const COLORS = {
  reset: "\x1b[0m",
  dim: "\x1b[90m",
  number: "\x1b[32m",
  string: "\x1b[33m",
  boolean: "\x1b[33m",
  func: "\x1b[36m",
};

function formatValue(value: unknown): string {
  if (value === undefined) return `${COLORS.dim}undefined${COLORS.reset}`;
  if (value === null) return `${COLORS.dim}null${COLORS.reset}`;

  switch (typeof value) {
    case "number":
      return `${COLORS.number}${value}${COLORS.reset}`;
    case "bigint":
      return `${COLORS.number}${value}n${COLORS.reset}`;
    case "string":
      return `${COLORS.string}${JSON.stringify(value)}${COLORS.reset}`;
    case "boolean":
      return `${COLORS.boolean}${value}${COLORS.reset}`;
    case "function": {
      const ctor = value.constructor?.name;
      const tag = ctor === "AsyncFunction" ? "AsyncFunction" : "Function";
      const name = value.name ? `: ${value.name}` : "";
      return `${COLORS.func}[${tag}${name}]${COLORS.reset}`;
    }
    default:
      return Deno.inspect(value, { colors: true, depth: 4 });
  }
}

interface SelectedPlugin {
  plugin: REPLPlugin;
  context: REPLContext;
}

export class REPL {
  private readonly plugins: REPLPlugin[];
  private readonly config: REPLConfig;
  private readonly indentUnit: string;
  private readonly continuationPrompt: string;
  private readonly completionWords = new Map<string, { item: CompletionItem; weight: number; lowerLabel: string }>();
  private rl: SimpleReadline | null = null;
  private tempDir = "";
  private modulePath = "";
  private moduleBuffer = INITIAL_MODULE;
  private lineNumber = INITIAL_LINES;
  private initialized = false;
  private pluginState = new Map<string, Map<string, unknown>>();
  private disposed = false;
  private readonly keywords: string[];
  private readonly editorLauncher?: (tempFile: string) => Promise<void>;

  constructor(plugins: REPLPlugin[], config: REPLConfig = {}) {
    if (plugins.length === 0) {
      throw new Error("REPL requires at least one plugin");
    }
    this.plugins = plugins;
    this.config = config;
    this.indentUnit = config.indentUnit ?? "  ";
    this.continuationPrompt = config.continuationPrompt ?? "... ";
    this.keywords = config.keywords ?? [];
    this.editorLauncher = config.editorLauncher;
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    const tempDirPrefix = this.config.tempDirPrefix ?? "repl-";
    this.tempDir = await Deno.makeTempDir({ prefix: tempDirPrefix });
    this.modulePath = join(this.tempDir, "repl-module.mjs");
    await Deno.writeTextFile(this.modulePath, INITIAL_MODULE);
    this.moduleBuffer = INITIAL_MODULE;
    this.lineNumber = INITIAL_LINES;
    this.initialized = true;

    if (this.config.onInit) {
      await this.config.onInit(this.createContext());
    }

    await Promise.all(
      this.plugins.map(async (plugin) => {
        if (plugin.init) {
          await plugin.init(this.createContext(plugin));
        }
      }),
    );
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;

    await Promise.all(
      this.plugins.map(async (plugin) => {
        if (plugin.cleanup) {
          await plugin.cleanup(this.createContext(plugin));
        }
      }),
    );

    this.rl = null;

    if (this.tempDir) {
      try {
        await Deno.remove(this.tempDir, { recursive: true });
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  async start(): Promise<void> {
    await this.init();
    const commands = this.composeCommands();
    const prompt = this.config.prompt ?? "> ";
    const isTTY = typeof Deno.stdin.isTerminal === "function" ? Deno.stdin.isTerminal() : true;

    if (!isTTY) {
      try {
        await this.runNonInteractive(commands);
      } finally {
        await this.dispose();
      }
      return;
    }

    this.rl = new SimpleReadline(this.keywords);
    this.rl.setCompletionProvider((request) => this.provideCompletions(request));

    if (this.config.banner) {
      console.log(this.config.banner);
    }

    let pendingInput = "";
    let indentLevel = 0;

    try {
      while (true) {
        const activePrompt = pendingInput
          ? this.continuationPrompt
          : prompt;
        const seed = pendingInput && indentLevel > 0
          ? this.indentUnit.repeat(indentLevel)
          : "";
        const input = await this.rl.readline(activePrompt, seed);
        if (input === null) break;

        pendingInput = pendingInput
          ? `${pendingInput}\n${input}`
          : input;

        const continuation = analyzeContinuation(pendingInput);
        if (continuation.needsContinuation) {
          indentLevel = continuation.indentLevel;
          continue;
        }

        indentLevel = 0;
        const keepGoing = await this.handleInputLine(pendingInput, commands);
        pendingInput = "";
        if (!keepGoing) break;
      }
    } finally {
      await this.dispose();
    }
  }

  private async runNonInteractive(commands: Record<string, REPLCommand>): Promise<void> {
    const decoder = new TextDecoder();
    const buffer = new Uint8Array(1024);
    let pending = "";

    while (true) {
      const read = await Deno.stdin.read(buffer);
      if (read === null) {
        if (pending.length > 0) {
          await this.handleInputLine(pending, commands);
        }
        break;
      }

      pending += decoder.decode(buffer.subarray(0, read));

      while (true) {
        const newlineIndex = pending.indexOf("\n");
        if (newlineIndex === -1) break;
        const line = pending.slice(0, newlineIndex).replace(/\r$/, "");
        pending = pending.slice(newlineIndex + 1);
        const keepGoing = await this.handleInputLine(line, commands);
        if (!keepGoing) return;
      }
    }
  }

  private async handleInputLine(line: string, commands: Record<string, REPLCommand>): Promise<boolean> {
    const trimmed = line.trim();
    if (trimmed.length === 0) return true;
    if (EXIT_COMMANDS.has(trimmed)) return false;

    if (trimmed.startsWith(".")) {
      const [commandName] = trimmed.split(/\s+/, 1);
      const command = commands[commandName];
      if (command) {
        await command.handler(this.createContext(), trimmed);
      }
      return true;
    }

    await this.processCode(trimmed);
    return true;
  }

  async evaluate(code: string): Promise<EvalResult | void> {
    await this.init();
    return await this.processCode(code);
  }

  private async processCode(code: string): Promise<EvalResult | void> {
    const { plugin, context } = await this.selectPlugin(code);
    const previousModule = this.moduleBuffer;
    const previousLine = this.lineNumber;
    try {
      const result = await plugin.evaluate(code, context);
      this.lineNumber += Math.max(1, result?.lines ?? 1);
      if (result) {
        if (result.formatted) {
          console.log(result.formatted);
        } else if ("value" in result) {
          console.log(formatValue(result.value));
        } else if (result.suppressOutput) {
          console.log(formatValue(undefined));
        }
      } else {
        console.log(formatValue(undefined));
      }
      this.ingestCompletionTokens(code);
      return result;
    } catch (error) {
      await this.restoreModule(previousModule);
      this.lineNumber = previousLine;
      const message = error instanceof Error ? error.message : String(error);
      console.error(`${plugin.name} Error: ${message}`);
    }
  }

  private async selectPlugin(code: string): Promise<SelectedPlugin> {
    let selected: SelectedPlugin | null = null;
    let bestScore = -Infinity;
    let fallback: SelectedPlugin | null = null;

    for (const plugin of this.plugins) {
      const context = this.createContext(plugin);
      if (!plugin.detect) {
        if (!fallback) fallback = { plugin, context };
        continue;
      }

      const detection = await plugin.detect(code, context);
      if (detection === false) continue;

      const score = typeof detection === "number" ? detection : 0;
      if (score > bestScore) {
        bestScore = score;
        selected = { plugin, context };
      }
    }

    if (selected) return selected;
    if (fallback) return fallback;
    return { plugin: this.plugins[0], context: this.createContext(this.plugins[0]) };
  }

  private getStateFor(plugin?: REPLPlugin): Map<string, unknown> {
    const key = plugin?.name ?? "__global__";
    if (!this.pluginState.has(key)) {
      this.pluginState.set(key, new Map());
    }
    return this.pluginState.get(key)!;
  }

  private createContext(plugin?: REPLPlugin): REPLContext {
    const state = this.getStateFor(plugin);
    const instance = this;

    return {
      modulePath: instance.modulePath,
      tempDir: instance.tempDir,
      get lineNumber() {
        return instance.lineNumber;
      },
      appendToModule: async (code: string) => {
        instance.moduleBuffer += code;
        await Deno.writeTextFile(instance.modulePath, instance.moduleBuffer);
      },
      overwriteModule: async (code: string) => {
        instance.moduleBuffer = code;
        await Deno.writeTextFile(instance.modulePath, instance.moduleBuffer);
      },
      reimportModule: async <T>() => {
        const specifier = `file://${instance.modulePath}?ts=${Date.now()}&r=${crypto.randomUUID()}`;
        const module = await import(specifier);
        return module as T;
      },
      resetState: () => state.clear(),
      getState: <T>(key: string) => state.get(key) as T | undefined,
      setState: (key: string, value: unknown) => {
        state.set(key, value);
      },
    };
  }

  private composeCommands(): Record<string, REPLCommand> {
    const commands: Record<string, REPLCommand> = {
      ".help": {
        description: "Show help",
        handler: () => this.printHelp(),
      },
      ".clear": {
        description: "Clear screen",
        handler: () => console.clear(),
      },
      ".reset": {
        description: "Reset module state",
        handler: async () => {
          await this.resetSession();
          console.log("REPL state reset.");
        },
      },
      ".load": {
        description: "Load and execute a file",
        handler: async (_, input) => {
          const target = input.slice(".load".length).trim();
          if (!target) {
            console.log("Usage: .load <file>");
            return;
          }
          const resolved = resolve(target);
          try {
            const contents = await Deno.readTextFile(resolved);
            await this.processCode(contents);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            console.error(`Failed to load ${resolved}: ${message}`);
          }
        },
      },
      ".save": {
        description: "Save REPL history to a file",
        handler: async (_, input) => {
          const target = input.slice(".save".length).trim();
          if (!target) {
            console.log("Usage: .save <file>");
            return;
          }
          if (!this.rl) {
            console.error("REPL not initialized.");
            return;
          }
          const resolved = resolve(target);
          try {
            const history = this.rl.getHistory().join("\n");
            await Deno.writeTextFile(resolved, history);
            console.log(`Session saved to ${resolved}`);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            console.error(`Failed to save ${resolved}: ${message}`);
          }
        },
      },
      ".editor": {
        description: "Open external editor to enter multi-line code",
        handler: async () => {
          await this.launchExternalEditor();
        },
      },
    };

    const merge = (source?: Record<string, REPLCommand>) => {
      if (!source) return;
      for (const [key, command] of Object.entries(source)) {
        commands[key] = command;
      }
    };

    merge(this.config.commands);
    for (const plugin of this.plugins) {
      merge(plugin.commands);
    }

    for (const cmd of Object.keys(commands)) {
      if (cmd) this.recordCompletion({ label: cmd, detail: "command" });
    }
    return commands;
  }

  private async resetSession(): Promise<void> {
    this.moduleBuffer = INITIAL_MODULE;
    this.lineNumber = INITIAL_LINES;
    await Deno.writeTextFile(this.modulePath, this.moduleBuffer);
    this.pluginState.forEach((state) => state.clear());
    this.completionWords.clear();
  }

  private printHelp(): void {
    const pluginList = this.plugins.map((p) => `  - ${p.name}${p.description ? `: ${p.description}` : ""}`).join("\n");
    console.log(`` +
      `Commands:\n` +
      `  .help    Show this help\n` +
      `  .clear   Clear the screen\n` +
      `  .reset   Reset REPL state\n` +
      `  .load    Load and execute a file\n` +
      `  .save    Save session history to a file\n` +
      `  .editor  Open $EDITOR for multi-line input\n` +
      `  close()  Exit REPL\n` +
      `\nAvailable Plugins:\n${pluginList}\n` +
      `\nShortcuts:\n` +
      `  Ctrl+A/E  Jump to start/end of line\n` +
      `  Ctrl+W/U/K Delete word/start/end\n` +
      `  ↑/↓        Navigate history\n`);
  }

  private async restoreModule(snapshot: string): Promise<void> {
    if (snapshot === this.moduleBuffer) return;
    this.moduleBuffer = snapshot;
    await Deno.writeTextFile(this.modulePath, this.moduleBuffer);
  }

  private ingestCompletionTokens(source: string): void {
    const identifiers = source.match(/[A-Za-z_$][A-Za-z0-9_$?!-]*/g) ?? [];
    for (const word of identifiers) {
      if (!word || word.startsWith("__")) continue;
      this.recordCompletion({ label: word });
    }
    const commands = source.match(/\.[A-Za-z0-9._-]+/g) ?? [];
    for (const cmd of commands) {
      if (!cmd) continue;
      this.recordCompletion({ label: cmd, detail: "command" });
    }
  }

  private async provideCompletions(request: CompletionRequest): Promise<CompletionItem[]> {
    const normalized = request.prefix.toLowerCase();

    const seen = new Map<string, CompletionItem & { weight?: number }>();
    const lowerCache = new Map<string, string>();
    const getLower = (label: string): string => {
      let cached = lowerCache.get(label);
      if (cached === undefined) {
        cached = label.toLowerCase();
        lowerCache.set(label, cached);
      }
      return cached;
    };
    const collect = (item?: CompletionItem & { weight?: number }, lowerLabel?: string) => {
      if (!item || !item.label) return;
      const candidateLower = normalized && normalized.length > 0
        ? (lowerLabel ?? getLower(item.label))
        : "";
      if (normalized && normalized.length > 0 && !candidateLower.startsWith(normalized)) {
        return;
      }
      const current = seen.get(item.label);
      if (!current) {
        seen.set(item.label, item);
        return;
      }
      const currentWeight = current.weight ?? 0;
      const incomingWeight = item.weight ?? 0;
      if (incomingWeight > currentWeight) {
        seen.set(item.label, item);
      }
    };
    for (const stored of this.completionWords.values()) {
      if (stored.lowerLabel.startsWith(normalized)) {
        collect({ ...stored.item, weight: stored.weight }, stored.lowerLabel);
      }
    }

    for (const plugin of this.plugins) {
      if (!plugin.getCompletions) continue;
      try {
        const provided = await plugin.getCompletions(request, this.createContext(plugin));
        if (provided && provided.length) {
          for (const candidate of provided) {
            collect(candidate);
          }
        }
      } catch (error) {
        if (this.config.debug) {
          console.warn(`${plugin.name} completion error:`, error);
        }
      }
    }

    return Array.from(seen.values()).sort((a, b) => {
      const wa = "weight" in a ? (a as any).weight as number : 0;
      const wb = "weight" in b ? (b as any).weight as number : 0;
      if (wa !== wb) return wb - wa;
      return a.label.localeCompare(b.label);
    }).map(({ weight, ...rest }) => rest);
  }

  private recordCompletion(item: CompletionItem, weight = 1): void {
    if (!item.label) return;
    const lowerLabel = item.label.toLowerCase();
    const existing = this.completionWords.get(item.label);
    if (existing) {
      existing.weight += weight;
      existing.item = { ...existing.item, ...item };
    } else {
      this.completionWords.set(item.label, { item: { ...item }, weight, lowerLabel });
    }
  }

  private async launchExternalEditor(): Promise<void> {
    const editorValue = Deno.env.get("VISUAL") ?? Deno.env.get("EDITOR") ?? "vi";
    const tokens = editorValue.match(/(?:[^\s"]+|"[^"]*")+/g)?.map((token) => token.replace(/^"(.*)"$/, "$1")) ?? [editorValue];
    const editor = tokens[0];
    const args = tokens.slice(1);

    const tempFile = await Deno.makeTempFile({ dir: this.tempDir, prefix: "repl-editor-", suffix: ".tmp" });
    await Deno.writeTextFile(tempFile, "// Entering editor mode (^D to finish)\n");

    const canUseRaw = typeof Deno.stdin.setRaw === "function";
    if (canUseRaw) {
      try {
        Deno.stdin.setRaw(false);
      } catch {
        // ignore
      }
    }

    try {
      if (this.editorLauncher) {
        await this.editorLauncher(tempFile);
      } else {
        const command = new Deno.Command(editor, {
          args: [...args, tempFile],
          stdin: "inherit",
          stdout: "inherit",
          stderr: "inherit",
        });
        const child = command.spawn();
        const status = await child.status;
        if (!status.success) {
          console.error(`Editor exited with code ${status.code}`);
          return;
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Failed to launch editor: ${message}`);
      if (canUseRaw) {
        try {
          Deno.stdin.setRaw(true);
        } catch {
          // ignore
        }
      }
      try {
        await Deno.remove(tempFile);
      } catch {
        // ignore cleanup errors
      }
      return;
    }

    try {
      const contents = await Deno.readTextFile(tempFile);
      const stripped = contents.split(/\r?\n/)
        .filter((line) => !line.startsWith("// Entering editor mode"))
        .join("\n")
        .trim();
      if (!stripped) {
        console.log("Editor exited with no input.");
        return;
      }
      await this.processCode(stripped);
    } finally {
      if (canUseRaw) {
        try {
          Deno.stdin.setRaw(true);
        } catch {
          // ignore
        }
      }
      try {
        await Deno.remove(tempFile);
      } catch {
        // ignore cleanup errors
      }
    }
  }
}
