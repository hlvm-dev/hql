export type RoutingHardConstraint = "local-only" | "no-upload";
export type RoutingPreference = "cheap" | "quality";
export type RoutingConstraintSource = "none" | "task-text";

export interface RoutingConstraintSet {
  hardConstraints: RoutingHardConstraint[];
  preference?: RoutingPreference;
  preferenceConflict: boolean;
  source: RoutingConstraintSource;
}

export const EMPTY_ROUTING_CONSTRAINTS: RoutingConstraintSet = {
  hardConstraints: [],
  preferenceConflict: false,
  source: "none",
};

const HARD_CONSTRAINT_PHRASES: Record<
  RoutingHardConstraint,
  readonly string[]
> = {
  "local-only": [
    "local only",
    "keep it local",
    "keep data local",
    "stay local",
  ],
  "no-upload": [
    "no upload",
    "no uploads",
    "do not upload",
    "don't upload",
  ],
};

const PREFERENCE_PHRASES: Record<RoutingPreference, readonly string[]> = {
  cheap: [
    "be cheap",
    "stay cheap",
    "cheap if possible",
    "cost sensitive",
  ],
  quality: [
    "quality preferred",
    "quality matters",
    "prioritize quality",
  ],
};

function normalizeTaskText(input: string): string {
  return input
    .toLowerCase()
    .replace(/[’`]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function hasAnyPhrase(text: string, phrases: readonly string[]): boolean {
  return phrases.some((phrase) => text.includes(phrase));
}

export function extractRoutingConstraintsFromTaskText(
  taskText: string,
): RoutingConstraintSet {
  const normalized = normalizeTaskText(taskText);
  if (!normalized) return { ...EMPTY_ROUTING_CONSTRAINTS };

  const hardConstraints = Object.entries(HARD_CONSTRAINT_PHRASES)
    .filter(([, phrases]) => hasAnyPhrase(normalized, phrases))
    .map(([constraint]) => constraint as RoutingHardConstraint);

  const cheap = hasAnyPhrase(normalized, PREFERENCE_PHRASES.cheap);
  const quality = hasAnyPhrase(normalized, PREFERENCE_PHRASES.quality);
  const preferenceConflict = cheap && quality;
  const preference = preferenceConflict
    ? undefined
    : cheap
    ? "cheap"
    : quality
    ? "quality"
    : undefined;

  return {
    hardConstraints,
    ...(preference ? { preference } : {}),
    preferenceConflict,
    source: hardConstraints.length > 0 || preference || preferenceConflict
      ? "task-text"
      : "none",
  };
}

export function normalizeRoutingConstraintSet(
  value: unknown,
): RoutingConstraintSet {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ...EMPTY_ROUTING_CONSTRAINTS };
  }
  const record = value as Record<string, unknown>;
  const hardConstraints = Array.isArray(record.hardConstraints)
    ? record.hardConstraints.filter(
      (entry): entry is RoutingHardConstraint =>
        entry === "local-only" || entry === "no-upload",
    )
    : [];
  const preference = record.preference === "cheap" ||
      record.preference === "quality"
    ? record.preference
    : undefined;
  const preferenceConflict = record.preferenceConflict === true;
  const source = record.source === "task-text" ? "task-text" : "none";
  return {
    hardConstraints: [...new Set(hardConstraints)],
    ...(!preferenceConflict && preference ? { preference } : {}),
    preferenceConflict,
    source:
      source === "task-text" ||
        hardConstraints.length > 0 ||
        preferenceConflict ||
        !!preference
        ? "task-text"
        : "none",
  };
}

export function isRoutingConstraintSetEmpty(
  constraints: RoutingConstraintSet | undefined,
): boolean {
  return !constraints ||
    (
      constraints.hardConstraints.length === 0 &&
      !constraints.preference &&
      constraints.preferenceConflict !== true &&
      constraints.source === "none"
    );
}

export function summarizeRoutingConstraints(
  constraints: RoutingConstraintSet | undefined,
): string {
  if (isRoutingConstraintSetEmpty(constraints)) {
    return "none";
  }

  const segments: string[] = [];
  if (constraints?.hardConstraints.length) {
    segments.push(`hard=${constraints.hardConstraints.join(", ")}`);
  }
  if (constraints?.preference) {
    segments.push(`preference=${constraints.preference}`);
  }
  if (constraints?.preferenceConflict) {
    segments.push("preference=conflict (cheap + quality)");
  }
  return segments.join(" · ");
}
