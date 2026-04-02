import {
  normalizeSemanticCapabilityId,
  type SemanticCapabilityId,
} from "./semantic-capabilities.ts";

export interface ExecutionTaskCapabilityContext {
  requestedCapabilities: SemanticCapabilityId[];
  source: "none" | "task-text";
  matchedCueLabels: string[];
}

export const EMPTY_EXECUTION_TASK_CAPABILITY_CONTEXT:
  ExecutionTaskCapabilityContext = {
    requestedCapabilities: [],
    source: "none",
    matchedCueLabels: [],
  };

interface TaskCapabilityCueSpec {
  label: string;
  capabilityId: SemanticCapabilityId;
  pattern: RegExp;
}

const TASK_CAPABILITY_CUE_SPECS: readonly TaskCapabilityCueSpec[] = [
  { label: "calculate", capabilityId: "code.exec", pattern: /\bcalculate\b/i },
  { label: "compute", capabilityId: "code.exec", pattern: /\bcompute\b/i },
  { label: "hash", capabilityId: "code.exec", pattern: /\bhash(?:ing)?\b/i },
  { label: "sha", capabilityId: "code.exec", pattern: /\bsha\b(?!-?\d)/i },
  { label: "sha-256", capabilityId: "code.exec", pattern: /\bsha-?256\b/i },
  { label: "base64", capabilityId: "code.exec", pattern: /\bbase64\b/i },
  { label: "regex", capabilityId: "code.exec", pattern: /\bregex\b/i },
  {
    label: "parse json",
    capabilityId: "code.exec",
    pattern: /\bparse\s+json\b/i,
  },
  {
    label: "parse csv",
    capabilityId: "code.exec",
    pattern: /\bparse\s+csv\b/i,
  },
  {
    label: "transform json",
    capabilityId: "code.exec",
    pattern: /\btransform\s+json\b/i,
  },
  {
    label: "transform csv",
    capabilityId: "code.exec",
    pattern: /\btransform\s+csv\b/i,
  },
  {
    label: "python snippet",
    capabilityId: "code.exec",
    pattern: /\bpython\s+snippet\b/i,
  },
  {
    label: "javascript snippet",
    capabilityId: "code.exec",
    pattern: /\bjavascript\s+snippet\b/i,
  },
  {
    label: "quick script",
    capabilityId: "code.exec",
    pattern: /\bquick\s+script\b/i,
  },
] as const;

function uniqueSortedStrings(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

export function extractTaskCapabilityContextFromTaskText(
  taskText: string,
): ExecutionTaskCapabilityContext {
  const requestedCapabilities: SemanticCapabilityId[] = [];
  const matchedCueLabels: string[] = [];

  for (const cue of TASK_CAPABILITY_CUE_SPECS) {
    if (!cue.pattern.test(taskText)) continue;
    if (!requestedCapabilities.includes(cue.capabilityId)) {
      requestedCapabilities.push(cue.capabilityId);
    }
    if (!matchedCueLabels.includes(cue.label)) {
      matchedCueLabels.push(cue.label);
    }
  }

  if (requestedCapabilities.length === 0) {
    return { ...EMPTY_EXECUTION_TASK_CAPABILITY_CONTEXT };
  }

  return {
    requestedCapabilities: uniqueSortedStrings(
      requestedCapabilities,
    ) as SemanticCapabilityId[],
    source: "task-text",
    matchedCueLabels,
  };
}

export function normalizeExecutionTaskCapabilityContext(
  value: unknown,
): ExecutionTaskCapabilityContext {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ...EMPTY_EXECUTION_TASK_CAPABILITY_CONTEXT };
  }

  const record = value as Record<string, unknown>;
  const requestedCapabilities = Array.isArray(record.requestedCapabilities)
    ? uniqueSortedStrings(
      record.requestedCapabilities.map((entry) =>
        normalizeSemanticCapabilityId(entry)
      ).filter((entry): entry is SemanticCapabilityId => !!entry),
    ) as SemanticCapabilityId[]
    : [];
  const matchedCueLabels = Array.isArray(record.matchedCueLabels)
    ? uniqueSortedStrings(
      record.matchedCueLabels.filter((entry): entry is string =>
        typeof entry === "string" && entry.trim().length > 0
      ),
    )
    : [];
  const source = record.source === "task-text" ? "task-text" : "none";

  return {
    requestedCapabilities,
    source,
    matchedCueLabels,
  };
}

export function hasRequestedSemanticCapability(
  context: ExecutionTaskCapabilityContext | undefined,
  capabilityId: SemanticCapabilityId,
): boolean {
  return context?.requestedCapabilities.includes(capabilityId) ?? false;
}

export function summarizeExecutionTaskCapabilityContext(
  context: ExecutionTaskCapabilityContext | undefined,
): string {
  if (!context || context.requestedCapabilities.length === 0) {
    return "no task-activated capability cues on the last auto turn";
  }

  const cueSummary = context.matchedCueLabels.length > 0
    ? context.matchedCueLabels.join(", ")
    : "none";
  return `requested=${context.requestedCapabilities.join(", ")} · cues=${cueSummary}`;
}
