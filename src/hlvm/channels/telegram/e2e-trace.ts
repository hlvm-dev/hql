import { getDebugLogPath } from "../../../common/paths.ts";
import { getPlatform } from "../../../platform/platform.ts";
import { log } from "../../api/log.ts";

const TELEGRAM_E2E_LOG_PATH = "/tmp/hlvm-telegram-e2e.log";

export function logTelegramE2ETrace(
  component: string,
  event: string,
  data: Record<string, unknown>,
): void {
  const line =
    `[${new Date().toISOString()}] [telegram-e2e] [${component}] ${event} ${JSON.stringify(data)}\n`;
  try {
    getPlatform().fs.writeTextFileSync(TELEGRAM_E2E_LOG_PATH, line, { append: true });
  } catch {
    // Ignore trace write failures.
  }
  try {
    getPlatform().fs.writeTextFileSync(getDebugLogPath(), line, { append: true });
  } catch {
    // Ignore trace write failures.
  }
  log.raw.log(line.trimEnd());
}

export function getTelegramE2ELogPath(): string {
  return TELEGRAM_E2E_LOG_PATH;
}
