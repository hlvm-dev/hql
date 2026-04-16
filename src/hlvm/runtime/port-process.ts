import { getPlatform } from "../../platform/platform.ts";

const textDecoder = new TextDecoder();

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
    } else {
      await platform.command.output({
        cmd: ["kill", "-TERM", pid],
        stdin: "null",
        stdout: "piped",
        stderr: "piped",
      });
    }
    return true;
  } catch {
    return false;
  }
}
