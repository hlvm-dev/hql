/**
 * HLVM REPL Commands
 * Handles slash-prefixed commands like /help and /flush.
 */

import { ANSI_COLORS } from "../ansi.ts";
import type { ReplState } from "./state.ts";
import { handleConfigCommand } from "./config/index.ts";
import { registry } from "../repl-ink/keybindings/index.ts";
import { getPlatform } from "../../../platform/platform.ts";
import { log } from "../../api/log.ts";
import { normalizeModelId } from "../../../common/config/types.ts";
import { persistSelectedModelConfig } from "../../../common/config/model-selection.ts";
import {
  listRuntimeMcpServers,
} from "../../runtime/host-client.ts";
import {
  getTaskManager,
  isDelegateTask,
  isEvalTask,
  isModelPullTask,
  isTaskActive,
} from "./task-manager/index.ts";
import {
  formatElapsed,
  formatProgressBar,
} from "../repl-ink/utils/formatting.ts";
import { STATUS_GLYPHS } from "../repl-ink/ui-constants.ts";
import type { SkillDefinition } from "../../skills/types.ts";

const { CYAN, GREEN, YELLOW, DIM_GRAY, RESET, BOLD } = ANSI_COLORS;

// Pre-compiled whitespace pattern for command parsing
const WHITESPACE_SPLIT_REGEX = /\s+/;

interface Command {
  description: string;
  handler: (
    state: ReplState,
    args: string,
    context: CommandContext,
  ) => void | Promise<void>;
}

interface CommandContext {
  output: (...args: unknown[]) => void;
}

interface RunCommandOptions {
  onOutput?: (line: string) => void;
}

function stringifyOutputArg(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "object" && value !== null) {
    try {
      return JSON.stringify(value);
    } catch {
      return "[Circular]";
    }
  }
  return String(value);
}

function createOutputWriter(
  options?: RunCommandOptions,
): (...args: unknown[]) => void {
  return (...args: unknown[]) => {
    if (options?.onOutput) {
      options.onOutput(args.map((arg) => stringifyOutputArg(arg)).join(" "));
      return;
    }
    log.raw.log(...args);
  };
}

// Commands handled by App.tsx (not in the `commands` record below)
const APP_HANDLED_COMMANDS: readonly { name: string; description: string }[] = [
];

/** Generate help text dynamically using keybinding registry */
function generateHelpText(): string {
  const shortcuts = registry.generateHelpText();

  return `
${BOLD}HLVM REPL Functions:${RESET}

  ${CYAN}(bindings)${RESET}           List all saved definitions
  ${CYAN}(unbind "x")${RESET}         Remove a definition
  ${CYAN}(remember "text")${RESET}    Save a note to MEMORY.md
  ${CYAN}(memory)${RESET}             Open MEMORY.md in your editor
  ${CYAN}(inspect x)${RESET}          Show source code (fast, no AI)
  ${CYAN}(describe x)${RESET}         Source + AI explanation & examples
  ${CYAN}(help)${RESET}               Show this help
  ${CYAN}(exit)${RESET}               Exit the REPL

${BOLD}Bindings (auto-persist def/defn):${RESET}

  Definitions are automatically saved to ~/.hlvm/memory.hql
  They persist across sessions. No explicit save needed.

${BOLD}Keybindings & Commands:${RESET}
${shortcuts}

${BOLD}Skills & Hooks:${RESET}

  ${CYAN}/skills${RESET}              List available skills
  ${CYAN}/hooks${RESET}               List active hooks
  ${CYAN}/init${RESET}                Scaffold skill/rules directories + templates
  ${CYAN}/commit${RESET}              Create a git commit (bundled skill)
  ${CYAN}/test${RESET}                Run project tests (bundled skill)
  ${CYAN}/review${RESET}              Review code changes (bundled skill)

${BOLD}Input Routing:${RESET}
  ${CYAN}(expression)${RESET}         HQL code evaluation
  ${CYAN}(js "code")${RESET}          JavaScript evaluation
  ${CYAN}/command${RESET}             Slash commands (including skills)
  Everything else      AI conversation

${BOLD}Tip:${RESET} Press ${YELLOW}Ctrl+P${RESET} to open the command palette with fuzzy search.

${BOLD}Examples:${RESET}

  ${DIM_GRAY}; HQL evaluation${RESET}
  ${GREEN}(def name "seoksoon")${RESET}
  ${GREEN}(defn greet [name] (str "Hello, " name "!"))${RESET}

  ${DIM_GRAY}; JavaScript evaluation${RESET}
  ${GREEN}(js "let x = 42")${RESET}
  ${GREEN}(js "await Promise.resolve(42)")${RESET}

  ${DIM_GRAY}; AI conversation (just type naturally)${RESET}
  ${GREEN}what does this function do?${RESET}
  ${GREEN}explain the error in my code${RESET}
`;
}

function collectSkillBadges(skill: SkillDefinition): string[] {
  const badges: string[] = [];
  if (skill.frontmatter.manual_only) badges.push("manual only");
  if (skill.frontmatter.context === "fork") badges.push("background");
  if (skill.sourceKind === "legacy-command") badges.push("legacy command");
  return badges;
}

function formatSkillDescription(skill: SkillDefinition): string {
  const hint = skill.frontmatter.argument_hint
    ? `[${skill.frontmatter.argument_hint}] `
    : "";
  const badges = collectSkillBadges(skill);
  return `${hint}${skill.frontmatter.description}${
    badges.length > 0 ? ` (${badges.join(", ")})` : ""
  }`;
}

function buildDelegatedSkillMessage(
  skill: SkillDefinition,
  renderedBody: string,
  origin: "user" | "model",
): string {
  const header = origin === "user"
    ? `# Skill: ${skill.name}\n(User invoked /${skill.name})`
    : `# Skill: ${skill.name}`;
  return `${header}\nUse delegate_agent to run this in a background agent.\n\n${renderedBody}`;
}

export const commands: Record<string, Command> = {
  "/help": {
    description: "Show help message",
    handler: (_state, _args, context) => {
      context.output(generateHelpText());
    },
  },

  "/flush": {
    description: "Clear visible screen output",
    handler: () => {
      log.raw.clear();
    },
  },

  "/exit": {
    description: "Exit the REPL",
    handler: async (state, _args, context) => {
      context.output("\nGoodbye!");
      await state.flushHistory();
      getPlatform().process.exit(0);
    },
  },

  "/config": {
    description: "View/set configuration",
    handler: async (_state, args) => {
      await handleConfigCommand(args);
    },
  },

  "/model": {
    description: "Show or set current model",
    handler: async (_state, args, context) => {
      const modelArg = args.trim();
      const configApi = (globalThis as Record<string, unknown>).config as
        | {
          snapshot?: { model?: unknown };
          set?: (key: string, value: unknown) => Promise<unknown>;
          patch?: (
            updates: Partial<Record<string, unknown>>,
          ) => Promise<unknown>;
        }
        | undefined;

      if (!configApi) {
        context.output(`${YELLOW}Configuration API not initialized.${RESET}`);
        return;
      }

      if (!modelArg) {
        const current = typeof configApi.snapshot?.model === "string"
          ? configApi.snapshot.model
          : "not configured";
        context.output(`${BOLD}Current model:${RESET} ${current}`);
        context.output(
          `${DIM_GRAY}Tip: /model opens the picker; /model <provider/model> sets it.${RESET}`,
        );
        return;
      }

      if (!normalizeModelId(modelArg)) {
        context.output(
          `${YELLOW}Invalid model ID.${RESET} Use format ${CYAN}provider/model${RESET}.`,
        );
        return;
      }

      if (!configApi.set && !configApi.patch) {
        context.output(
          `${YELLOW}Config setter unavailable in this context.${RESET}`,
        );
        return;
      }

      const normalized = await persistSelectedModelConfig(configApi, modelArg);
      context.output(`${GREEN}Default model set to ${normalized}.${RESET}`);
    },
  },

  "/tasks": {
    description: "List background tasks",
    handler: (_state, _args, context) => {
      const tm = getTaskManager();
      const tasks = Array.from(tm.getTasks().values());
      if (tasks.length === 0) {
        context.output("No background tasks.");
        return;
      }
      const now = Date.now();
      for (const task of tasks) {
        const active = isTaskActive(task);
        const icon = active
          ? STATUS_GLYPHS.running
          : task.status === "completed"
          ? STATUS_GLYPHS.success
          : task.status === "failed"
          ? STATUS_GLYPHS.error
          : STATUS_GLYPHS.cancelled;
        const elapsed = task.startedAt
          ? formatElapsed((task.completedAt ?? now) - task.startedAt)
          : "";
        const timeSuffix = active
          ? elapsed ? `(${elapsed})` : ""
          : elapsed
          ? `(${elapsed} ago)`
          : "";

        if (isModelPullTask(task)) {
          const pct = task.progress.total && task.progress.completed
            ? Math.round((task.progress.completed / task.progress.total) * 100)
            : 0;
          const bar = active
            ? `${formatProgressBar(pct)} ${pct}%`
            : task.status;
          context.output(
            `  ${icon}  Pulling ${task.modelName.padEnd(20)} ${
              bar.padEnd(16)
            } ${timeSuffix}`,
          );
        } else if (isEvalTask(task)) {
          const preview = task.preview.padEnd(24);
          const detail = task.status === "completed"
            ? `\u2192 ${String(task.result ?? "").slice(0, 30)}`
            : task.status === "failed"
            ? `Error: ${task.error?.message?.slice(0, 25) ?? "unknown"}`
            : task.progress.status;
          context.output(
            `  ${icon}  ${preview} ${detail.padEnd(20)} ${timeSuffix}`,
          );
        } else if (isDelegateTask(task)) {
          const label = `${task.nickname} (${task.agent}): ${
            task.task.slice(0, 20)
          }`;
          context.output(
            `  ${icon}  ${label.padEnd(36)} ${
              task.status.padEnd(12)
            } ${timeSuffix}`,
          );
        } else {
          context.output(`  ${icon}  ${task.label}  (${task.status})`);
        }
      }
      if (tm.getActiveCount() > 0) {
        context.output(`\n  ${DIM_GRAY}Ctrl+F cancels all${RESET}`);
      }
    },
  },
  "/mcp": {
    description: "List configured MCP servers",
    handler: async (_state, _args, context) => {
      const servers = await listRuntimeMcpServers();
      if (servers.length === 0) {
        context.output(
          `${YELLOW}No MCP servers configured.${RESET} Use ${CYAN}hlvm mcp add${RESET} to add one.`,
        );
        return;
      }
      context.output(`${BOLD}MCP Servers:${RESET}`);
      for (const server of servers) {
        context.output(
          `  ${CYAN}${server.name.padEnd(20)}${RESET} ${
            server.transport.padEnd(6)
          } ${server.target}  ${DIM_GRAY}(${server.scopeLabel})${RESET}`,
        );
      }
    },
  },

  "/doctor": {
    description: "Health check: MCP servers",
    handler: async (_state, _args, context) => {
      const ok = `${GREEN}ok${RESET}`;
      const fail = `${YELLOW}!!${RESET}`;

      context.output(`${BOLD}HLVM Doctor${RESET}`);
      context.output("");

      // MCP servers
      context.output(`${BOLD}MCP Servers${RESET}`);
      try {
        const servers = await listRuntimeMcpServers();
        if (servers.length === 0) {
          context.output(`  ${DIM_GRAY}none configured${RESET}`);
        } else {
          for (const s of servers) {
            context.output(`  ${ok} ${s.name} (${s.scopeLabel})`);
          }
        }
      } catch (err: unknown) {
        context.output(
          `${fail} Could not list MCP servers: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    },
  },

  "/skills": {
    description: "List available skills",
    handler: async (_state, _args, context) => {
      try {
        const { loadSkillCatalog, resetSkillCatalogCache } = await import(
          "../../skills/mod.ts"
        );
        resetSkillCatalogCache();
        const workspace = getPlatform().process.cwd();
        const catalog = await loadSkillCatalog(workspace);

        context.output(`${BOLD}HLVM Skills${RESET}`);
        context.output("");

        if (catalog.size === 0) {
          context.output(
            `  ${DIM_GRAY}No skills found.${RESET}`,
          );
          context.output(
            `  Create skills at ${CYAN}~/.hlvm/skills/<name>/SKILL.md${RESET}`,
          );
          return;
        }

        const groups: Record<string, { name: string; desc: string }[]> = {
          bundled: [],
          user: [],
          project: [],
        };
        for (const [name, skill] of catalog) {
          if (!skill.frontmatter.user_invocable) continue;
          groups[skill.source].push({
            name,
            desc: formatSkillDescription(skill),
          });
        }

        const sections: [string, string, string][] = [
          ["bundled", "Bundled", ""],
          [
            "user",
            "User",
            ` ${DIM_GRAY}(~/.hlvm/skills/, ~/.hlvm/commands/)${RESET}`,
          ],
          [
            "project",
            "Project",
            ` ${DIM_GRAY}(.hlvm/skills/, .hlvm/commands/)${RESET}`,
          ],
        ];
        for (const [key, label, hint] of sections) {
          const entries = groups[key];
          if (!entries.length) continue;
          context.output(`  ${BOLD}${label}${RESET}${hint}`);
          for (const e of entries) {
            context.output(
              `    ${CYAN}/${e.name}${RESET}  ${e.desc}`,
            );
          }
          context.output("");
        }

        context.output(
          `  ${DIM_GRAY}Type /<name> to invoke. Create at ~/.hlvm/skills/<name>/SKILL.md${RESET}`,
        );
      } catch (err: unknown) {
        context.output(
          `${YELLOW}Could not load skills: ${
            err instanceof Error ? err.message : String(err)
          }${RESET}`,
        );
      }
    },
  },

  "/hooks": {
    description: "List active hooks",
    handler: async (_state, _args, context) => {
      const { loadConfig } = await import("../../../common/config/storage.ts");
      const { getHooksConfigPath } = await import("../../agent/hooks.ts");
      const platform = getPlatform();
      const workspace = platform.process.cwd();

      context.output(`${BOLD}HLVM Hooks${RESET}`);
      context.output("");

      // Helper to display hooks from a parsed config
      function displayHooks(
        hooksObj: Record<string, unknown[]> | undefined,
        sourceLabel: string,
      ): boolean {
        if (!hooksObj) return false;
        let found = false;
        for (const [event, handlers] of Object.entries(hooksObj)) {
          if (!Array.isArray(handlers) || handlers.length === 0) continue;
          found = true;
          context.output(
            `  ${CYAN}${event}${RESET}  ${GREEN}${handlers.length} handler${handlers.length > 1 ? "s" : ""}${RESET}  ${DIM_GRAY}(${sourceLabel})${RESET}`,
          );
          for (const h of handlers) {
            if (typeof h !== "object" || h === null) continue;
            const handler = h as Record<string, unknown>;
            const type = typeof handler.type === "string" ? handler.type : "command";
            if (type === "command" && Array.isArray(handler.command)) {
              context.output(
                `    ${DIM_GRAY}command${RESET}  ${handler.command.join(" ")}`,
              );
            } else if (type === "prompt" && typeof handler.prompt === "string") {
              const preview = handler.prompt.length > 50
                ? handler.prompt.slice(0, 50) + "..."
                : handler.prompt;
              context.output(`    ${DIM_GRAY}prompt${RESET}   "${preview}"`);
            } else if (type === "http" && typeof handler.url === "string") {
              context.output(`    ${DIM_GRAY}http${RESET}     ${handler.url}`);
            }
          }
        }
        return found;
      }

      // 1. Global hooks from settings.json (config.hooks is flat: { event: handlers[] })
      let globalFound = false;
      try {
        const cfg = await loadConfig();
        if (cfg.hooks && typeof cfg.hooks === "object") {
          globalFound = displayHooks(
            cfg.hooks as Record<string, unknown[]>,
            "settings.json",
          );
        }
      } catch {
        // settings.json not available or invalid — skip
      }

      // 2. Workspace hooks from .hlvm/hooks.json (overrides)
      let workspaceFound = false;
      const hooksPath = getHooksConfigPath(workspace);
      try {
        const raw = await platform.fs.readTextFile(hooksPath);
        const parsed = JSON.parse(raw) as {
          version?: number;
          hooks?: Record<string, unknown[]>;
        };
        if (parsed.version === 1 && parsed.hooks) {
          workspaceFound = displayHooks(parsed.hooks, ".hlvm/hooks.json");
        }
      } catch {
        // No workspace hooks — skip
      }

      if (!globalFound && !workspaceFound) {
        context.output(`  ${DIM_GRAY}No hooks configured.${RESET}`);
        context.output(
          `  Add hooks to ${CYAN}~/.hlvm/settings.json${RESET} (global) or ${CYAN}.hlvm/hooks.json${RESET} (workspace).`,
        );
        context.output("");
        context.output(`  ${DIM_GRAY}Example (settings.json):${RESET}`);
        context.output(`  ${DIM_GRAY}{${RESET}`);
        context.output(`  ${DIM_GRAY}  "hooks": {${RESET}`);
        context.output(
          `  ${DIM_GRAY}    "pre_tool": [{ "command": ["lint.sh"] }]${RESET}`,
        );
        context.output(`  ${DIM_GRAY}  }${RESET}`);
        context.output(`  ${DIM_GRAY}}${RESET}`);
      }
    },
  },

  "/init": {
    description: "Scaffold skill/rules directories and templates",
    handler: async (_state, _args, context) => {
      const { getSkillsDir, getRulesDir, getCustomInstructionsPath } = await import(
        "../../../common/paths.ts"
      );
      const platform = getPlatform();
      const skillsDir = getSkillsDir();
      const rulesDir = getRulesDir();
      const hlvmMd = getCustomInstructionsPath();

      context.output(`${BOLD}HLVM Init${RESET}`);
      context.output("");

      // Create directories
      for (const [dir, label] of [
        [skillsDir, "~/.hlvm/skills/"],
        [rulesDir, "~/.hlvm/rules/"],
      ] as const) {
        try {
          if (await platform.fs.exists(dir)) {
            context.output(`  ${DIM_GRAY}exists${RESET}   ${label}`);
          } else {
            await platform.fs.mkdir(dir, { recursive: true });
            context.output(`  ${GREEN}created${RESET}  ${label}`);
          }
        } catch {
          context.output(`  ${YELLOW}failed${RESET}   ${label}`);
        }
      }

      // Check HLVM.md
      try {
        if (await platform.fs.exists(hlvmMd)) {
          context.output(`  ${DIM_GRAY}exists${RESET}   ~/.hlvm/HLVM.md`);
        } else {
          await platform.fs.writeTextFile(
            hlvmMd,
            "# HLVM Global Instructions\n\n# Add your global rules here.\n",
          );
          context.output(`  ${GREEN}created${RESET}  ~/.hlvm/HLVM.md`);
        }
      } catch {
        context.output(`  ${YELLOW}failed${RESET}   ~/.hlvm/HLVM.md`);
      }

      context.output("");
      context.output(`${BOLD}Skill Template:${RESET}`);
      context.output("");
      context.output(`  ${DIM_GRAY}Path: ~/.hlvm/skills/my-skill/SKILL.md${RESET}`);
      context.output("");
      context.output(`  ${DIM_GRAY}---${RESET}`);
      context.output(
        `  ${DIM_GRAY}description: "What this skill does"${RESET}`,
      );
      context.output(
        `  ${DIM_GRAY}argument-hint: "[target]"${RESET}`,
      );
      context.output(
        `  ${DIM_GRAY}allowed-tools: Bash Read${RESET}`,
      );
      context.output(`  ${DIM_GRAY}context: inline${RESET}`);
      context.output(`  ${DIM_GRAY}---${RESET}`);
      context.output(
        `  ${DIM_GRAY}Your skill instructions here.${RESET}`,
      );
      context.output(
        `  ${DIM_GRAY}Use $ARGUMENTS, $0, $1, etc. for arguments.${RESET}`,
      );

      context.output("");
      context.output(`${BOLD}Next Steps:${RESET}`);
      context.output(
        `  1. Create a skill: ${CYAN}~/.hlvm/skills/my-skill/SKILL.md${RESET}`,
      );
      context.output(
        `  2. Add a rule: ${CYAN}~/.hlvm/rules/naming.md${RESET}`,
      );
      context.output(
        `  3. Set up hooks: ${CYAN}~/.hlvm/settings.json${RESET} (global) or ${CYAN}.hlvm/hooks.json${RESET} (workspace)`,
      );
      context.output(
        `  4. Type ${CYAN}/skills${RESET} to see available skills`,
      );
    },
  },
};

/** Unified catalog of all slash commands (derived from `commands` + App-handled commands). */
export const COMMAND_CATALOG: readonly { name: string; description: string }[] =
  [
    ...Object.entries(commands).map(([name, cmd]) => ({
      name,
      description: cmd.description,
    })),
    ...APP_HANDLED_COMMANDS,
  ];

/** Extended catalog including dynamically loaded skills. */
export async function getFullCommandCatalog(
  workspace?: string,
): Promise<readonly { name: string; description: string }[]> {
  try {
    const { loadSkillCatalog } = await import("../../skills/mod.ts");
    const catalog = await loadSkillCatalog(workspace);
    const skillEntries = [...catalog.values()]
      .filter((s) => s.frontmatter.user_invocable)
      .map((s) => ({
        name: `/${s.name}`,
        description: formatSkillDescription(s),
      }));
    return [...COMMAND_CATALOG, ...skillEntries];
  } catch {
    return COMMAND_CATALOG;
  }
}

/** Check if input is a slash command */
export function isCommand(input: string): boolean {
  const trimmed = input.trim();
  return trimmed.startsWith("/");
}

/** Result from running a command — includes optional skill activation. */
export interface RunCommandResult {
  handled: boolean;
  /** If set, the REPL should submit this as an agent query with the system message prepended. */
  skillActivation?: { systemMessage: string; allowedTools?: string[] };
}

/** Run a command. Returns result indicating if a skill was activated. */
export async function runCommand(
  input: string,
  state: ReplState,
  options?: RunCommandOptions,
): Promise<RunCommandResult> {
  const output = createOutputWriter(options);
  const trimmed = input.trim();
  const [cmdName, ...args] = trimmed.split(WHITESPACE_SPLIT_REGEX);

  // 1. Try static commands first
  const command = commands[cmdName];
  if (command) {
    await command.handler(state, args.join(" "), { output });
    return { handled: true };
  }

  // 2. Try skill catalog
  try {
    const { loadSkillCatalog } = await import("../../skills/mod.ts");
    const { executeInlineSkill, renderSkillBody } = await import(
      "../../skills/executor.ts"
    );
    const workspace = getPlatform().process.cwd();
    const catalog = await loadSkillCatalog(workspace);
    const skillName = cmdName.slice(1); // strip leading "/"
    const skill = catalog.get(skillName);
    if (skill && skill.frontmatter.user_invocable) {
      if (skill.frontmatter.context === "fork") {
        return {
          handled: true,
          skillActivation: {
            systemMessage: buildDelegatedSkillMessage(
              skill,
              renderSkillBody(skill, args.join(" ")),
              "user",
            ),
            allowedTools: skill.frontmatter.allowed_tools,
          },
        };
      }
      const result = executeInlineSkill(skill, args.join(" "));
      output(`Activating skill: ${skill.frontmatter.description}`);
      return { handled: true, skillActivation: result };
    }
  } catch (err: unknown) {
    output(
      `${YELLOW}Skill loading failed: ${
        err instanceof Error ? err.message : String(err)
      }${RESET}`,
    );
    return { handled: true };
  }

  output(`${YELLOW}Unknown command: ${cmdName}${RESET}`);
  output(`${DIM_GRAY}Type /help for available commands.${RESET}`);
  return { handled: false };
}
