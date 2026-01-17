import { join } from "https://deno.land/std@0.224.0/path/join.ts";
import { SimpleReadline } from "./simple-readline.ts";
import { getPlatform } from "../../../src/platform/platform.ts";
import type {
  EvalResult,
  REPLCommand,
  REPLConfig,
  REPLContext,
  REPLPlugin,
} from "./plugin-interface.ts";

const EXIT_COMMANDS = new Set(["close()", "(close)"]);
const INITIAL_MODULE = `// Pure REPL persistent module\n// Auto-generated - do not edit\n\nexport const __repl_exports = {};\n`;
const INITIAL_LINES = INITIAL_MODULE.trim().split("\n").length + 1;

const COLORS = {
  arrow: "\x1b[38;2;128;54;146m",
  reset: "\x1b[0m",
  dim: "\x1b[90m",
  number: "\x1b[32m",
  string: "\x1b[33m",
  func: "\x1b[36m",
};

function formatValue(value: unknown): string {
  const arrow = `${COLORS.arrow}=>${COLORS.reset}`;
  if (value === undefined) return `${arrow} ${COLORS.dim}undefined${COLORS.reset}`;
  if (value === null) return `${arrow} ${COLORS.dim}null${COLORS.reset}`;

  switch (typeof value) {
    case "number":
      return `${arrow} ${COLORS.number}${value}${COLORS.reset}`;
    case "string":
      return `${arrow} ${COLORS.string}${JSON.stringify(value)}${COLORS.reset}`;
    case "boolean":
      return `${arrow} ${COLORS.func}${value}${COLORS.reset}`;
    case "function":
      return `${arrow} ${COLORS.func}<function>${COLORS.reset}`;
    default:
      return `${arrow} ${String(value)}`;
  }
}

interface SelectedPlugin {
  plugin: REPLPlugin;
  context: REPLContext;
}

export class REPL {
  private readonly plugins: REPLPlugin[];
  private readonly config: REPLConfig;
  private rl: SimpleReadline | null = null;
  private tempDir = "";
  private modulePath = "";
  private moduleBuffer = INITIAL_MODULE;
  private lineNumber = INITIAL_LINES;
  private initialized = false;
  private pluginState = new Map<string, Map<string, unknown>>();
  private disposed = false;

  constructor(plugins: REPLPlugin[], config: REPLConfig = {}) {
    if (plugins.length === 0) {
      throw new Error("REPL requires at least one plugin");
    }
    this.plugins = plugins;
    this.config = config;
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    this.tempDir = await getPlatform().fs.makeTempDir({ prefix: "hlvm-repl-" });
    this.modulePath = join(this.tempDir, "repl-module.mjs");
    await getPlatform().fs.writeTextFile(this.modulePath, INITIAL_MODULE);
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
        await getPlatform().fs.remove(this.tempDir, { recursive: true });
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  async start(): Promise<void> {
    await this.init();
    const commands = this.composeCommands();
    const prompt = this.config.prompt ?? "> ";
    const isTTY = getPlatform().terminal.stdin.isTerminal();

    if (!isTTY) {
      try {
        await this.runNonInteractive(commands);
      } finally {
        await this.dispose();
      }
      return;
    }

    this.rl = new SimpleReadline();

    if (this.config.banner) {
      console.log(this.config.banner);
    }

    try {
      while (true) {
        const input = await this.rl.readline(prompt);
        if (input === null) break;
        const keepGoing = await this.handleInputLine(input, commands);
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
      const read = await getPlatform().terminal.stdin.read(buffer);
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
      const command = commands[trimmed];
      if (command) {
        await command.handler(this.createContext());
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
    try {
      const result = await plugin.evaluate(code, context);
      this.lineNumber += Math.max(1, result?.lines ?? 1);
      if (result && !result.suppressOutput) {
        if (result.formatted) {
          console.log(result.formatted);
        } else if ("value" in result) {
          console.log(formatValue(result.value));
        }
      }
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`${plugin.name} Error: ${message}`);
      this.lineNumber += 1;
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
        await getPlatform().fs.writeTextFile(instance.modulePath, instance.moduleBuffer);
      },
      overwriteModule: async (code: string) => {
        instance.moduleBuffer = code;
        await getPlatform().fs.writeTextFile(instance.modulePath, instance.moduleBuffer);
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

    return commands;
  }

  private async resetSession(): Promise<void> {
    this.moduleBuffer = INITIAL_MODULE;
    this.lineNumber = INITIAL_LINES;
    await getPlatform().fs.writeTextFile(this.modulePath, this.moduleBuffer);
    this.pluginState.forEach((state) => state.clear());
  }

  private printHelp(): void {
    const pluginList = this.plugins.map((p) => `  - ${p.name}${p.description ? `: ${p.description}` : ""}`).join("\n");
    console.log(`` +
      `Commands:\n` +
      `  .help    Show this help\n` +
      `  .clear   Clear the screen\n` +
      `  .reset   Reset REPL state\n` +
      `  close()  Exit REPL\n` +
      `\nAvailable Plugins:\n${pluginList}\n` +
      `\nShortcuts:\n` +
      `  Ctrl+A/E  Jump to start/end of line\n` +
      `  Ctrl+W/U/K Delete word/start/end\n` +
      `  ↑/↓        Navigate history\n`);
  }
}
