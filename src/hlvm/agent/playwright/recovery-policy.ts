import type { ToolFailureMetadata } from "../tool-results.ts";
import { hasStructuredPlaywrightVisualFailure } from "./failure-enrichment.ts";

export interface BrowserRecoveryDecision {
  stage:
    | "direct_pw_alternative"
    | "download_destination_follow"
    | "repeat_visual_pw_guidance"
    | "promote_hybrid"
    | "repeat_structural_pw_guidance";
  directive: string;
  temporarilyBlockTool?: string;
  promoteToHybrid: boolean;
  recommendedPwAlternative?: {
    toolName: "pw_goto" | "pw_download";
    target: string;
  };
}

export interface BrowserRecoveryInput {
  toolName: string;
  failure: ToolFailureMetadata;
  repeatCount: number;
  currentDomainProfileId?: string;
}

function candidateHref(failure: ToolFailureMetadata): string | undefined {
  const value = failure.facts?.candidateHref;
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function navigatedTo(failure: ToolFailureMetadata): string | undefined {
  const value = failure.facts?.navigatedTo;
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function canTemporarilyBlock(toolName: string): boolean {
  return toolName === "pw_click" || toolName === "pw_fill" ||
    toolName === "pw_download";
}

export function decideBrowserRecovery(
  input: BrowserRecoveryInput,
): BrowserRecoveryDecision | null {
  const directHref = input.toolName === "pw_click"
    ? candidateHref(input.failure)
    : undefined;
  if (directHref) {
    return {
      stage: "direct_pw_alternative",
      directive: [
        "Playwright found a deterministic PW-only recovery path.",
        `The blocked target resolves to ${directHref}. Use pw_goto with that URL instead of retrying the click.`,
        "Do not keep guessing alternative click selectors for the same target.",
        "If the destination page contains the final artifact link, extract it there and continue with pw_links, pw_content, or pw_download.",
      ].join("\n"),
      temporarilyBlockTool: "pw_click",
      promoteToHybrid: false,
      recommendedPwAlternative: {
        toolName: "pw_goto",
        target: directHref,
      },
    };
  }

  if (input.failure.code === "pw_download_navigated") {
    const destination = navigatedTo(input.failure);
    return {
      stage: "download_destination_follow",
      directive: [
        "Playwright found a deterministic PW-only recovery path for the download flow.",
        "The original trigger navigated instead of downloading.",
        destination
          ? `Inspect the destination page (${destination}), extract the real file href, and call pw_download with that direct URL.`
          : "Inspect the destination page, extract the real file href, and call pw_download with that direct URL.",
        "Do not retry the same selector-triggered download blindly.",
      ].join("\n"),
      temporarilyBlockTool: canTemporarilyBlock(input.toolName)
        ? input.toolName
        : "pw_download",
      promoteToHybrid: false,
      ...(destination
        ? {
          recommendedPwAlternative: {
            toolName: "pw_download" as const,
            target: destination,
          },
        }
        : {}),
    };
  }

  if (input.repeatCount < 2) {
    return null;
  }

  if (hasStructuredPlaywrightVisualFailure(input.failure)) {
    if (input.currentDomainProfileId === "browser_safe") {
      return {
        stage: "promote_hybrid",
        directive: [
          "Repeated Playwright failure: visibility or native blocker with no better PW-only recovery path.",
          "Hybrid browser mode is now available.",
          "If visible or native interaction is required, call pw_promote first, then use cu_* on the headed browser window.",
          "Do not switch to cu_* before pw_promote.",
        ].join("\n"),
        temporarilyBlockTool: canTemporarilyBlock(input.toolName)
          ? input.toolName
          : undefined,
        promoteToHybrid: true,
      };
    }
    return {
      stage: "repeat_visual_pw_guidance",
      directive: [
        "Repeated Playwright failure: visibility or native blocker.",
        "Hybrid browser mode is already available. If browser-native or visible interaction is required, call pw_promote before using cu_*.",
        "Do not repeat the same selector guess.",
      ].join("\n"),
      temporarilyBlockTool: canTemporarilyBlock(input.toolName)
        ? input.toolName
        : undefined,
      promoteToHybrid: false,
    };
  }

  return {
    stage: "repeat_structural_pw_guidance",
    directive: [
      "Repeated Playwright failure: structural mismatch with no visual/native blocker.",
      "Stay in PW-only mode and use page evidence to change strategy.",
      "Prefer pw_snapshot, pw_links, pw_content, or pw_evaluate over repeating the same selector guess.",
    ].join("\n"),
    temporarilyBlockTool: canTemporarilyBlock(input.toolName)
      ? input.toolName
      : undefined,
    promoteToHybrid: false,
  };
}
