import React, { useEffect, useMemo, useState } from "react";
import { useInput, useStdout } from "ink";
import { truncate } from "../../../../common/utils.ts";
import { summarizeRoutingConstraints } from "../../../agent/routing-constraints.ts";
import { summarizeExecutionResponseShapeContext } from "../../../agent/response-shape-context.ts";
import { summarizeExecutionTaskCapabilityContext } from "../../../agent/task-capability-context.ts";
import { summarizeExecutionTurnContext } from "../../../agent/turn-context.ts";
import { getCapabilityUnlockHint } from "../../../agent/execution-surface.ts";
import type { RoutedCapabilityId } from "../../../agent/execution-surface.ts";
import { getActiveConversationExecutionSurface } from "../../../runtime/host-client.ts";
import type { RuntimeExecutionSurfaceResponse } from "../../../runtime/chat-protocol.ts";
import { useTheme } from "../../theme/index.ts";
import {
  createModalOverlayScaffold,
  fitOverlayRect,
  themeToOverlayColors,
  writeToTerminal,
} from "../overlay/index.ts";

interface ExecutionSurfaceOverlayProps {
  onClose: () => void;
}

function wrapLine(text: string, width: number): string[] {
  if (width <= 0) return [];
  if (text.length <= width) return [text];

  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const next = current.length === 0 ? word : `${current} ${word}`;
    if (next.length <= width) {
      current = next;
      continue;
    }
    if (current.length > 0) {
      lines.push(current);
      current = "";
    }
    if (word.length <= width) {
      current = word;
      continue;
    }
    for (let index = 0; index < word.length; index += width) {
      lines.push(word.slice(index, index + width));
    }
  }

  if (current.length > 0) {
    lines.push(current);
  }
  return lines.length > 0 ? lines : [truncate(text, width, "…")];
}

function formatAvailability(available: boolean, extra?: string): string {
  return available ? `reachable${extra ? ` · ${extra}` : ""}` : extra ?? "unreachable";
}

function summarizeSelectedPath(
  route: RuntimeExecutionSurfaceResponse["capabilities"][string] | undefined,
  pinnedProviderName: string,
): string {
  if (!route) return "unavailable";
  return route.selectedBackendKind === "provider-native"
    ? route.selectedToolName
      ? `provider-native via ${route.selectedToolName}`
      : `provider-native via ${pinnedProviderName}`
    : route.selectedBackendKind === "mcp"
    ? `MCP via ${route.selectedServerName ?? "unknown"} / ${route.selectedToolName ?? "unknown"}`
    : route.selectedBackendKind === "hlvm-local"
    ? `HLVM local via ${route.selectedToolName ?? "unknown"}`
    : "unavailable";
}

function buildLines(
  surface: RuntimeExecutionSurfaceResponse | null,
  error: string | null,
  contentWidth: number,
): string[] {
  if (error) {
    return [`Error: ${error}`];
  }
  if (!surface) {
    return ["Loading execution surface..."];
  }

  const lines: string[] = [];
  const selectedSearch = surface.capabilities["web.search"];
  const selectedRead = surface.capabilities["web.read"];
  const selectedVision = surface.capabilities["vision.analyze"];
  const selectedCodeExec = surface.capabilities["code.exec"];
  const selectedStructuredOutput = surface.capabilities["structured.output"];
  const selectedAudio = surface.capabilities["audio.analyze"];
  const selectedComputerUse = surface.capabilities["computer.use"];
  const visionActiveThisTurn = surface.runtime_mode === "auto" &&
    surface.turn_context.visionEligibleAttachmentCount > 0;
  const audioActiveThisTurn = surface.runtime_mode === "auto" &&
    surface.turn_context.audioEligibleAttachmentCount > 0;
  const computerUseActiveThisTurn = surface.runtime_mode === "auto" &&
    selectedComputerUse?.selectedBackendKind === "provider-native";
  const codeExecActiveThisTurn = surface.runtime_mode === "auto" &&
    surface.task_capability_context.requestedCapabilities.includes("code.exec");
  const structuredOutputActiveThisTurn = surface.runtime_mode === "auto" &&
    surface.response_shape_context.requested;

  lines.push(
    `Runtime ${surface.runtime_mode} · Strategy ${surface.strategy} · Session ${surface.session_id}`,
  );
  lines.push(
    `Model ${surface.active_model_id ?? "unknown"} · Provider ${surface.pinned_provider_name}`,
  );
  lines.push("");
  lines.push("Task Constraints");
  lines.push(`- ${summarizeRoutingConstraints(surface.constraints)}`);
  if (surface.constraints.preferenceConflict) {
    lines.push("- soft preference conflict detected: cheap + quality");
  }
  lines.push("");
  lines.push("Task Capability Context");
  lines.push(`- ${summarizeExecutionTaskCapabilityContext(surface.task_capability_context)}`);
  lines.push("");
  lines.push("Response Shape Context");
  lines.push(`- ${summarizeExecutionResponseShapeContext(surface.response_shape_context)}`);
  lines.push("");
  lines.push("Turn Context");
  lines.push(`- ${summarizeExecutionTurnContext(surface.turn_context)}`);
  lines.push("");
  lines.push("Fallback State");
  if (surface.fallback_state.suppressedCandidates.length === 0) {
    lines.push("- no routed backend failures persisted from the last auto turn");
  } else {
    for (const suppressed of surface.fallback_state.suppressedCandidates) {
      const target = suppressed.backendKind === "provider-native"
        ? `provider-native ${surface.pinned_provider_name}`
        : suppressed.backendKind === "mcp"
        ? `MCP ${suppressed.serverName ?? "unknown"}`
        : "HLVM local";
      lines.push(
        `- ${suppressed.capabilityId}: ${target}${suppressed.toolName ? ` via ${suppressed.toolName}` : ""} failed after ${suppressed.routePhase} (${suppressed.failureReason})`,
      );
    }
  }
  lines.push("");
  lines.push("Active Turn Routing");
  lines.push(
    `- vision.analyze: ${
      visionActiveThisTurn
        ? summarizeSelectedPath(selectedVision, surface.pinned_provider_name)
        : "not active for this turn"
    }${
      selectedVision?.fallbackReason && visionActiveThisTurn
        ? ` (${selectedVision.fallbackReason})`
        : ""
    }`,
  );
  lines.push(
    `- web.search route: ${
      summarizeSelectedPath(selectedSearch, surface.pinned_provider_name)
    }${
      selectedSearch?.fallbackReason ? ` (${selectedSearch.fallbackReason})` : ""
    }`,
  );
  lines.push(
    `- web.read route: ${
      summarizeSelectedPath(selectedRead, surface.pinned_provider_name)
    }${
      selectedRead?.fallbackReason ? ` (${selectedRead.fallbackReason})` : ""
    }`,
  );
  lines.push(
    `- code.exec: ${
      codeExecActiveThisTurn
        ? summarizeSelectedPath(selectedCodeExec, surface.pinned_provider_name)
        : "not requested by this turn"
    }${
      selectedCodeExec?.fallbackReason && codeExecActiveThisTurn
        ? ` (${selectedCodeExec.fallbackReason})`
        : ""
    }`,
  );
  lines.push(
    `- structured.output: ${
      structuredOutputActiveThisTurn
        ? summarizeSelectedPath(
          selectedStructuredOutput,
          surface.pinned_provider_name,
        )
        : "not requested by this turn"
    }${
      selectedStructuredOutput?.fallbackReason && structuredOutputActiveThisTurn
        ? ` (${selectedStructuredOutput.fallbackReason})`
        : ""
    }`,
  );
  lines.push(
    `- audio.analyze: ${
      audioActiveThisTurn
        ? summarizeSelectedPath(selectedAudio, surface.pinned_provider_name)
        : "not active for this turn"
    }${
      selectedAudio?.fallbackReason && audioActiveThisTurn
        ? ` (${selectedAudio.fallbackReason})`
        : ""
    }`,
  );
  lines.push(
    `- computer.use: ${
      computerUseActiveThisTurn
        ? summarizeSelectedPath(selectedComputerUse, surface.pinned_provider_name)
        : "not requested"
    }${
      selectedComputerUse?.fallbackReason && computerUseActiveThisTurn
        ? ` (${selectedComputerUse.fallbackReason})`
        : ""
    }`,
  );
  if (visionActiveThisTurn) {
    lines.push(
      "- Mixed-task posture: attachments stay on vision.analyze; live external information stays on the routed web family.",
    );
  }
  if (codeExecActiveThisTurn) {
    lines.push(
      "- code.exec posture: inline compute/transformation uses the routed provider-hosted sandbox only; it is not local shell or workspace access.",
    );
  }
  if (structuredOutputActiveThisTurn) {
    lines.push(
      "- structured.output posture: the final answer must satisfy the explicit response schema through the routed provider-native structured synthesis path; plain text is not an acceptable substitute.",
    );
  }
  lines.push("");
  lines.push("Providers");
  for (const provider of surface.providers) {
    lines.push(
      `- ${provider.providerName}${provider.isPinned ? " (pinned)" : ""}: ${
        formatAvailability(provider.available, provider.error)
      }`,
    );
  }
  lines.push("");
  lines.push("Local Models");
  lines.push(
    `- ollama: ${
      formatAvailability(
        surface.local_model_summary.available,
        `${surface.local_model_summary.installedModelCount} installed`,
      )
    }`,
  );
  if (surface.local_model_summary.activeModelName) {
    lines.push(
      `- active local model: ${surface.local_model_summary.activeModelName} ${
        surface.local_model_summary.activeModelInstalled ? "(installed)" : "(missing)"
      }`,
    );
  }
  lines.push("");
  lines.push("MCP");
  if (surface.mcp_servers.length === 0) {
    lines.push("- no configured MCP servers");
  } else {
    for (const server of surface.mcp_servers) {
      const capabilities = server.contributingCapabilities.length > 0
        ? server.contributingCapabilities.join(", ")
        : "no web-family participation";
      lines.push(
        `- ${server.name} (${server.scopeLabel}): ${
          formatAvailability(server.reachable, capabilities)
        }`,
      );
    }
  }
  lines.push("");
  lines.push("Capabilities");
  for (const route of [
    selectedSearch,
    selectedRead,
    selectedVision,
    selectedCodeExec,
    selectedStructuredOutput,
    selectedAudio,
    selectedComputerUse,
  ]) {
    if (!route) continue;
    const selectedPath = summarizeSelectedPath(
      route,
      surface.pinned_provider_name,
    );
    lines.push(
      `- ${route.capabilityId}: ${selectedPath}${
        route.fallbackReason ? ` (${route.fallbackReason})` : ""
      }`,
    );
    for (const candidate of route.candidates) {
      const target = candidate.backendKind === "provider-native"
        ? candidate.providerName ?? "provider"
        : candidate.backendKind === "mcp"
        ? candidate.serverName ?? "mcp"
        : "local";
      const state = candidate.selected
        ? "selected"
        : candidate.reachable && candidate.allowed
        ? "available"
        : candidate.reason ?? "unavailable";
      lines.push(
        `  · ${candidate.backendKind} ${target} -> ${candidate.toolName ?? "n/a"} (${state})`,
      );
      for (const blockedReason of candidate.blockedReasons ?? []) {
        lines.push(`    blocked: ${blockedReason}`);
      }
    }
    // Show unlock hint for capabilities with no selected route
    if (!route.selectedBackendKind) {
      const hint = getCapabilityUnlockHint(
        route.capabilityId as RoutedCapabilityId,
        route,
        surface.pinned_provider_name,
      );
      if (hint) {
        lines.push(`  -> unlock: ${hint}`);
      }
    }
  }

  const wrapped: string[] = [];
  for (const line of lines) {
    if (line.length === 0) {
      wrapped.push("");
      continue;
    }
    wrapped.push(...wrapLine(line, contentWidth));
  }
  return wrapped;
}

export function ExecutionSurfaceOverlay({
  onClose,
}: ExecutionSurfaceOverlayProps): React.ReactElement | null {
  const { theme } = useTheme();
  const { stdout } = useStdout();
  const [surface, setSurface] = useState<RuntimeExecutionSurfaceResponse | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getActiveConversationExecutionSurface()
      .then((next) => {
        if (cancelled) return;
        setSurface(next);
        setError(null);
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        setError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useInput((input, key) => {
    if (key.escape || key.ctrl && input === "c" || input === "q") {
      onClose();
    }
  });

  const terminalRows = stdout?.rows ?? 0;
  const colors = useMemo(() => themeToOverlayColors(theme), [theme]);

  useEffect(() => {
    const overlay = fitOverlayRect(110, Math.max(18, terminalRows - 2), {
      marginX: 1,
      marginY: 1,
    });
    const contentWidth = Math.max(12, overlay.width - 4);
    const allLines = buildLines(surface, error, contentWidth);
    const bodyCapacity = Math.max(1, overlay.height - 4);
    const visibleLines = allLines.slice(0, bodyCapacity);
    if (allLines.length > bodyCapacity) {
      visibleLines[visibleLines.length - 1] = truncate(
        `${visibleLines[visibleLines.length - 1]} …`,
        contentWidth,
        "…",
      );
    }

    const overlaySurface = createModalOverlayScaffold({
      frame: { ...overlay, clipped: false },
      colors,
      title: "Execution Surface",
      rightText: "esc",
    });
    overlaySurface.blankRows(overlay.y, overlay.height);

    let rowY = overlay.y + 1;
    for (const line of visibleLines) {
      if (line.length === 0) {
        overlaySurface.blankRow(rowY);
      } else {
        overlaySurface.textRow(rowY, line, {
          paddingLeft: 2,
          color: colors.fieldText,
        });
      }
      rowY += 1;
    }

    writeToTerminal(overlaySurface.finish());
  }, [colors, error, surface, stdout, terminalRows]);

  return null;
}
