/**
 * Routing Evaluation Framework
 *
 * Measures routing judgment quality across 7 dimensions:
 * privacy, locality, capability fit, quality, cost, availability, mcp-fallback.
 */

import type { CapabilityRoutingDecision, ExecutionSurface, RoutedCapabilityId } from "./execution-surface.ts";
import type { RoutingConstraintSet } from "./routing-constraints.ts";

/** A single evaluation dimension */
export type RoutingEvalDimension =
  | "privacy"
  | "locality"
  | "capability-fit"
  | "quality"
  | "cost"
  | "availability"
  | "mcp-fallback";

/** Expected outcome for a routing decision */
export interface RoutingExpectation {
  /** Which capability this expectation applies to */
  capabilityId?: RoutedCapabilityId;
  /** Expected backend kind (or null = should NOT be routed) */
  expectedBackendKind?: "provider-native" | "mcp" | "hlvm-local" | null;
  /** If true, expects a fallbackReason (i.e., no valid route) */
  expectFallback?: boolean;
  /** If true, expects reasoning selection to trigger */
  expectReasoningSwitch?: boolean;
  /** The dimension this expectation validates */
  dimension: RoutingEvalDimension;
  /** Human-readable description of what we're testing */
  description: string;
}

/** A complete routing eval case */
export interface RoutingEvalCase {
  /** Unique identifier */
  id: string;
  /** Human-readable name */
  name: string;
  /** Primary dimension being tested */
  dimension: RoutingEvalDimension;
  /** Scenario description */
  scenario: string;
  /** The constraints to apply */
  constraints: RoutingConstraintSet;
  /** Model/provider setup */
  pinnedModelId: string;
  pinnedProviderName: string;
  /** Runtime mode (auto/manual) */
  runtimeMode: "auto" | "manual";
  /** Whether computer.use was explicitly requested */
  computerUseRequested?: boolean;
  /** Task capability context overrides */
  requestedCapabilities?: string[];
  /** Turn context: audio attachment count */
  audioAttachmentCount?: number;
  /** Turn context: vision attachment count */
  visionAttachmentCount?: number;
  /** Whether a local vision-capable model is installed */
  localVisionAvailable?: boolean;
  /** MCP candidates to inject for testing MCP fallback routing */
  mcpCandidates?: Partial<Record<import("./execution-surface.ts").RoutedCapabilityId, import("./execution-surface.ts").McpExecutionPathCandidate[]>>;
  /** Expectations to validate against the surface */
  expectations: RoutingExpectation[];
}

/** Result of evaluating a single case */
export interface RoutingEvalResult {
  caseId: string;
  caseName: string;
  dimension: RoutingEvalDimension;
  passed: boolean;
  failures: string[];
}

/**
 * Evaluate a routing decision against expectations.
 */
export function evaluateRoutingDecision(
  evalCase: RoutingEvalCase,
  surface: ExecutionSurface,
): RoutingEvalResult {
  const failures: string[] = [];

  for (const expectation of evalCase.expectations) {
    if (expectation.capabilityId) {
      const decision = surface.capabilities[expectation.capabilityId];
      if (!decision) {
        failures.push(
          `[${expectation.dimension}] ${expectation.description}: capability ${expectation.capabilityId} not found in surface`,
        );
        continue;
      }

      if (expectation.expectFallback) {
        if (decision.selectedBackendKind) {
          failures.push(
            `[${expectation.dimension}] ${expectation.description}: expected fallback but got backend=${decision.selectedBackendKind}`,
          );
        }
      } else if (expectation.expectedBackendKind !== undefined) {
        if (expectation.expectedBackendKind === null) {
          if (decision.selectedBackendKind) {
            failures.push(
              `[${expectation.dimension}] ${expectation.description}: expected no route but got backend=${decision.selectedBackendKind}`,
            );
          }
        } else if (decision.selectedBackendKind !== expectation.expectedBackendKind) {
          failures.push(
            `[${expectation.dimension}] ${expectation.description}: expected backend=${expectation.expectedBackendKind} but got ${decision.selectedBackendKind ?? "none"}`,
          );
        }
      }
    }

    if (expectation.expectReasoningSwitch !== undefined) {
      const switched = surface.reasoningSelection?.switchedFromPinned === true;
      if (expectation.expectReasoningSwitch && !switched) {
        failures.push(
          `[${expectation.dimension}] ${expectation.description}: expected reasoning switch but none occurred`,
        );
      } else if (!expectation.expectReasoningSwitch && switched) {
        failures.push(
          `[${expectation.dimension}] ${expectation.description}: expected no reasoning switch but one occurred: ${surface.reasoningSelection?.reason}`,
        );
      }
    }
  }

  return {
    caseId: evalCase.id,
    caseName: evalCase.name,
    dimension: evalCase.dimension,
    passed: failures.length === 0,
    failures,
  };
}
