import { RuntimeError } from "../../../common/error.ts";
import { ProviderErrorCode } from "../../../common/error-codes.ts";

export const CLAUDE_CODE_AUTH_MESSAGES = {
  TOKEN_NOT_FOUND:
    "Claude Code OAuth token not found. Run `claude login` first to authenticate with your Max subscription.",
  NO_REFRESH_TOKEN:
    "OAuth token expired and no refresh token available. Run `claude login` to re-authenticate.",
  NO_MODELS_AVAILABLE:
    "No Claude Code models available. Run `claude login` to authenticate.",
  MODEL_NOT_IN_SUBSCRIPTION:
    "Claude Code OAuth: this model is not available with your current subscription. " +
    "Try a different model (e.g. claude-haiku-4-5-20251001) or use a console API key.",
} as const;

export function refreshFailedMessage(status: number, body: string): string {
  const bodyPart = body ? `${body} ` : "";
  return `OAuth token refresh failed (${status}). ${bodyPart}Run \`claude login\` to re-authenticate.`;
}

export function tokenInvalid401Message(authDetail: string): string {
  const detailPart = authDetail.length > 0 ? `${authDetail} ` : "";
  return `Claude Code OAuth token invalid or expired (401). ${detailPart}Run \`claude login\` to re-authenticate.`;
}

export function forbidden403Message(authDetail: string): string {
  const detailPart = authDetail.length > 0 ? `${authDetail} ` : "";
  return `Claude Code request forbidden (403). ${detailPart}Your OAuth token is valid but your subscription or scopes do not grant access to this resource.`;
}

export function claudeCodeAuthError(message: string): RuntimeError {
  return new RuntimeError(message, { code: ProviderErrorCode.AUTH_FAILED });
}
