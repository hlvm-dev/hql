import { encodeBase64 } from "@std/encoding/base64";
import { truncate } from "../../../common/utils.ts";
import type { ToolFailureMetadata } from "../tool-results.ts";
import { getExistingPage } from "./browser-manager.ts";
import {
  hasStructuredPlaywrightVisualFailure,
  PLAYWRIGHT_VISUAL_LAYOUT_KEYWORDS,
} from "./failure-enrichment.ts";

const DIAGNOSTIC_TIMEOUT_MS = 3_000;
const MAX_DIAGNOSTIC_TEXT_CHARS = 4_000;

export interface PlaywrightFailureDiagnostics {
  diagnosticText?: string;
  imageAttachment?: {
    data: string;
    mimeType: string;
    width?: number;
    height?: number;
  };
}

/** Sync fast-path: keyword match → definite true. No match → uncertain. */
function hasVisualKeywordHit(
  errorText: string,
  failure?: ToolFailureMetadata,
): boolean {
  const lowerError = errorText.toLowerCase();
  if (
    PLAYWRIGHT_VISUAL_LAYOUT_KEYWORDS.some((keyword) =>
      lowerError.includes(keyword)
    )
  ) {
    return true;
  }
  const facts = failure?.facts;
  if (!facts) return false;
  return Object.values(facts).some((value) =>
    typeof value === "string" &&
    PLAYWRIGHT_VISUAL_LAYOUT_KEYWORDS.some((keyword) =>
      value.toLowerCase().includes(keyword)
    )
  );
}

/**
 * Classify whether a Playwright error is a visual/layout issue.
 * Uses keyword fast-path for definite hits, LLM for uncertain cases.
 */
export async function hasPlaywrightVisualLayoutIssue(
  errorText: string,
  failure?: ToolFailureMetadata,
): Promise<boolean> {
  if (failure?.code === "pw_download_navigated") return false;
  if (hasStructuredPlaywrightVisualFailure(failure)) return true;
  if (hasVisualKeywordHit(errorText, failure)) return true;
  if (!errorText.trim()) return false;
  try {
    const { classifyPlaywrightVisualIssue } = await import(
      "../../runtime/local-llm.ts"
    );
    const result = await classifyPlaywrightVisualIssue(errorText);
    return result.isVisualLayoutIssue;
  } catch {
    return false;
  }
}

async function captureAccessibilitySnapshot(
  sessionId?: string,
): Promise<string | undefined> {
  const page = getExistingPage(sessionId);
  if (!page) return undefined;
  const snapshot = await page.locator("body").ariaSnapshot({
    timeout: DIAGNOSTIC_TIMEOUT_MS,
  });
  return `Accessibility snapshot:\n${
    truncate(snapshot, MAX_DIAGNOSTIC_TEXT_CHARS)
  }`;
}

async function captureViewportScreenshot(
  sessionId?: string,
): Promise<PlaywrightFailureDiagnostics["imageAttachment"] | undefined> {
  const page = getExistingPage(sessionId);
  if (!page) return undefined;
  const bytes = new Uint8Array(await page.screenshot({ type: "png" }));
  const viewport = page.viewportSize() ?? { width: 1280, height: 720 };
  return {
    data: encodeBase64(bytes),
    mimeType: "image/png",
    width: viewport.width,
    height: viewport.height,
  };
}

export async function capturePlaywrightFailureDiagnostics(options: {
  errorText: string;
  failure?: ToolFailureMetadata;
  sessionId?: string;
}): Promise<PlaywrightFailureDiagnostics | null> {
  if (options.failure?.code === "pw_download_navigated") {
    return null;
  }

  try {
    if (
      await hasPlaywrightVisualLayoutIssue(options.errorText, options.failure)
    ) {
      const imageAttachment = await captureViewportScreenshot(
        options.sessionId,
      );
      return imageAttachment ? { imageAttachment } : null;
    }

    if (
      options.failure?.kind === "timeout" ||
      options.failure?.kind === "not_found"
    ) {
      const diagnosticText = await captureAccessibilitySnapshot(
        options.sessionId,
      );
      return diagnosticText ? { diagnosticText } : null;
    }
  } catch {
    // Best-effort only. Keep the original failure untouched.
  }

  return null;
}
