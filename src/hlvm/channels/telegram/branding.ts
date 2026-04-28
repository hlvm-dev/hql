import { decodeBase64 } from "@std/encoding/base64";
import { http } from "../../../common/http-client.ts";
import { getErrorMessage } from "../../../common/utils.ts";
import { TELEGRAM_PROFILE_PHOTO_JPEG_BASE64 } from "./branding-asset.ts";

const TELEGRAM_API_BASE_URL = "https://api.telegram.org";
const TELEGRAM_BRANDING_DESCRIPTION =
  "HLVM is your AI assistant for everyday questions, coding, and getting things done.";
const TELEGRAM_BRANDING_SHORT_DESCRIPTION =
  "Your AI assistant for chat and coding.";
const TELEGRAM_PROFILE_PHOTO_ATTACH_NAME = "profile_photo";
const TELEGRAM_PROFILE_PHOTO_FILENAME = "hlvm-profile.jpg";
const TELEGRAM_PROFILE_PHOTO_BYTES = decodeBase64(
  TELEGRAM_PROFILE_PHOTO_JPEG_BASE64,
);

interface TelegramApiResponse<T> {
  ok?: boolean;
  result?: T;
  description?: string;
}

class TelegramBrandingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TelegramBrandingError";
  }
}

interface TelegramBrandingDependencies {
  fetchRaw?: typeof http.fetchRaw;
}

function trimToken(value: string): string {
  return value.trim();
}

function isLikelyTelegramBotToken(value: string): boolean {
  return /^\d+:[A-Za-z0-9_-]{20,}$/.test(value);
}

async function parseTelegramResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  let body: TelegramApiResponse<T> | null = null;
  if (text.trim()) {
    try {
      body = JSON.parse(text) as TelegramApiResponse<T>;
    } catch {
      body = null;
    }
  }

  if (!response.ok) {
    const description = typeof body?.description === "string"
      ? body.description.trim()
      : "";
    throw new TelegramBrandingError(
      description ||
        `Telegram API HTTP ${response.status}: ${response.statusText}`,
    );
  }

  if (!body || body.ok !== true) {
    throw new TelegramBrandingError(
      (typeof body?.description === "string" && body.description.trim()) ||
        "Telegram branding request failed",
    );
  }

  return body.result as T;
}

async function postTelegramJson(
  fetchRaw: typeof http.fetchRaw,
  token: string,
  method: string,
  body: Record<string, unknown>,
): Promise<void> {
  const response = await fetchRaw(
    `${TELEGRAM_API_BASE_URL}/bot${token}/${method}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  await parseTelegramResponse<boolean>(response);
}

async function postTelegramMultipart(
  fetchRaw: typeof http.fetchRaw,
  token: string,
  method: string,
  form: FormData,
): Promise<void> {
  const response = await fetchRaw(
    `${TELEGRAM_API_BASE_URL}/bot${token}/${method}`,
    {
      method: "POST",
      body: form,
    },
  );
  await parseTelegramResponse<boolean>(response);
}

async function setTelegramProfilePhoto(
  fetchRaw: typeof http.fetchRaw,
  token: string,
): Promise<void> {
  const form = new FormData();
  form.set(
    "photo",
    JSON.stringify({
      type: "static",
      photo: `attach://${TELEGRAM_PROFILE_PHOTO_ATTACH_NAME}`,
    }),
  );
  form.set(
    TELEGRAM_PROFILE_PHOTO_ATTACH_NAME,
    new Blob([TELEGRAM_PROFILE_PHOTO_BYTES], { type: "image/jpeg" }),
    TELEGRAM_PROFILE_PHOTO_FILENAME,
  );
  await postTelegramMultipart(fetchRaw, token, "setMyProfilePhoto", form);
}

export async function applyTelegramBotBranding(
  token: string,
  dependencies: TelegramBrandingDependencies = {},
): Promise<void> {
  const trimmedToken = trimToken(token);
  if (!isLikelyTelegramBotToken(trimmedToken)) return;

  const fetchRaw = dependencies.fetchRaw ?? http.fetchRaw.bind(http);
  const results = await Promise.allSettled([
    setTelegramProfilePhoto(fetchRaw, trimmedToken),
    postTelegramJson(fetchRaw, trimmedToken, "setMyDescription", {
      description: TELEGRAM_BRANDING_DESCRIPTION,
    }),
    postTelegramJson(fetchRaw, trimmedToken, "setMyShortDescription", {
      short_description: TELEGRAM_BRANDING_SHORT_DESCRIPTION,
    }),
  ]);

  const failures = results.flatMap((result) =>
    result.status === "rejected" ? [getErrorMessage(result.reason)] : []
  );
  if (failures.length === 0) return;

  throw new TelegramBrandingError(
    `Failed to apply Telegram bot branding: ${failures.join("; ")}`,
  );
}
