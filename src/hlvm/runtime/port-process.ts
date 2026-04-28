import { getPlatform } from "../../platform/platform.ts";

const textDecoder = new TextDecoder();
const PROCESS_EXIT_POLL_ATTEMPTS = 8;
const PROCESS_EXIT_POLL_DELAY_MS = 100;

function normalizeCommandOutput(output: {
  stdout: Uint8Array;
  stderr: Uint8Array;
}): string {
  const stdout = textDecoder.decode(output.stdout).trim();
  const stderr = textDecoder.decode(output.stderr).trim();
  return [stdout, stderr].filter(Boolean).join("\n");
}

export async function findListeningPidForPort(
  port: number,
): Promise<string | null> {
  const platform = getPlatform();

  try {
    if (platform.build.os === "windows") {
      const output = await platform.command.output({
        cmd: [
          "cmd",
          "/c",
          `netstat -ano -p tcp | findstr LISTENING | findstr :${port}`,
        ],
        stdin: "null",
        stdout: "piped",
        stderr: "piped",
      });
      const text = normalizeCommandOutput(output);
      const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
      const pid = lines.at(0)?.split(/\s+/).at(-1);
      return pid && /^\d+$/.test(pid) ? pid : null;
    }

    const output = await platform.command.output({
      cmd: [
        "lsof",
        "-nP",
        `-iTCP:${port}`,
        "-sTCP:LISTEN",
        "-t",
      ],
      stdin: "null",
      stdout: "piped",
      stderr: "piped",
    });
    const pid = normalizeCommandOutput(output).split("\n")[0]?.trim();
    return pid && /^\d+$/.test(pid) ? pid : null;
  } catch {
    return null;
  }
}

export async function terminateProcess(pid: string): Promise<boolean> {
  const platform = getPlatform();

  try {
    if (platform.build.os === "windows") {
      await platform.command.output({
        cmd: ["taskkill", "/PID", pid, "/T", "/F"],
        stdin: "null",
        stdout: "piped",
        stderr: "piped",
      });
      return true;
    }

    await platform.command.output({
      cmd: ["kill", "-TERM", pid],
      stdin: "null",
      stdout: "piped",
      stderr: "piped",
    });

    if (await waitForProcessExit(pid)) {
      return true;
    }

    await platform.command.output({
      cmd: ["kill", "-KILL", pid],
      stdin: "null",
      stdout: "piped",
      stderr: "piped",
    });
    return await waitForProcessExit(pid);
  } catch {
    return false;
  }
}

async function waitForProcessExit(pid: string): Promise<boolean> {
  for (let i = 0; i < PROCESS_EXIT_POLL_ATTEMPTS; i++) {
    if (!await isProcessAlive(pid)) {
      return true;
    }
    await new Promise((resolve) =>
      setTimeout(resolve, PROCESS_EXIT_POLL_DELAY_MS)
    );
  }
  return !await isProcessAlive(pid);
}

async function isProcessAlive(pid: string): Promise<boolean> {
  const platform = getPlatform();

  try {
    if (platform.build.os === "windows") {
      const output = await platform.command.output({
        cmd: [
          "cmd",
          "/c",
          `tasklist /FI "PID eq ${pid}" /FO CSV /NH`,
        ],
        stdin: "null",
        stdout: "piped",
        stderr: "piped",
      });
      const text = normalizeCommandOutput(output);
      return text.length > 0 && !text.includes("No tasks are running");
    } else {
      await platform.command.output({
        cmd: ["ps", "-p", pid, "-o", "pid="],
        stdin: "null",
        stdout: "piped",
        stderr: "piped",
      });
      return true;
    }
  } catch {
    return false;
  }
}

export interface ProcessListing {
  pid: string;
  command: string;
}

export async function listProcesses(): Promise<ProcessListing[]> {
  const platform = getPlatform();

  try {
    if (platform.build.os === "windows") {
      return [];
    }

    const output = await platform.command.output({
      cmd: ["ps", "-axo", "pid=,command="],
      stdin: "null",
      stdout: "piped",
      stderr: "piped",
    });
    return normalizeCommandOutput(output)
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const match = line.match(/^(\d+)\s+(.*)$/);
        if (!match) return null;
        return { pid: match[1], command: match[2] };
      })
      .filter((entry): entry is ProcessListing => entry !== null);
  } catch {
    return [];
  }
}

export async function getProcessCommand(pid: string): Promise<string | null> {
  const platform = getPlatform();

  try {
    if (platform.build.os === "windows") {
      const output = await platform.command.output({
        cmd: [
          "cmd",
          "/c",
          `wmic process where ProcessId=${pid} get CommandLine /value`,
        ],
        stdin: "null",
        stdout: "piped",
        stderr: "piped",
      });
      const text = normalizeCommandOutput(output);
      const line = text.split("\n").find((entry) =>
        entry.trim().startsWith("CommandLine=")
      );
      const command = line?.split("=").slice(1).join("=").trim();
      return command ? command : null;
    }

    const output = await platform.command.output({
      cmd: ["ps", "-p", pid, "-o", "command="],
      stdin: "null",
      stdout: "piped",
      stderr: "piped",
    });
    const command = normalizeCommandOutput(output).split("\n")[0]?.trim();
    return command ? command : null;
  } catch {
    return null;
  }
}
