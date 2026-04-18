import { getPlatform } from "../../../platform/platform.ts";

export interface EnvInfoOptions {
  cwd?: string;
  additionalWorkingDirectories?: string[];
}

export async function computeEnvInfo(
  modelId: string,
  options: EnvInfoOptions = {},
): Promise<string> {
  const platform = getPlatform();
  const effectiveCwd = options.cwd ?? platform.process.cwd();
  const [isGit, unameSR] = await Promise.all([
    getIsGit(platform, effectiveCwd),
    getUnameSR(platform),
  ]);
  const additionalDirsInfo =
    options.additionalWorkingDirectories &&
      options.additionalWorkingDirectories.length > 0
      ? `Additional working directories: ${options.additionalWorkingDirectories.join(", ")}\n`
      : "";

  const cutoff = getKnowledgeCutoff(modelId);
  const knowledgeCutoffMessage = cutoff
    ? `\n\nAssistant knowledge cutoff is ${cutoff}.`
    : "";

  const modelDescription = `You are powered by the model ${modelId}.`;

  return `Here is useful information about the environment you are running in:
<env>
Working directory: ${effectiveCwd}
Is directory a git repo: ${isGit ? "Yes" : "No"}
${additionalDirsInfo}Platform: ${platform.build.os}
${getShellInfoLine(platform)}
OS Version: ${unameSR}
</env>
${modelDescription}${knowledgeCutoffMessage}`;
}

export interface EnhanceEnvOptions {
  cwd?: string;
  additionalWorkingDirectories?: string[];
  enabledToolNames?: ReadonlySet<string>;
}

export async function enhanceSystemPromptWithEnvDetails(
  existingSystemPrompt: string[],
  model: string,
  options: EnhanceEnvOptions = {},
): Promise<string[]> {
  const notes = `Notes:
- Agent threads always have their cwd reset between bash calls, as a result please only use absolute file paths.
- In your final response, share file paths (always absolute, never relative) that are relevant to the task. Include code snippets only when the exact text is load-bearing (e.g., a bug you found, a function signature the caller asked for) — do not recap code you merely read.
- For clear communication with the user the assistant MUST avoid using emojis.
- Do not use a colon before tool calls. Text like "Let me read the file:" followed by a read tool call should just be "Let me read the file." with a period.`;
  const envInfo = await computeEnvInfo(model, {
    cwd: options.cwd,
    additionalWorkingDirectories: options.additionalWorkingDirectories,
  });
  return [
    ...existingSystemPrompt,
    notes,
    envInfo,
  ];
}

type PlatformHandle = ReturnType<typeof getPlatform>;

async function getIsGit(
  platform: PlatformHandle,
  cwd?: string,
): Promise<boolean> {
  try {
    const result = await platform.command.output({
      cmd: ["git", "rev-parse", "--is-inside-work-tree"],
      cwd,
      stdout: "null",
      stderr: "null",
    });
    return result.success;
  } catch {
    return false;
  }
}

async function getUnameSR(platform: PlatformHandle): Promise<string> {
  if (platform.build.os === "windows") {
    return `Windows`;
  }
  try {
    const result = await platform.command.output({
      cmd: ["uname", "-sr"],
      stdout: "piped",
      stderr: "null",
    });
    return new TextDecoder().decode(result.stdout).trim();
  } catch {
    return `${platform.build.os}`;
  }
}

function getShellInfoLine(platform: PlatformHandle): string {
  const shell = platform.env.get("SHELL") ?? "unknown";
  const shellName = shell.includes("zsh")
    ? "zsh"
    : shell.includes("bash")
    ? "bash"
    : shell;
  if (platform.build.os === "windows") {
    return `Shell: ${shellName} (use Unix shell syntax, not Windows — e.g., /dev/null not NUL, forward slashes in paths)`;
  }
  return `Shell: ${shellName}`;
}

function getKnowledgeCutoff(modelId: string): string | null {
  const canonical = modelId.toLowerCase();
  if (canonical.includes("claude-sonnet-4-6")) return "August 2025";
  if (canonical.includes("claude-opus-4-6")) return "May 2025";
  if (canonical.includes("claude-opus-4-5")) return "May 2025";
  if (canonical.includes("claude-haiku-4")) return "February 2025";
  if (
    canonical.includes("claude-opus-4") || canonical.includes("claude-sonnet-4")
  ) return "January 2025";
  return null;
}
