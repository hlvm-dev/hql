import type { ResolvedProviderExecutionPlan } from "./tool-capabilities.ts";
import {
  EMPTY_ROUTING_CONSTRAINTS,
  summarizeRoutingConstraints,
  type RoutingConstraintSet,
} from "./routing-constraints.ts";
import type { RuntimeMode } from "./runtime-mode.ts";
import {
  normalizeSemanticCapabilityId,
  type SemanticCapabilityId,
} from "./semantic-capabilities.ts";
import {
  EMPTY_EXECUTION_TASK_CAPABILITY_CONTEXT,
  hasRequestedSemanticCapability,
  type ExecutionTaskCapabilityContext,
} from "./task-capability-context.ts";
import {
  EMPTY_EXECUTION_RESPONSE_SHAPE_CONTEXT,
  type ExecutionResponseShapeContext,
} from "./response-shape-context.ts";
import {
  EMPTY_EXECUTION_TURN_CONTEXT,
  type ExecutionTurnContext,
  type AudioEligibleAttachmentKind,
  type VisionEligibleAttachmentKind,
} from "./turn-context.ts";

export type CapabilityFamilyId = "web" | "vision" | "code" | "structured" | "audio" | "computer";
export type ExecutionBackendKind = "provider-native" | "mcp" | "hlvm-local";
export type RoutedCapabilityId = SemanticCapabilityId;
export type ExecutionSelectionStrategy = "configured-first";
export type RoutedCapabilityEventPhase =
  | "turn-start"
  | "tool-start"
  | "fallback";

export interface ExecutionFallbackSuppression {
  capabilityId: RoutedCapabilityId;
  backendKind: ExecutionBackendKind;
  toolName?: string;
  serverName?: string;
  routePhase: Exclude<RoutedCapabilityEventPhase, "fallback">;
  failureReason: string;
}

export interface ExecutionFallbackState {
  suppressedCandidates: ExecutionFallbackSuppression[];
}

export const EMPTY_EXECUTION_FALLBACK_STATE: ExecutionFallbackState = {
  suppressedCandidates: [],
};

export interface ExecutionPathCandidate {
  familyId: CapabilityFamilyId;
  capabilityId: RoutedCapabilityId;
  backendKind: ExecutionBackendKind;
  label: string;
  toolName?: string;
  providerName?: string;
  serverName?: string;
  reachable: boolean;
  allowed: boolean;
  selected: boolean;
  reason?: string;
  blockedReasons?: string[];
  /** Whether this candidate runs locally (e.g. stdio MCP or localhost HTTP) */
  isLocal?: boolean;
}

export interface CapabilityRoutingDecision {
  familyId: CapabilityFamilyId;
  capabilityId: RoutedCapabilityId;
  strategy: ExecutionSelectionStrategy;
  candidates: ExecutionPathCandidate[];
  selectedBackendKind?: ExecutionBackendKind;
  selectedToolName?: string;
  selectedServerName?: string;
  fallbackReason?: string;
}

export interface ExecutionSurfaceProviderSummary {
  providerName: string;
  available: boolean;
  isPinned: boolean;
  error?: string;
}

export interface ExecutionSurfaceLocalModelSummary {
  providerName: "ollama";
  available: boolean;
  installedModelCount: number;
  activeModelName?: string;
  activeModelInstalled: boolean;
  error?: string;
}

export interface ExecutionSurfaceMcpServerSummary {
  name: string;
  scope: "user" | "claude-code";
  scopeLabel: string;
  transport: "http" | "stdio";
  target: string;
  reachable: boolean;
  toolCount: number;
  contributingCapabilities: RoutedCapabilityId[];
  contributingTools: string[];
  reason?: string;
}

export interface ExecutionSurface {
  runtimeMode: RuntimeMode;
  activeModelId?: string;
  pinnedProviderName: string;
  strategy: ExecutionSelectionStrategy;
  signature: string;
  constraints: RoutingConstraintSet;
  taskCapabilityContext: ExecutionTaskCapabilityContext;
  responseShapeContext: ExecutionResponseShapeContext;
  turnContext: ExecutionTurnContext;
  fallbackState: ExecutionFallbackState;
  providers: ExecutionSurfaceProviderSummary[];
  localModelSummary: ExecutionSurfaceLocalModelSummary;
  mcpServers: ExecutionSurfaceMcpServerSummary[];
  capabilities: Record<RoutedCapabilityId, CapabilityRoutingDecision>;
  reasoningSelection?: import("./reasoning-selector.ts").ReasoningSelectionResult;
}

export interface RoutedCapabilityProvenance {
  runtimeMode: RuntimeMode;
  familyId: CapabilityFamilyId;
  capabilityId: RoutedCapabilityId;
  strategy: ExecutionSelectionStrategy;
  selectedBackendKind?: ExecutionBackendKind;
  selectedToolName?: string;
  selectedServerName?: string;
  providerName: string;
  fallbackReason?: string;
  routeChangedByFailure?: boolean;
  failedBackendKind?: ExecutionBackendKind;
  failedToolName?: string;
  failedServerName?: string;
  failureReason?: string;
  candidates: ExecutionPathCandidate[];
  summary: string;
}

export interface McpExecutionPathCandidate {
  capabilityId: RoutedCapabilityId;
  serverName: string;
  toolName: string;
  label: string;
  /** Whether this MCP server runs locally (stdio or localhost HTTP) */
  isLocal?: boolean;
}

const EMPTY_LOCAL_MODEL_SUMMARY: ExecutionSurfaceLocalModelSummary = {
  providerName: "ollama",
  available: false,
  installedModelCount: 0,
  activeModelInstalled: false,
};
const DEFAULT_ROUTE_ORDER: readonly ExecutionBackendKind[] = [
  "provider-native",
  "mcp",
  "hlvm-local",
];
const CHEAP_ROUTE_ORDER: readonly ExecutionBackendKind[] = [
  "hlvm-local",
  "mcp",
  "provider-native",
];

export const LOCAL_CODE_EXECUTE_TOOL_NAME = "local_code_execute";

function getCapabilityFamilyId(
  capabilityId: RoutedCapabilityId,
): CapabilityFamilyId {
  if (capabilityId.startsWith("vision.")) return "vision";
  if (capabilityId.startsWith("code.")) return "code";
  if (capabilityId.startsWith("structured.")) return "structured";
  if (capabilityId.startsWith("audio.")) return "audio";
  if (capabilityId.startsWith("computer.")) return "computer";
  return "web";
}

function buildCapabilitySummary(
  route: RoutedCapabilityProvenance,
): string {
  const pathLabel = route.selectedBackendKind === "provider-native"
    ? `provider-native (${route.providerName})`
    : route.selectedBackendKind === "hlvm-local"
    ? "HLVM local"
    : !route.selectedBackendKind
    ? "unavailable"
    : route.selectedServerName
    ? `MCP (${route.selectedServerName})`
    : "MCP";
  return route.fallbackReason
    ? `Auto route ${route.capabilityId} -> ${pathLabel} (${route.fallbackReason})`
    : `Auto route ${route.capabilityId} -> ${pathLabel}`;
}

function describeCandidateLabel(options: {
  backendKind?: ExecutionBackendKind;
  providerName: string;
  toolName?: string;
  serverName?: string;
}): string {
  const pathLabel = options.backendKind === "provider-native"
    ? `provider-native (${options.providerName})`
    : options.backendKind === "hlvm-local"
    ? "HLVM local"
    : options.backendKind === "mcp"
    ? options.serverName
      ? `MCP (${options.serverName})`
      : "MCP"
    : "unavailable";
  return options.toolName ? `${pathLabel} via ${options.toolName}` : pathLabel;
}

export function formatRoutedCapabilityEventSummary(
  route: Pick<
    RoutedCapabilityProvenance,
    | "capabilityId"
    | "selectedBackendKind"
    | "selectedToolName"
    | "selectedServerName"
    | "providerName"
    | "fallbackReason"
    | "routeChangedByFailure"
    | "failedBackendKind"
    | "failedToolName"
    | "failedServerName"
    | "failureReason"
  >,
  routePhase: RoutedCapabilityEventPhase,
): string {
  if (routePhase === "fallback") {
    const failedPath = describeCandidateLabel({
      backendKind: route.failedBackendKind,
      toolName: route.failedToolName,
      serverName: route.failedServerName,
      providerName: route.providerName,
    });
    const nextPath = route.selectedBackendKind
      ? describeCandidateLabel({
        backendKind: route.selectedBackendKind,
        toolName: route.selectedToolName,
        serverName: route.selectedServerName,
        providerName: route.providerName,
      })
      : "unavailable for the rest of this turn";
    const failureReason = route.failureReason?.trim() ||
      route.fallbackReason?.trim() ||
      "routed backend failure";
    return `Fallback route ${route.capabilityId}: ${failedPath} failed (${failureReason}); now ${nextPath}`;
  }
  const base = buildCapabilitySummary({
    runtimeMode: "auto",
    familyId: getCapabilityFamilyId(route.capabilityId),
    capabilityId: route.capabilityId,
    strategy: "configured-first",
    selectedBackendKind: route.selectedBackendKind,
    selectedToolName: route.selectedToolName,
    providerName: route.providerName,
    selectedServerName: route.selectedServerName,
    fallbackReason: route.fallbackReason,
    routeChangedByFailure: route.routeChangedByFailure,
    failedBackendKind: route.failedBackendKind,
    failedToolName: route.failedToolName,
    failedServerName: route.failedServerName,
    failureReason: route.failureReason,
    candidates: [],
    summary: "",
  });
  return routePhase === "turn-start"
    ? `Turn-start ${base.slice("Auto ".length)}`
    : `Tool-start ${base.slice("Auto ".length)}`;
}

export function buildRoutedCapabilityEventKey(
  route: Pick<
    RoutedCapabilityProvenance,
    | "capabilityId"
    | "selectedBackendKind"
    | "selectedToolName"
    | "selectedServerName"
    | "fallbackReason"
    | "failedBackendKind"
    | "failedToolName"
    | "failedServerName"
    | "failureReason"
  >,
): string {
  return JSON.stringify({
    capabilityId: route.capabilityId,
    selectedBackendKind: route.selectedBackendKind ?? null,
    selectedToolName: route.selectedToolName ?? null,
    selectedServerName: route.selectedServerName ?? null,
    fallbackReason: route.fallbackReason ?? null,
    failedBackendKind: route.failedBackendKind ?? null,
    failedToolName: route.failedToolName ?? null,
    failedServerName: route.failedServerName ?? null,
    failureReason: route.failureReason ?? null,
  });
}

function buildCandidate(
  familyId: CapabilityFamilyId,
  capabilityId: RoutedCapabilityId,
  backendKind: ExecutionBackendKind,
  options: Omit<
    ExecutionPathCandidate,
    "familyId" | "capabilityId" | "backendKind"
  >,
): ExecutionPathCandidate {
  return {
    familyId,
    capabilityId,
    backendKind,
    ...options,
  };
}

function cloneConstraints(
  constraints: RoutingConstraintSet | undefined,
): RoutingConstraintSet {
  return {
    hardConstraints: [...(constraints?.hardConstraints ?? [])],
    ...(constraints?.preference
      ? { preference: constraints.preference }
      : {}),
    preferenceConflict: constraints?.preferenceConflict === true,
    source: constraints?.source ?? "none",
  };
}

function cloneTurnContext(
  turnContext: ExecutionTurnContext | undefined,
): ExecutionTurnContext {
  return {
    attachmentCount: turnContext?.attachmentCount ?? 0,
    attachmentKinds: [...(turnContext?.attachmentKinds ?? [])],
    visionEligibleAttachmentCount:
      turnContext?.visionEligibleAttachmentCount ?? 0,
    visionEligibleKinds: [...(turnContext?.visionEligibleKinds ?? [])],
    audioEligibleAttachmentCount:
      turnContext?.audioEligibleAttachmentCount ?? 0,
    audioEligibleKinds: [...(turnContext?.audioEligibleKinds ?? [])],
  };
}

function cloneTaskCapabilityContext(
  taskCapabilityContext: ExecutionTaskCapabilityContext | undefined,
): ExecutionTaskCapabilityContext {
  return {
    requestedCapabilities: [
      ...(taskCapabilityContext?.requestedCapabilities ?? []),
    ],
    source: taskCapabilityContext?.source ?? "none",
    matchedCueLabels: [...(taskCapabilityContext?.matchedCueLabels ?? [])],
  };
}

function cloneResponseShapeContext(
  responseShapeContext: ExecutionResponseShapeContext | undefined,
): ExecutionResponseShapeContext {
  return {
    requested: responseShapeContext?.requested === true,
    source: responseShapeContext?.source ?? "none",
    ...(responseShapeContext?.schemaSignature
      ? { schemaSignature: responseShapeContext.schemaSignature }
      : {}),
    topLevelKeys: [...(responseShapeContext?.topLevelKeys ?? [])],
  };
}

function isExecutionBackendKind(value: unknown): value is ExecutionBackendKind {
  return value === "provider-native" || value === "mcp" ||
    value === "hlvm-local";
}

function isRoutedCapabilityEventPhase(
  value: unknown,
): value is RoutedCapabilityEventPhase {
  return value === "turn-start" || value === "tool-start" ||
    value === "fallback";
}

function cloneFallbackState(
  fallbackState: ExecutionFallbackState | undefined,
): ExecutionFallbackState {
  return {
    suppressedCandidates: (fallbackState?.suppressedCandidates ?? []).map((
      candidate,
    ) => ({
      capabilityId: candidate.capabilityId,
      backendKind: candidate.backendKind,
      ...(candidate.toolName ? { toolName: candidate.toolName } : {}),
      ...(candidate.serverName ? { serverName: candidate.serverName } : {}),
      routePhase: candidate.routePhase,
      failureReason: candidate.failureReason,
    })),
  };
}

function buildFallbackSuppressionKey(
  suppression: Pick<
    ExecutionFallbackSuppression,
    "capabilityId" | "backendKind" | "toolName" | "serverName"
  >,
): string {
  return JSON.stringify({
    capabilityId: suppression.capabilityId,
    backendKind: suppression.backendKind,
    toolName: suppression.toolName ?? null,
    serverName: suppression.serverName ?? null,
  });
}

function sameCandidateIdentity(
  left: Pick<
    ExecutionPathCandidate,
    "backendKind" | "toolName" | "serverName"
  > | undefined,
  right: Pick<
    ExecutionPathCandidate,
    "backendKind" | "toolName" | "serverName"
  > | undefined,
): boolean {
  if (!left || !right) return false;
  return left.backendKind === right.backendKind &&
    left.toolName === right.toolName &&
    left.serverName === right.serverName;
}

function findMatchingFallbackSuppression(
  candidate: ExecutionPathCandidate,
  fallbackState: ExecutionFallbackState | undefined,
): ExecutionFallbackSuppression | undefined {
  const key = buildFallbackSuppressionKey(candidate);
  return [...(fallbackState?.suppressedCandidates ?? [])].reverse().find((
    suppression,
  ) => buildFallbackSuppressionKey(suppression) === key);
}

function applyFallbackSuppressionToCandidate(
  candidate: ExecutionPathCandidate,
  fallbackState: ExecutionFallbackState | undefined,
): ExecutionPathCandidate {
  const suppression = findMatchingFallbackSuppression(candidate, fallbackState);
  if (!suppression) return { ...candidate };
  const blockedReasons = [
    ...(candidate.blockedReasons ?? []),
    `suppressed after ${suppression.routePhase} route failure: ${suppression.failureReason}`,
  ];
  return {
    ...candidate,
    allowed: false,
    reason: blockedReasons[0] ?? candidate.reason,
    blockedReasons,
  };
}

function getLatestFallbackSuppression(
  fallbackState: ExecutionFallbackState | undefined,
  capabilityId: RoutedCapabilityId,
): ExecutionFallbackSuppression | undefined {
  return [...(fallbackState?.suppressedCandidates ?? [])].reverse().find((
    suppression,
  ) => suppression.capabilityId === capabilityId);
}

function buildSuppressionFallbackReason(
  suppression: ExecutionFallbackSuppression | undefined,
  selected: ExecutionPathCandidate | undefined,
  providerName: string,
): string | undefined {
  if (!suppression) return undefined;
  const failedLabel = describeCandidateLabel({
    backendKind: suppression.backendKind,
    toolName: suppression.toolName,
    serverName: suppression.serverName,
    providerName,
  });
  return selected
    ? `${failedLabel} failed during current turn`
    : `${failedLabel} failed during current turn; capability unavailable for remainder of turn`;
}

function buildRouteOrder(
  constraints: RoutingConstraintSet | undefined,
): readonly ExecutionBackendKind[] {
  return constraints?.preference === "cheap"
    ? CHEAP_ROUTE_ORDER
    : DEFAULT_ROUTE_ORDER;
}

function applyRoutingConstraintsToCandidate(
  candidate: ExecutionPathCandidate,
  constraints: RoutingConstraintSet | undefined,
): ExecutionPathCandidate {
  if (!constraints) return { ...candidate };

  const blockedReasons = [...(candidate.blockedReasons ?? [])];
  const hardConstraints = new Set(constraints.hardConstraints);
  const isLocalBackend = candidate.backendKind === "hlvm-local" ||
    (candidate.backendKind === "mcp" && candidate.isLocal === true);
  if (
    !isLocalBackend &&
    hardConstraints.has("local-only")
  ) {
    blockedReasons.push("blocked by task constraint local-only");
  }
  if (
    candidate.backendKind !== "hlvm-local" &&
    hardConstraints.has("no-upload")
  ) {
    blockedReasons.push("blocked by task constraint no-upload");
  }

  const allowed = candidate.allowed && blockedReasons.length === 0;
  return {
    ...candidate,
    allowed,
    reason: blockedReasons[0] ?? candidate.reason,
    ...(blockedReasons.length > 0 ? { blockedReasons } : {}),
  };
}

function selectCandidate(
  candidates: readonly ExecutionPathCandidate[],
  order: readonly ExecutionBackendKind[],
): ExecutionPathCandidate | undefined {
  for (const backendKind of order) {
    const selected = candidates.find((candidate) =>
      candidate.backendKind === backendKind &&
      candidate.reachable &&
      candidate.allowed
    );
    if (selected) return selected;
  }
  return undefined;
}

function buildConstraintFallbackReason(
  constraints: RoutingConstraintSet,
): string | undefined {
  if (constraints.hardConstraints.length > 0) {
    return `task constraints ${constraints.hardConstraints.join(", ")}`;
  }
  if (constraints.preference) {
    return `task preference ${constraints.preference}`;
  }
  return undefined;
}

function buildUnavailableFallbackReason(
  selected: ExecutionPathCandidate | undefined,
  candidates: readonly ExecutionPathCandidate[],
): string | undefined {
  if (!selected) return undefined;
  if (selected.backendKind === "provider-native") return undefined;
  if (selected.backendKind === "mcp") return "provider-native unavailable";
  if (selected.backendKind !== "hlvm-local") return undefined;
  const hasParticipatingMcp = candidates.some((candidate) =>
    candidate.backendKind === "mcp" && candidate.reachable
  );
  return hasParticipatingMcp
    ? "provider-native unavailable; MCP unavailable"
    : "provider-native unavailable; no participating MCP route";
}

function finalizeRoutingDecision(options: {
  capabilityId: RoutedCapabilityId;
  baseCandidates: ExecutionPathCandidate[];
  constraints: RoutingConstraintSet;
  fallbackState: ExecutionFallbackState;
  providerName: string;
}): CapabilityRoutingDecision {
  const baselineSelected = selectCandidate(
    options.baseCandidates,
    DEFAULT_ROUTE_ORDER,
  );
  const constrainedCandidates = options.baseCandidates.map((candidate) =>
    applyRoutingConstraintsToCandidate(candidate, options.constraints)
  );
  const constrainedSelected = selectCandidate(
    constrainedCandidates,
    buildRouteOrder(options.constraints),
  );
  const effectiveCandidates = constrainedCandidates.map((candidate) =>
    applyFallbackSuppressionToCandidate(candidate, options.fallbackState)
  );
  const selected = selectCandidate(
    effectiveCandidates,
    buildRouteOrder(options.constraints),
  );
  const latestSuppression = getLatestFallbackSuppression(
    options.fallbackState,
    options.capabilityId,
  );
  const activeConstraints = summarizeRoutingConstraints(options.constraints) !==
      "none";
  const fallbackReason = latestSuppression &&
      !sameCandidateIdentity(selected, constrainedSelected)
    ? buildSuppressionFallbackReason(
      latestSuppression,
      selected,
      options.providerName,
    )
    : !selected
    ? activeConstraints &&
        effectiveCandidates.some((candidate) =>
          (candidate.blockedReasons?.length ?? 0) > 0
        )
      ? "task impossible under current constraints"
      : undefined
    : baselineSelected && selected.backendKind !== baselineSelected.backendKind
    ? buildConstraintFallbackReason(options.constraints) ??
      buildUnavailableFallbackReason(selected, constrainedCandidates)
    : buildUnavailableFallbackReason(selected, constrainedCandidates);

  return {
    familyId: getCapabilityFamilyId(options.capabilityId),
    capabilityId: options.capabilityId,
    strategy: "configured-first",
    candidates: effectiveCandidates.map((candidate) => ({
      ...candidate,
      selected: !!selected &&
        candidate.backendKind === selected.backendKind &&
        candidate.toolName === selected.toolName &&
        candidate.serverName === selected.serverName,
    })),
    selectedBackendKind: selected?.backendKind,
    selectedToolName: selected?.toolName,
    selectedServerName: selected?.serverName,
    fallbackReason,
  };
}

function buildMcpCandidates(
  capabilityId: RoutedCapabilityId,
  candidates: McpExecutionPathCandidate[],
): ExecutionPathCandidate[] {
  const familyId = getCapabilityFamilyId(capabilityId);
  if (candidates.length === 0) {
    const MCP_FALLBACK_LABELS: Record<RoutedCapabilityId, string> = {
      "web.search": "MCP web search",
      "web.read": "MCP page read",
      "vision.analyze": "MCP vision analysis",
      "audio.analyze": "MCP audio analysis",
      "code.exec": "MCP code execution",
      "computer.use": "MCP computer use",
      "structured.output": "MCP structured output",
    };
    return [
      buildCandidate(familyId, capabilityId, "mcp", {
        label: MCP_FALLBACK_LABELS[capabilityId] ?? `MCP ${capabilityId}`,
        reachable: false,
        allowed: false,
        selected: false,
        reason: "no participating MCP route",
      }),
    ];
  }

  return candidates.map((candidate) =>
    buildCandidate(familyId, capabilityId, "mcp", {
      label: candidate.label,
      toolName: candidate.toolName,
      serverName: candidate.serverName,
      reachable: true,
      allowed: true,
      selected: false,
      isLocal: candidate.isLocal,
    })
  );
}

function sortMcpCandidates(
  candidates: McpExecutionPathCandidate[] | undefined,
): McpExecutionPathCandidate[] {
  return [...(candidates ?? [])].sort((left, right) =>
    left.serverName.localeCompare(right.serverName) ||
    left.toolName.localeCompare(right.toolName)
  );
}

function buildWebSearchDecision(
  plan: ResolvedProviderExecutionPlan,
  mcpCandidates: McpExecutionPathCandidate[],
  constraints: RoutingConstraintSet,
  fallbackState: ExecutionFallbackState,
): CapabilityRoutingDecision {
  const capability = plan.web.capabilities.web_search;
  const localAllowed = capability.implementation !== "disabled";
  const nativeAvailable = capability.implementation === "native";
  const baseCandidates = [
    buildCandidate("web", "web.search", "provider-native", {
      label: "Provider-native web search",
      toolName: capability.nativeToolName,
      providerName: plan.providerName,
      reachable: nativeAvailable,
      allowed: localAllowed && nativeAvailable,
      selected: false,
      reason: nativeAvailable ? undefined : "not available for this session",
    }),
    ...buildMcpCandidates("web.search", mcpCandidates).map((candidate) => ({
      ...candidate,
      allowed: candidate.reachable,
      selected: false,
      reason: candidate.reachable
        ? undefined
        : candidate.reason ?? "not participating in this session",
    })),
    buildCandidate("web", "web.search", "hlvm-local", {
      label: "HLVM local web search",
      toolName: capability.customToolName,
      reachable: true,
      allowed: localAllowed,
      selected: false,
    }),
  ];
  return finalizeRoutingDecision({
    capabilityId: "web.search",
    baseCandidates,
    constraints,
    fallbackState,
    providerName: plan.providerName,
  });
}

function buildWebReadDecision(
  plan: ResolvedProviderExecutionPlan,
  mcpCandidates: McpExecutionPathCandidate[],
  constraints: RoutingConstraintSet,
  fallbackState: ExecutionFallbackState,
): CapabilityRoutingDecision {
  const capability = plan.web.capabilities.web_page_read;
  const localAllowed = capability.implementation !== "disabled";
  const nativeAvailable = capability.implementation === "native";
  const baseCandidates = [
    buildCandidate("web", "web.read", "provider-native", {
      label: "Provider-native page read",
      toolName: capability.nativeToolName,
      providerName: plan.providerName,
      reachable: nativeAvailable,
      allowed: localAllowed && nativeAvailable,
      selected: false,
      reason: nativeAvailable ? undefined : "not available for this session",
    }),
    ...buildMcpCandidates("web.read", mcpCandidates).map((candidate) => ({
      ...candidate,
      allowed: candidate.reachable,
      selected: false,
      reason: candidate.reachable
        ? undefined
        : candidate.reason ?? "not participating in this session",
    })),
    buildCandidate("web", "web.read", "hlvm-local", {
      label: "HLVM local page read",
      toolName: capability.customToolName,
      reachable: true,
      allowed: localAllowed,
      selected: false,
    }),
  ];
  return finalizeRoutingDecision({
    capabilityId: "web.read",
    baseCandidates,
    constraints,
    fallbackState,
    providerName: plan.providerName,
  });
}

function buildVisionUnavailableReason(options: {
  runtimeMode: RuntimeMode;
  turnContext: ExecutionTurnContext;
  directVisionKinds: readonly VisionEligibleAttachmentKind[];
}): string {
  if (options.runtimeMode !== "auto") {
    return "vision.analyze is auto-mode only";
  }
  if (options.turnContext.attachmentCount === 0) {
    return "no attachments on the current turn";
  }
  if (options.turnContext.visionEligibleAttachmentCount === 0) {
    return "no vision-eligible attachments on the current turn";
  }
  if (options.directVisionKinds.length === 0) {
    return "pinned model/provider lacks direct visual input support";
  }
  return "no valid provider-native vision route for the current turn";
}

function buildVisionDecision(options: {
  runtimeMode: RuntimeMode;
  plan: ResolvedProviderExecutionPlan;
  constraints: RoutingConstraintSet;
  turnContext: ExecutionTurnContext;
  directVisionKinds: readonly VisionEligibleAttachmentKind[];
  fallbackState: ExecutionFallbackState;
  mcpCandidates: McpExecutionPathCandidate[];
  localVisionAvailable?: boolean;
}): CapabilityRoutingDecision {
  const unsupportedKinds = options.turnContext.visionEligibleKinds.filter((kind) =>
    !options.directVisionKinds.includes(kind)
  );
  const providerNativeAvailable = options.runtimeMode === "auto" &&
    options.turnContext.visionEligibleAttachmentCount > 0 &&
    unsupportedKinds.length === 0;
  const unavailableReason = buildVisionUnavailableReason({
    runtimeMode: options.runtimeMode,
    turnContext: options.turnContext,
    directVisionKinds: options.directVisionKinds,
  });
  const baseCandidates = [
    buildCandidate("vision", "vision.analyze", "provider-native", {
      label: "Provider-native visual attachment analysis",
      providerName: options.plan.providerName,
      reachable: providerNativeAvailable,
      allowed: providerNativeAvailable,
      selected: false,
      reason: providerNativeAvailable ? undefined : unavailableReason,
    }),
    ...buildMcpCandidates("vision.analyze", options.mcpCandidates),
    buildCandidate("vision", "vision.analyze", "hlvm-local", {
      label: "HLVM local vision analysis (Ollama vision model)",
      reachable: options.localVisionAvailable === true &&
        options.runtimeMode === "auto" &&
        options.turnContext.visionEligibleAttachmentCount > 0,
      allowed: options.localVisionAvailable === true &&
        options.runtimeMode === "auto" &&
        options.turnContext.visionEligibleAttachmentCount > 0,
      selected: false,
      reason: !options.localVisionAvailable
        ? "no local vision-capable model installed"
        : options.runtimeMode !== "auto"
        ? "vision.analyze is auto-mode only"
        : options.turnContext.visionEligibleAttachmentCount === 0
        ? "no vision-eligible attachments on the current turn"
        : undefined,
    }),
  ];
  const decision = finalizeRoutingDecision({
    capabilityId: "vision.analyze",
    baseCandidates,
    constraints: options.constraints,
    fallbackState: options.fallbackState,
    providerName: options.plan.providerName,
  });
  return !decision.selectedBackendKind && !decision.fallbackReason
    ? { ...decision, fallbackReason: unavailableReason }
    : decision;
}

function buildAudioUnavailableReason(options: {
  runtimeMode: RuntimeMode;
  turnContext: ExecutionTurnContext;
  directAudioKinds: readonly AudioEligibleAttachmentKind[];
}): string {
  if (options.runtimeMode !== "auto") {
    return "audio.analyze is auto-mode only";
  }
  if (options.turnContext.attachmentCount === 0) {
    return "no attachments on the current turn";
  }
  if (options.turnContext.audioEligibleAttachmentCount === 0) {
    return "no audio-eligible attachments on the current turn";
  }
  if (options.directAudioKinds.length === 0) {
    return "pinned model/provider lacks direct audio input support";
  }
  return "no valid provider-native audio route for the current turn";
}

function buildAudioDecision(options: {
  runtimeMode: RuntimeMode;
  plan: ResolvedProviderExecutionPlan;
  constraints: RoutingConstraintSet;
  turnContext: ExecutionTurnContext;
  directAudioKinds: readonly AudioEligibleAttachmentKind[];
  fallbackState: ExecutionFallbackState;
  mcpCandidates: McpExecutionPathCandidate[];
}): CapabilityRoutingDecision {
  const unsupportedKinds = options.turnContext.audioEligibleKinds.filter((kind) =>
    !options.directAudioKinds.includes(kind)
  );
  const providerNativeAvailable = options.runtimeMode === "auto" &&
    options.turnContext.audioEligibleAttachmentCount > 0 &&
    unsupportedKinds.length === 0;
  const unavailableReason = buildAudioUnavailableReason({
    runtimeMode: options.runtimeMode,
    turnContext: options.turnContext,
    directAudioKinds: options.directAudioKinds,
  });
  const baseCandidates = [
    buildCandidate("audio", "audio.analyze", "provider-native", {
      label: "Provider-native audio attachment analysis",
      providerName: options.plan.providerName,
      reachable: providerNativeAvailable,
      allowed: providerNativeAvailable,
      selected: false,
      reason: providerNativeAvailable ? undefined : unavailableReason,
    }),
    ...buildMcpCandidates("audio.analyze", options.mcpCandidates),
    buildCandidate("audio", "audio.analyze", "hlvm-local", {
      label: "HLVM local audio attachment analysis",
      reachable: false,
      allowed: false,
      selected: false,
      reason: "hlvm-local audio.analyze is future work — requires Whisper or equivalent local transcription",
    }),
  ];
  const decision = finalizeRoutingDecision({
    capabilityId: "audio.analyze",
    baseCandidates,
    constraints: options.constraints,
    fallbackState: options.fallbackState,
    providerName: options.plan.providerName,
  });
  return !decision.selectedBackendKind && !decision.fallbackReason
    ? { ...decision, fallbackReason: unavailableReason }
    : decision;
}

function buildComputerUseUnavailableReason(options: {
  runtimeMode: RuntimeMode;
  computerUseRequested: boolean;
  providerName: string;
}): string {
  if (options.runtimeMode !== "auto") {
    return "computer.use is auto-mode only";
  }
  if (!options.computerUseRequested) {
    return "computer.use not explicitly requested";
  }
  if (options.providerName !== "anthropic" && options.providerName !== "claude-code") {
    return "computer.use requires Anthropic provider";
  }
  return "no valid provider-native computer.use route for the current turn";
}

function buildComputerUseDecision(options: {
  runtimeMode: RuntimeMode;
  plan: ResolvedProviderExecutionPlan;
  constraints: RoutingConstraintSet;
  computerUseRequested: boolean;
  fallbackState: ExecutionFallbackState;
  mcpCandidates: McpExecutionPathCandidate[];
}): CapabilityRoutingDecision {
  const providerNativeAvailable = options.runtimeMode === "auto" &&
    options.computerUseRequested &&
    options.plan.computerUse.available;
  const unavailableReason = buildComputerUseUnavailableReason({
    runtimeMode: options.runtimeMode,
    computerUseRequested: options.computerUseRequested,
    providerName: options.plan.providerName,
  });
  const baseCandidates = [
    buildCandidate("computer", "computer.use", "provider-native", {
      label: "Provider-native computer use (Anthropic)",
      toolName: options.plan.computerUse.activeToolName,
      providerName: options.plan.providerName,
      reachable: providerNativeAvailable,
      allowed: providerNativeAvailable,
      selected: false,
      reason: providerNativeAvailable ? undefined : unavailableReason,
    }),
    ...buildMcpCandidates("computer.use", options.mcpCandidates),
    buildCandidate("computer", "computer.use", "hlvm-local", {
      label: "HLVM local computer use",
      reachable: false,
      allowed: false,
      selected: false,
      reason: "hlvm-local computer.use is a permanent non-goal — desktop automation requires provider-native (Anthropic) or MCP (puppeteer)",
    }),
  ];
  const decision = finalizeRoutingDecision({
    capabilityId: "computer.use",
    baseCandidates,
    constraints: options.constraints,
    fallbackState: options.fallbackState,
    providerName: options.plan.providerName,
  });
  return !decision.selectedBackendKind && !decision.fallbackReason
    ? { ...decision, fallbackReason: unavailableReason }
    : decision;
}

function buildCodeExecUnavailableReason(options: {
  runtimeMode: RuntimeMode;
  taskCapabilityContext: ExecutionTaskCapabilityContext;
  plan: ResolvedProviderExecutionPlan;
}): string {
  if (options.runtimeMode !== "auto") {
    return "code.exec is auto-mode only";
  }
  if (!hasRequestedSemanticCapability(options.taskCapabilityContext, "code.exec")) {
    return "code.exec not requested by current task";
  }
  if (options.plan.remoteCodeExecution.implementation !== "native") {
    return "pinned model/provider lacks native remote code execution or the tool is unavailable for this session";
  }
  return "no valid provider-native code.exec route for the current turn";
}

function buildCodeExecDecision(options: {
  runtimeMode: RuntimeMode;
  plan: ResolvedProviderExecutionPlan;
  constraints: RoutingConstraintSet;
  taskCapabilityContext: ExecutionTaskCapabilityContext;
  fallbackState: ExecutionFallbackState;
  mcpCandidates: McpExecutionPathCandidate[];
  localCodeExecAvailable: boolean;
}): CapabilityRoutingDecision {
  const requested = hasRequestedSemanticCapability(
    options.taskCapabilityContext,
    "code.exec",
  );
  const providerNativeAvailable = options.runtimeMode === "auto" &&
    requested &&
    options.plan.remoteCodeExecution.implementation === "native";
  const localCodeExecReachable = options.runtimeMode === "auto" &&
    requested &&
    options.localCodeExecAvailable;
  const unavailableReason = buildCodeExecUnavailableReason({
    runtimeMode: options.runtimeMode,
    taskCapabilityContext: options.taskCapabilityContext,
    plan: options.plan,
  });
  const baseCandidates = [
    buildCandidate("code", "code.exec", "provider-native", {
      label: "Provider-native remote code execution",
      toolName: options.plan.remoteCodeExecution.activeToolName,
      providerName: options.plan.providerName,
      reachable: providerNativeAvailable,
      allowed: providerNativeAvailable,
      selected: false,
      reason: providerNativeAvailable ? undefined : unavailableReason,
    }),
    ...buildMcpCandidates("code.exec", options.mcpCandidates),
    buildCandidate("code", "code.exec", "hlvm-local", {
      label: "HLVM local code execution",
      toolName: LOCAL_CODE_EXECUTE_TOOL_NAME,
      reachable: localCodeExecReachable,
      allowed: localCodeExecReachable,
      selected: false,
      reason: localCodeExecReachable
        ? undefined
        : requested
        ? "local_code_execute is unavailable for this session"
        : "code.exec not requested by current task",
    }),
  ];
  const decision = finalizeRoutingDecision({
    capabilityId: "code.exec",
    baseCandidates,
    constraints: options.constraints,
    fallbackState: options.fallbackState,
    providerName: options.plan.providerName,
  });
  return !decision.selectedBackendKind && !decision.fallbackReason
    ? { ...decision, fallbackReason: unavailableReason }
    : decision;
}

function buildStructuredOutputUnavailableReason(options: {
  runtimeMode: RuntimeMode;
  responseShapeContext: ExecutionResponseShapeContext;
  providerNativeAvailable: boolean;
}): string {
  if (options.runtimeMode !== "auto") {
    return "structured.output is auto-mode only";
  }
  if (!options.responseShapeContext.requested) {
    return "structured.output not requested by current turn";
  }
  if (!options.providerNativeAvailable) {
    return "pinned model/provider lacks provider-native structured output for this turn";
  }
  return "no valid provider-native structured.output route for the current turn";
}

function buildStructuredOutputDecision(options: {
  runtimeMode: RuntimeMode;
  plan: ResolvedProviderExecutionPlan;
  constraints: RoutingConstraintSet;
  responseShapeContext: ExecutionResponseShapeContext;
  fallbackState: ExecutionFallbackState;
  providerNativeAvailable: boolean;
}): CapabilityRoutingDecision {
  const requested = options.responseShapeContext.requested;
  const providerNativeReachable = options.runtimeMode === "auto" &&
    requested &&
    options.providerNativeAvailable;
  const unavailableReason = buildStructuredOutputUnavailableReason({
    runtimeMode: options.runtimeMode,
    responseShapeContext: options.responseShapeContext,
    providerNativeAvailable: options.providerNativeAvailable,
  });
  const baseCandidates = [
    buildCandidate("structured", "structured.output", "provider-native", {
      label: "Provider-native structured final response",
      providerName: options.plan.providerName,
      reachable: providerNativeReachable,
      allowed: providerNativeReachable,
      selected: false,
      reason: providerNativeReachable ? undefined : unavailableReason,
    }),
    buildCandidate("structured", "structured.output", "mcp", {
      label: "MCP structured final response",
      reachable: false,
      allowed: false,
      selected: false,
      reason: "MCP structured.output is a permanent non-goal — inherently provider-native",
    }),
    buildCandidate("structured", "structured.output", "hlvm-local", {
      label: "HLVM local structured final response",
      reachable: false,
      allowed: false,
      selected: false,
      reason: "hlvm-local structured.output is a permanent non-goal — inherently provider-native",
    }),
  ];
  const decision = finalizeRoutingDecision({
    capabilityId: "structured.output",
    baseCandidates,
    constraints: options.constraints,
    fallbackState: options.fallbackState,
    providerName: options.plan.providerName,
  });
  return !decision.selectedBackendKind && !decision.fallbackReason
    ? { ...decision, fallbackReason: unavailableReason }
    : decision;
}

export function getExecutionSurfaceSignature(surface: Pick<
  ExecutionSurface,
  | "runtimeMode"
  | "activeModelId"
  | "pinnedProviderName"
  | "constraints"
  | "taskCapabilityContext"
  | "responseShapeContext"
  | "turnContext"
  | "fallbackState"
  | "capabilities"
>): string {
  return JSON.stringify({
    runtimeMode: surface.runtimeMode,
    activeModelId: surface.activeModelId ?? null,
    pinnedProviderName: surface.pinnedProviderName,
    constraints: surface.constraints,
    taskCapabilityContext: surface.taskCapabilityContext,
    responseShapeContext: surface.responseShapeContext,
    turnContext: surface.turnContext,
    fallbackState: surface.fallbackState,
    capabilities: Object.values(surface.capabilities).map((route) => ({
      capabilityId: route.capabilityId,
      selectedBackendKind: route.selectedBackendKind ?? null,
      selectedToolName: route.selectedToolName ?? null,
      selectedServerName: route.selectedServerName ?? null,
      candidates: route.candidates.map((candidate) => ({
        backendKind: candidate.backendKind,
        toolName: candidate.toolName ?? null,
        serverName: candidate.serverName ?? null,
        reachable: candidate.reachable,
        allowed: candidate.allowed,
        blockedReasons: candidate.blockedReasons ?? [],
      })),
    })),
  });
}

export function executionSurfaceUsesMcp(
  surface: Pick<ExecutionSurface, "capabilities"> | undefined,
): boolean {
  if (!surface) return false;
  return Object.values(surface.capabilities).some((route) =>
    route.selectedBackendKind === "mcp"
  );
}

export function buildExecutionSurface(options: {
  runtimeMode: RuntimeMode;
  activeModelId?: string;
  pinnedProviderName: string;
  providerExecutionPlan: ResolvedProviderExecutionPlan;
  constraints?: RoutingConstraintSet;
  taskCapabilityContext?: ExecutionTaskCapabilityContext;
  responseShapeContext?: ExecutionResponseShapeContext;
  turnContext?: ExecutionTurnContext;
  fallbackState?: ExecutionFallbackState;
  providerNativeStructuredOutputAvailable?: boolean;
  directVisionKinds?: readonly VisionEligibleAttachmentKind[];
  directAudioKinds?: readonly AudioEligibleAttachmentKind[];
  localCodeExecAvailable?: boolean;
  localVisionAvailable?: boolean;
  computerUseRequested?: boolean;
  providers?: ExecutionSurfaceProviderSummary[];
  localModelSummary?: ExecutionSurfaceLocalModelSummary;
  mcpServers?: ExecutionSurfaceMcpServerSummary[];
  mcpCandidates?: Partial<Record<RoutedCapabilityId, McpExecutionPathCandidate[]>>;
}): ExecutionSurface {
  const constraints = cloneConstraints(
    options.constraints ?? EMPTY_ROUTING_CONSTRAINTS,
  );
  const taskCapabilityContext = cloneTaskCapabilityContext(
    options.taskCapabilityContext ?? EMPTY_EXECUTION_TASK_CAPABILITY_CONTEXT,
  );
  const responseShapeContext = cloneResponseShapeContext(
    options.responseShapeContext ?? EMPTY_EXECUTION_RESPONSE_SHAPE_CONTEXT,
  );
  const turnContext = cloneTurnContext(
    options.turnContext ?? EMPTY_EXECUTION_TURN_CONTEXT,
  );
  const fallbackState = cloneFallbackState(
    options.fallbackState ?? EMPTY_EXECUTION_FALLBACK_STATE,
  );
  const capabilities: Record<RoutedCapabilityId, CapabilityRoutingDecision> = {
    "web.search": buildWebSearchDecision(
      options.providerExecutionPlan,
      sortMcpCandidates(options.mcpCandidates?.["web.search"]),
      constraints,
      fallbackState,
    ),
    "web.read": buildWebReadDecision(
      options.providerExecutionPlan,
      sortMcpCandidates(options.mcpCandidates?.["web.read"]),
      constraints,
      fallbackState,
    ),
    "vision.analyze": buildVisionDecision({
      runtimeMode: options.runtimeMode,
      plan: options.providerExecutionPlan,
      constraints,
      turnContext,
      directVisionKinds: [...(options.directVisionKinds ?? [])],
      fallbackState,
      mcpCandidates: sortMcpCandidates(options.mcpCandidates?.["vision.analyze"]),
      localVisionAvailable: options.localVisionAvailable,
    }),
    "code.exec": buildCodeExecDecision({
      runtimeMode: options.runtimeMode,
      plan: options.providerExecutionPlan,
      constraints,
      taskCapabilityContext,
      fallbackState,
      mcpCandidates: sortMcpCandidates(options.mcpCandidates?.["code.exec"]),
      localCodeExecAvailable: options.localCodeExecAvailable === true,
    }),
    "structured.output": buildStructuredOutputDecision({
      runtimeMode: options.runtimeMode,
      plan: options.providerExecutionPlan,
      constraints,
      responseShapeContext,
      fallbackState,
      providerNativeAvailable:
        options.providerNativeStructuredOutputAvailable === true,
    }),
    "audio.analyze": buildAudioDecision({
      runtimeMode: options.runtimeMode,
      plan: options.providerExecutionPlan,
      constraints,
      turnContext,
      directAudioKinds: [...(options.directAudioKinds ?? [])],
      fallbackState,
      mcpCandidates: sortMcpCandidates(options.mcpCandidates?.["audio.analyze"]),
    }),
    "computer.use": buildComputerUseDecision({
      runtimeMode: options.runtimeMode,
      plan: options.providerExecutionPlan,
      constraints,
      computerUseRequested: options.computerUseRequested === true,
      fallbackState,
      mcpCandidates: sortMcpCandidates(options.mcpCandidates?.["computer.use"]),
    }),
  };

  const surface: ExecutionSurface = {
    runtimeMode: options.runtimeMode,
    activeModelId: options.activeModelId,
    pinnedProviderName: options.pinnedProviderName,
    strategy: "configured-first",
    signature: "",
    constraints,
    taskCapabilityContext,
    responseShapeContext,
    turnContext,
    fallbackState,
    providers: options.providers ?? [],
    localModelSummary: options.localModelSummary ?? EMPTY_LOCAL_MODEL_SUMMARY,
    mcpServers: options.mcpServers ?? [],
    capabilities,
  };
  surface.signature = getExecutionSurfaceSignature(surface);
  return surface;
}

function getExecutionSurfaceCandidateToolNameSet(
  surface: Pick<ExecutionSurface, "runtimeMode" | "capabilities"> | undefined,
): Set<string> {
  if (!surface || surface.runtimeMode !== "auto") {
    return new Set();
  }
  return new Set(
    Object.values(surface.capabilities).flatMap((route) =>
      route.candidates.flatMap((candidate) =>
        candidate.toolName ? [candidate.toolName] : []
      )
    ),
  );
}

function getExecutionSurfaceSelectedToolNameSet(
  surface: Pick<ExecutionSurface, "runtimeMode" | "capabilities"> | undefined,
): Set<string> {
  if (!surface || surface.runtimeMode !== "auto") {
    return new Set();
  }
  return new Set(
    Object.values(surface.capabilities).flatMap((route) =>
      route.selectedToolName ? [route.selectedToolName] : []
    ),
  );
}

export function projectNamedToolMapForExecutionSurface<T>(
  tools: Record<string, T>,
  surface: Pick<ExecutionSurface, "runtimeMode" | "capabilities"> | undefined,
): Record<string, T> {
  const projected = { ...tools };
  const candidateNames = getExecutionSurfaceCandidateToolNameSet(surface);
  if (candidateNames.size === 0) return projected;
  const selectedNames = getExecutionSurfaceSelectedToolNameSet(surface);
  for (const toolName of candidateNames) {
    if (selectedNames.has(toolName)) continue;
    delete projected[toolName];
  }
  return projected;
}

export function projectNamedToolListForExecutionSurface<T extends { name: string }>(
  items: readonly T[],
  surface: Pick<ExecutionSurface, "runtimeMode" | "capabilities"> | undefined,
): T[] {
  const candidateNames = getExecutionSurfaceCandidateToolNameSet(surface);
  if (candidateNames.size === 0) {
    return items.map((item) => ({ ...item }));
  }
  const selectedNames = getExecutionSurfaceSelectedToolNameSet(surface);
  return items
    .filter((item) => !candidateNames.has(item.name) || selectedNames.has(item.name))
    .map((item) => ({ ...item }));
}

export function getSelectedExecutionPathCandidate(
  route: Pick<CapabilityRoutingDecision, "candidates"> | undefined,
): ExecutionPathCandidate | undefined {
  return route?.candidates.find((candidate) => candidate.selected);
}

export function resolveRoutedCapabilityForToolName(
  surface: ExecutionSurface | undefined,
  toolName: string,
): RoutedCapabilityProvenance | null {
  if (!surface) return null;

  for (const route of Object.values(surface.capabilities)) {
    if (!route.selectedToolName || route.selectedToolName !== toolName) {
      continue;
    }
    return buildRoutedCapabilityProvenance(
      surface,
      route.capabilityId,
    );
  }

  return null;
}

export function buildRoutedCapabilityProvenance(
  surface: ExecutionSurface | undefined,
  capabilityId: RoutedCapabilityId,
  options?: {
    routeChangedByFailure?: boolean;
    failedCandidate?: ExecutionFallbackSuppression;
  },
): RoutedCapabilityProvenance | null {
  if (!surface) return null;

  const route = surface.capabilities[capabilityId];
  if (!route) return null;
  const provenance: RoutedCapabilityProvenance = {
    runtimeMode: surface.runtimeMode,
    familyId: route.familyId,
    capabilityId: route.capabilityId,
    strategy: route.strategy,
    selectedBackendKind: route.selectedBackendKind,
    selectedToolName: route.selectedToolName,
    selectedServerName: route.selectedServerName,
    providerName: surface.pinnedProviderName,
    fallbackReason: route.fallbackReason,
    routeChangedByFailure: options?.routeChangedByFailure,
    failedBackendKind: options?.failedCandidate?.backendKind,
    failedToolName: options?.failedCandidate?.toolName,
    failedServerName: options?.failedCandidate?.serverName,
    failureReason: options?.failedCandidate?.failureReason,
    candidates: route.candidates.map((candidate) => ({ ...candidate })),
    summary: "",
  };
  provenance.summary = buildCapabilitySummary(provenance);
  return provenance;
}

/**
 * Get a human-readable unlock hint for an unavailable capability.
 * Used by /surface to guide users on how to enable capabilities.
 */
export function getCapabilityUnlockHint(
  capabilityId: RoutedCapabilityId,
  decision: CapabilityRoutingDecision,
  pinnedProviderName: string,
): string | null {
  // Only provide hints for capabilities that have no selected route
  if (decision.selectedBackendKind) return null;

  switch (capabilityId) {
    case "web.search":
    case "web.read":
      if (pinnedProviderName === "ollama") {
        return `Switch to a cloud provider (google, anthropic, openai) for native ${capabilityId}, or connect an MCP server with web tools.`;
      }
      return "Check provider API key configuration or connect an MCP server with web tools.";

    case "vision.analyze":
      if (pinnedProviderName === "ollama") {
        return "Switch to a cloud provider with vision support (google, anthropic, openai) or use a local model with vision capabilities.";
      }
      return "Ensure attachments include images and the provider supports vision.";

    case "audio.analyze":
      return "Switch to Google Gemini (google/) for native audio input support.";

    case "computer.use":
      return "Set computer_use: true in the request and use Anthropic (anthropic/) as the provider.";

    case "code.exec":
      if (pinnedProviderName === "ollama") {
        return "Enable local_code_execute for local execution, or switch to a cloud provider / MCP code runner when you need a hosted path.";
      }
      return "Enable local_code_execute, connect an MCP code runner, or use a provider with hosted code execution.";

    case "structured.output":
      return "Ensure the request includes a response schema and the provider supports structured output.";

    default:
      return null;
  }
}

export function appendExecutionFallbackSuppression(
  fallbackState: ExecutionFallbackState | undefined,
  suppression: ExecutionFallbackSuppression,
): ExecutionFallbackState {
  const next = cloneFallbackState(
    fallbackState ?? EMPTY_EXECUTION_FALLBACK_STATE,
  );
  const suppressionKey = buildFallbackSuppressionKey(suppression);
  next.suppressedCandidates = next.suppressedCandidates.filter((entry) =>
    buildFallbackSuppressionKey(entry) !== suppressionKey
  );
  next.suppressedCandidates.push({
    capabilityId: suppression.capabilityId,
    backendKind: suppression.backendKind,
    ...(suppression.toolName ? { toolName: suppression.toolName } : {}),
    ...(suppression.serverName ? { serverName: suppression.serverName } : {}),
    routePhase: suppression.routePhase,
    failureReason: suppression.failureReason,
  });
  return next;
}

export function normalizeExecutionFallbackState(
  value: unknown,
): ExecutionFallbackState {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ...EMPTY_EXECUTION_FALLBACK_STATE };
  }
  const record = value as Record<string, unknown>;
  const suppressedCandidates = Array.isArray(record.suppressedCandidates)
    ? record.suppressedCandidates.flatMap((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        return [];
      }
      const candidate = entry as Record<string, unknown>;
      const capabilityId = normalizeSemanticCapabilityId(candidate.capabilityId);
      const backendKind = isExecutionBackendKind(candidate.backendKind)
        ? candidate.backendKind
        : undefined;
      const routePhase = isRoutedCapabilityEventPhase(candidate.routePhase) &&
          candidate.routePhase !== "fallback"
        ? candidate.routePhase
        : undefined;
      const failureReason = typeof candidate.failureReason === "string" &&
          candidate.failureReason.trim().length > 0
        ? candidate.failureReason
        : undefined;
      if (!capabilityId || !backendKind || !routePhase || !failureReason) {
        return [];
      }
      return [{
        capabilityId,
        backendKind,
        ...(typeof candidate.toolName === "string" &&
            candidate.toolName.trim().length > 0
          ? { toolName: candidate.toolName }
          : {}),
        ...(typeof candidate.serverName === "string" &&
            candidate.serverName.trim().length > 0
          ? { serverName: candidate.serverName }
          : {}),
        routePhase,
        failureReason,
      } satisfies ExecutionFallbackSuppression];
    })
    : [];
  return { suppressedCandidates };
}
