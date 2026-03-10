import { getPlatform } from "../../../../platform/platform.ts";
import { aiEngine } from "../../../runtime/ai-runtime.ts";
import type { RuntimeOllamaSigninResponse } from "../../../runtime/provider-protocol.ts";
import { jsonError, parseJsonBody } from "../http-utils.ts";
import { getErrorMessage } from "../../../../common/utils.ts";

const OLLAMA_SIGNIN_URL_PATTERN = /https:\/\/ollama\.com\/connect\?[^\s"'`]+/i;

function decodeOutput(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes).trim();
}

function extractOllamaSigninUrl(output: string): string | null {
  const match = output.match(OLLAMA_SIGNIN_URL_PATTERN);
  return match ? match[0] : null;
}

function toOutputLines(output: string): string[] {
  return output
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export async function handleOllamaSignin(req: Request): Promise<Response> {
  const parsed = await parseJsonBody<{ openBrowser?: boolean }>(req);
  if (!parsed.ok) return parsed.response;

  const openBrowser = parsed.value.openBrowser !== false;
  const platform = getPlatform();

  try {
    const enginePath = await aiEngine.getEnginePath();
    const result = await platform.command.output({
      cmd: [enginePath, "signin"],
      stdin: "null",
      stdout: "piped",
      stderr: "piped",
    });

    const stdout = decodeOutput(result.stdout);
    const stderr = decodeOutput(result.stderr);
    const combined = [stdout, stderr].filter(Boolean).join("\n");
    const signinUrl = extractOllamaSigninUrl(combined);
    const output = combined ? toOutputLines(combined) : [];
    let browserOpened = false;

    if (openBrowser && signinUrl) {
      try {
        await platform.openUrl(signinUrl);
        browserOpened = true;
        output.push("Opened browser for Ollama sign-in.");
      } catch (error) {
        const message = getErrorMessage(error);
        output.push(`Could not open browser automatically: ${message}`);
      }
    }

    const payload: RuntimeOllamaSigninResponse = {
      success: result.success,
      output,
      signinUrl,
      browserOpened,
    };
    return Response.json(payload);
  } catch (error) {
    return jsonError(
      error instanceof Error ? error.message : "Ollama sign-in failed",
      500,
    );
  }
}
