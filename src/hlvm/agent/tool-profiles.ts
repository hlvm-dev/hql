import { ValidationError } from "../../common/error.ts";
import type { ToolFilterState } from "./engine.ts";
import { COMPUTER_USE_TOOLS } from "./computer-use/mod.ts";
import { PLAYWRIGHT_TOOLS } from "./playwright/mod.ts";

export type ToolProfileId = string;
export type ToolProfileSlot =
  | "baseline"
  | "domain"
  | "plan"
  | "discovery"
  | "runtime";

export interface DeclaredToolProfile {
  id: ToolProfileId;
  allowlist?: string[];
  denylist?: string[];
  extends?: ToolProfileId;
  reasonTemplate?: string;
}

export interface ToolProfileLayer {
  slot: ToolProfileSlot;
  profileId?: ToolProfileId;
  allowlist?: string[];
  denylist?: string[];
  reason?: string;
}

export interface ToolProfileState {
  layers: Partial<Record<ToolProfileSlot, ToolProfileLayer>>;
}

export interface ToolFilterSyncTarget {
  toolAllowlist?: string[];
  toolDenylist?: string[];
  toolFilterState?: ToolFilterState;
  toolFilterBaseline?: ToolFilterState;
}

export interface ToolProfileCarrier extends ToolFilterSyncTarget {
  toolProfileState?: ToolProfileState;
}

export type DeclaredToolProfileRegistry = Record<
  ToolProfileId,
  DeclaredToolProfile
>;

interface ResolvedDeclaredToolProfile {
  id: ToolProfileId;
  allowlist?: string[];
  denylist?: string[];
  reasonTemplate?: string;
}

const TOOL_PROFILE_SLOT_ORDER: readonly ToolProfileSlot[] = [
  "baseline",
  "domain",
  "plan",
  "discovery",
  "runtime",
];

const PERSISTENT_TOOL_PROFILE_SLOTS: readonly ToolProfileSlot[] = [
  "baseline",
  "domain",
  "plan",
];

const BROWSER_SAFE_FALLBACK_TOOLS = [
  "tool_search",
  "search_web",
  "web_fetch",
  "fetch_url",
] as const;

const BROWSER_SAFE_PLAYWRIGHT_TOOLS = Object.keys(PLAYWRIGHT_TOOLS).filter(
  (name) => name !== "pw_promote",
);

const DEFAULT_DECLARED_TOOL_PROFILES = declareToolProfiles([
  {
    id: "browser_safe",
    allowlist: uniqueToolList([
      ...BROWSER_SAFE_PLAYWRIGHT_TOOLS,
      ...BROWSER_SAFE_FALLBACK_TOOLS,
    ]),
    reasonTemplate: "Headless browser-safe tool profile",
  },
  {
    id: "browser_hybrid",
    extends: "browser_safe",
    allowlist: uniqueToolList([
      "pw_promote",
      ...Object.keys(COMPUTER_USE_TOOLS),
    ]),
    reasonTemplate: "Hybrid browser profile with headed computer use",
  },
]);

export function cloneToolList(list?: string[]): string[] | undefined {
  return list?.length ? [...list] : undefined;
}

export function uniqueToolList(items: readonly string[]): string[] {
  return [...new Set(items)];
}

export function intersectToolLists(
  left?: readonly string[],
  right?: readonly string[],
): string[] | undefined {
  if (!left?.length) return cloneToolList(right ? [...right] : undefined);
  if (!right?.length) return cloneToolList(left ? [...left] : undefined);
  const rightSet = new Set(right);
  const intersected = left.filter((item) => rightSet.has(item));
  return intersected.length > 0 ? intersected : undefined;
}

export function createToolProfileState(
  layers?: Partial<Record<ToolProfileSlot, ToolProfileLayer>>,
): ToolProfileState {
  const state: ToolProfileState = { layers: {} };
  for (const slot of TOOL_PROFILE_SLOT_ORDER) {
    const layer = layers?.[slot];
    if (layer) {
      setToolProfileLayer(state, slot, layer);
    }
  }
  return state;
}

export function declareToolProfiles(
  profiles: readonly DeclaredToolProfile[],
): DeclaredToolProfileRegistry {
  const registry: DeclaredToolProfileRegistry = {};
  for (const profile of profiles) {
    if (!profile.id.trim()) {
      throw new ValidationError(
        "Tool profile id must be non-empty",
        "tool_profiles",
      );
    }
    if (registry[profile.id]) {
      throw new ValidationError(
        `Duplicate tool profile id: ${profile.id}`,
        "tool_profiles",
      );
    }
    registry[profile.id] = {
      ...profile,
      allowlist: cloneToolList(profile.allowlist),
      denylist: cloneToolList(profile.denylist),
    };
  }
  return registry;
}

export function getDeclaredToolProfiles(): DeclaredToolProfileRegistry {
  return DEFAULT_DECLARED_TOOL_PROFILES;
}

export function resolveDeclaredToolProfileFilter(
  profileId: ToolProfileId,
  registry: DeclaredToolProfileRegistry = DEFAULT_DECLARED_TOOL_PROFILES,
): ToolFilterState {
  const resolved = resolveDeclaredToolProfile(profileId, registry);
  return {
    allowlist: cloneToolList(resolved.allowlist),
    denylist: cloneToolList(resolved.denylist),
  };
}

export function resolveCanonicalBaselineAllowlist(options: {
  querySource?: string;
  baseAllowlist?: readonly string[];
  discoveredDeferredTools?: Iterable<string>;
  ownerId?: string;
}): string[] | undefined {
  const baseAllowlist = cloneToolList(
    options.baseAllowlist ? [...options.baseAllowlist] : undefined,
  );
  if (!baseAllowlist?.length) {
    return undefined;
  }
  return uniqueToolList([
    ...baseAllowlist,
    ...new Set(options.discoveredDeferredTools ?? []),
  ]);
}

export function setToolProfileLayer(
  state: ToolProfileState,
  slot: ToolProfileSlot,
  layer: Omit<ToolProfileLayer, "slot"> | ToolProfileLayer,
): ToolProfileState {
  state.layers[slot] = {
    slot,
    profileId: layer.profileId,
    allowlist: cloneToolList(layer.allowlist),
    denylist: cloneToolList(layer.denylist),
    reason: layer.reason,
  };
  return state;
}

export function clearToolProfileLayer(
  state: ToolProfileState,
  slot: ToolProfileSlot,
): ToolProfileState {
  delete state.layers[slot];
  return state;
}

export function resolveEffectiveToolFilter(
  state: ToolProfileState,
  options: {
    slots?: readonly ToolProfileSlot[];
    registry?: DeclaredToolProfileRegistry;
  } = {},
): ToolFilterState {
  const slots = options.slots ?? TOOL_PROFILE_SLOT_ORDER;
  const registry = options.registry ?? DEFAULT_DECLARED_TOOL_PROFILES;
  let allowlist: string[] | undefined;
  const denylist: string[] = [];

  for (const slot of slots) {
    const layer = state.layers[slot];
    if (!layer) continue;
    const resolvedLayer = resolveToolProfileLayer(layer, registry);
    if (resolvedLayer.allowlist?.length) {
      allowlist = intersectToolLists(allowlist, resolvedLayer.allowlist);
    }
    if (resolvedLayer.denylist?.length) {
      denylist.push(...resolvedLayer.denylist);
    }
  }

  return {
    allowlist: cloneToolList(allowlist),
    denylist: denylist.length > 0 ? uniqueToolList(denylist) : undefined,
  };
}

export function resolvePersistentToolFilter(
  state: ToolProfileState,
  registry: DeclaredToolProfileRegistry = DEFAULT_DECLARED_TOOL_PROFILES,
): ToolFilterState {
  return resolveEffectiveToolFilter(state, {
    slots: PERSISTENT_TOOL_PROFILE_SLOTS,
    registry,
  });
}

export function syncPersistentToolFilterToTarget(
  target: Pick<ToolFilterSyncTarget, "toolAllowlist" | "toolDenylist">,
  profileState: ToolProfileState,
  registry: DeclaredToolProfileRegistry = DEFAULT_DECLARED_TOOL_PROFILES,
): ToolFilterState {
  const persistent = resolvePersistentToolFilter(profileState, registry);
  target.toolAllowlist = cloneToolList(persistent.allowlist);
  target.toolDenylist = cloneToolList(persistent.denylist);
  return persistent;
}

export function syncEffectiveToolFilterToConfig(
  target: ToolFilterSyncTarget,
  profileState: ToolProfileState,
  registry: DeclaredToolProfileRegistry = DEFAULT_DECLARED_TOOL_PROFILES,
): { effective: ToolFilterState; persistent: ToolFilterState } {
  const effective = resolveEffectiveToolFilter(profileState, { registry });
  const persistent = resolvePersistentToolFilter(profileState, registry);

  target.toolAllowlist = cloneToolList(effective.allowlist);
  target.toolDenylist = cloneToolList(effective.denylist);

  if (target.toolFilterState) {
    target.toolFilterState.allowlist = cloneToolList(effective.allowlist);
    target.toolFilterState.denylist = cloneToolList(effective.denylist);
  } else {
    target.toolFilterState = {
      allowlist: cloneToolList(effective.allowlist),
      denylist: cloneToolList(effective.denylist),
    };
  }

  if (target.toolFilterBaseline) {
    target.toolFilterBaseline.allowlist = cloneToolList(persistent.allowlist);
    target.toolFilterBaseline.denylist = cloneToolList(persistent.denylist);
  } else {
    target.toolFilterBaseline = {
      allowlist: cloneToolList(persistent.allowlist),
      denylist: cloneToolList(persistent.denylist),
    };
  }

  return { effective, persistent };
}

export function ensureToolProfileState(
  target: ToolProfileCarrier,
  registry: DeclaredToolProfileRegistry = DEFAULT_DECLARED_TOOL_PROFILES,
): ToolProfileState {
  if (!target.toolProfileState) {
    target.toolProfileState = deriveToolProfileStateFromFilters(target);
  }
  syncEffectiveToolFilterToConfig(target, target.toolProfileState, registry);
  return target.toolProfileState;
}

export function updateToolProfileLayer(
  target: ToolProfileCarrier,
  slot: ToolProfileSlot,
  layer: Omit<ToolProfileLayer, "slot"> | ToolProfileLayer,
  registry: DeclaredToolProfileRegistry = DEFAULT_DECLARED_TOOL_PROFILES,
): ToolProfileState {
  const state = ensureToolProfileState(target, registry);
  setToolProfileLayer(state, slot, layer);
  syncEffectiveToolFilterToConfig(target, state, registry);
  return state;
}

export function clearToolProfileLayerFromTarget(
  target: ToolProfileCarrier,
  slot: ToolProfileSlot,
  registry: DeclaredToolProfileRegistry = DEFAULT_DECLARED_TOOL_PROFILES,
): ToolProfileState {
  const state = ensureToolProfileState(target, registry);
  clearToolProfileLayer(state, slot);
  syncEffectiveToolFilterToConfig(target, state, registry);
  return state;
}

function resolveToolProfileLayer(
  layer: ToolProfileLayer,
  registry: DeclaredToolProfileRegistry,
): ToolFilterState {
  const declared = layer.profileId
    ? resolveDeclaredToolProfile(layer.profileId, registry)
    : undefined;
  return {
    allowlist: uniqueToolList([
      ...(declared?.allowlist ?? []),
      ...(layer.allowlist ?? []),
    ]),
    denylist: uniqueToolList([
      ...(declared?.denylist ?? []),
      ...(layer.denylist ?? []),
    ]),
  };
}

function resolveDeclaredToolProfile(
  profileId: ToolProfileId,
  registry: DeclaredToolProfileRegistry,
  seen = new Set<ToolProfileId>(),
): ResolvedDeclaredToolProfile {
  const profile = registry[profileId];
  if (!profile) {
    throw new ValidationError(
      `Unknown tool profile: ${profileId}`,
      "tool_profiles",
    );
  }
  if (seen.has(profileId)) {
    throw new ValidationError(
      `Circular tool profile inheritance detected at: ${profileId}`,
      "tool_profiles",
    );
  }

  if (!profile.extends) {
    return {
      id: profile.id,
      allowlist: cloneToolList(profile.allowlist),
      denylist: cloneToolList(profile.denylist),
      reasonTemplate: profile.reasonTemplate,
    };
  }

  const nextSeen = new Set(seen);
  nextSeen.add(profileId);
  const parent = resolveDeclaredToolProfile(
    profile.extends,
    registry,
    nextSeen,
  );
  return {
    id: profile.id,
    allowlist: uniqueToolList([
      ...(parent.allowlist ?? []),
      ...(profile.allowlist ?? []),
    ]),
    denylist: uniqueToolList([
      ...(parent.denylist ?? []),
      ...(profile.denylist ?? []),
    ]),
    reasonTemplate: profile.reasonTemplate ?? parent.reasonTemplate,
  };
}

function deriveToolProfileStateFromFilters(
  target: ToolFilterSyncTarget,
): ToolProfileState {
  const state = createToolProfileState();
  const baselineAllowlist = cloneToolList(
    target.toolFilterBaseline?.allowlist ?? target.toolAllowlist,
  );
  const baselineDenylist = cloneToolList(
    target.toolFilterBaseline?.denylist ?? target.toolDenylist,
  );
  if (baselineAllowlist || baselineDenylist) {
    setToolProfileLayer(state, "baseline", {
      allowlist: baselineAllowlist,
      denylist: baselineDenylist,
    });
  }

  const effectiveAllowlist = cloneToolList(
    target.toolFilterState?.allowlist ?? target.toolAllowlist,
  );
  const effectiveDenylist = cloneToolList(
    target.toolFilterState?.denylist ?? target.toolDenylist,
  );
  if (
    !toolListsEqual(baselineAllowlist, effectiveAllowlist) ||
    !toolListsEqual(baselineDenylist, effectiveDenylist)
  ) {
    setToolProfileLayer(state, "runtime", {
      allowlist: effectiveAllowlist,
      denylist: effectiveDenylist,
    });
  }

  return state;
}

function toolListsEqual(
  left?: readonly string[],
  right?: readonly string[],
): boolean {
  if (!left?.length && !right?.length) return true;
  if ((left?.length ?? 0) !== (right?.length ?? 0)) return false;
  return (left ?? []).every((value, index) => value === right?.[index]);
}
