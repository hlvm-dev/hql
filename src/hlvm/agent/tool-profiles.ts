import { ValidationError } from "../../common/error.ts";
import type { ToolFilterState } from "./engine.ts";
import { COMPUTER_USE_TOOLS } from "./computer-use/mod.ts";
import { PLAYWRIGHT_TOOLS } from "./playwright/mod.ts";
import { getAgentLogger } from "./logger.ts";

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
  /** @internal Incremented on every mutation for cache invalidation. */
  _generation: number;
}

export interface ToolFilterSyncTarget {
  toolAllowlist?: string[];
  toolDenylist?: string[];
  toolFilterState?: ToolFilterState;
  toolFilterBaseline?: ToolFilterState;
}

export interface ToolProfileCarrier {
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

export const BROWSER_SAFE_PROFILE_ID = "browser_safe" as const;
export const BROWSER_HYBRID_PROFILE_ID = "browser_hybrid" as const;

const BROWSER_SAFE_PLAYWRIGHT_TOOLS = Object.keys(PLAYWRIGHT_TOOLS).filter(
  (name) => name !== "pw_promote",
);

const DEFAULT_DECLARED_TOOL_PROFILES = declareToolProfiles([
  {
    id: BROWSER_SAFE_PROFILE_ID,
    allowlist: uniqueToolList(BROWSER_SAFE_PLAYWRIGHT_TOOLS),
    reasonTemplate: "Headless browser-safe tool profile",
  },
  {
    id: BROWSER_HYBRID_PROFILE_ID,
    extends: BROWSER_SAFE_PROFILE_ID,
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
  const state: ToolProfileState = { layers: {}, _generation: 0 };
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
  state._generation = (state._generation ?? 0) + 1;
  return state;
}

export function clearToolProfileLayer(
  state: ToolProfileState,
  slot: ToolProfileSlot,
): ToolProfileState {
  delete state.layers[slot];
  state._generation = (state._generation ?? 0) + 1;
  return state;
}

export function resolveEffectiveToolFilter(
  state: ToolProfileState,
  options: {
    slots?: readonly ToolProfileSlot[];
    registry?: DeclaredToolProfileRegistry;
  } = {},
): ToolFilterState {
  return computeToolFilter(
    state,
    options.slots ?? TOOL_PROFILE_SLOT_ORDER,
    options.registry ?? DEFAULT_DECLARED_TOOL_PROFILES,
  );
}

function computeToolFilter(
  state: ToolProfileState,
  slots: readonly ToolProfileSlot[],
  registry: DeclaredToolProfileRegistry,
): ToolFilterState {
  let allowlist: string[] | undefined;
  const denylist: string[] = [];

  for (const slot of slots) {
    const layer = state.layers[slot];
    if (!layer) continue;
    const resolvedLayer = resolveToolProfileLayer(layer, registry);
    if (resolvedLayer.allowlist?.length) {
      const before = allowlist?.length ?? 0;
      allowlist = intersectToolLists(allowlist, resolvedLayer.allowlist);
      const after = allowlist?.length ?? 0;
      // Warn when a layer intersection drops significant tools — this
      // catches silent masking bugs (e.g., domain layer wiping CU tools).
      if (before > 0 && after < before) {
        const dropped = before - after;
        getAgentLogger().debug(
          `[tool-profiles] Layer '${slot}'${layer.profileId ? ` (${layer.profileId})` : ""} dropped ${dropped} tools via intersection: ${before} → ${after}`,
        );
      }
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

interface _CachedFilters {
  generation: number;
  registry: DeclaredToolProfileRegistry;
  effective: ToolFilterState;
  persistent: ToolFilterState;
}

const _filterCache = new WeakMap<ToolProfileState, _CachedFilters>();

/**
 * Resolve both effective and persistent filters with generation-based caching.
 * Cache is invalidated by _generation counter (bumped on every layer mutation)
 * or by a different registry identity.
 */
function resolveFiltersWithCache(
  state: ToolProfileState,
  registry: DeclaredToolProfileRegistry,
): { effective: ToolFilterState; persistent: ToolFilterState } {
  const gen = state._generation ?? 0;
  const cached = _filterCache.get(state);
  if (cached && cached.generation === gen && cached.registry === registry) {
    return { effective: cached.effective, persistent: cached.persistent };
  }
  const effective = computeToolFilter(
    state,
    TOOL_PROFILE_SLOT_ORDER,
    registry,
  );
  const persistent = computeToolFilter(
    state,
    PERSISTENT_TOOL_PROFILE_SLOTS,
    registry,
  );
  _filterCache.set(state, { generation: gen, registry, effective, persistent });
  return { effective, persistent };
}

/**
 * Memoized version of resolveEffectiveToolFilter for the default-slots path.
 * Non-default slot overrides bypass the cache.
 */
export function resolveEffectiveToolFilterCached(
  state: ToolProfileState,
  options?: {
    slots?: readonly ToolProfileSlot[];
    registry?: DeclaredToolProfileRegistry;
  },
): ToolFilterState {
  if (options?.slots) {
    return resolveEffectiveToolFilter(state, options);
  }
  const registry = options?.registry ?? DEFAULT_DECLARED_TOOL_PROFILES;
  return resolveFiltersWithCache(state, registry).effective;
}

export function resolvePersistentToolFilter(
  state: ToolProfileState,
  registry: DeclaredToolProfileRegistry = DEFAULT_DECLARED_TOOL_PROFILES,
): ToolFilterState {
  return resolveFiltersWithCache(state, registry).persistent;
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
  const { effective, persistent } = resolveFiltersWithCache(
    profileState,
    registry,
  );

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
  target: ToolProfileCarrier & Partial<ToolFilterSyncTarget>,
  registry: DeclaredToolProfileRegistry = DEFAULT_DECLARED_TOOL_PROFILES,
): ToolProfileState {
  if (!target.toolProfileState) {
    target.toolProfileState = deriveToolProfileStateFromFilters(target);
  }
  return target.toolProfileState;
}

export function updateToolProfileLayer(
  target: ToolProfileCarrier & Partial<ToolFilterSyncTarget>,
  slot: ToolProfileSlot,
  layer: Omit<ToolProfileLayer, "slot"> | ToolProfileLayer,
  registry: DeclaredToolProfileRegistry = DEFAULT_DECLARED_TOOL_PROFILES,
): ToolProfileState {
  const state = ensureToolProfileState(target, registry);
  setToolProfileLayer(state, slot, layer);
  return state;
}

export function clearToolProfileLayerFromTarget(
  target: ToolProfileCarrier & Partial<ToolFilterSyncTarget>,
  slot: ToolProfileSlot,
  registry: DeclaredToolProfileRegistry = DEFAULT_DECLARED_TOOL_PROFILES,
): ToolProfileState {
  const state = ensureToolProfileState(target, registry);
  clearToolProfileLayer(state, slot);
  return state;
}

/**
 * Widen the baseline allowlist to include all tools from a declared profile.
 *
 * This is required when a domain profile introduces tool classes (e.g. cu_*)
 * that were not in the original baseline. Without widening, the intersection
 * semantics of resolveEffectiveToolFilter would silently drop the new tools.
 */
export function widenBaselineForDomainProfile(
  target: ToolProfileCarrier & Partial<ToolFilterSyncTarget>,
  profileId: ToolProfileId,
  registry: DeclaredToolProfileRegistry = DEFAULT_DECLARED_TOOL_PROFILES,
): void {
  const state = ensureToolProfileState(target, registry);
  const resolved = resolveDeclaredToolProfileFilter(profileId, registry);
  const baseline = state.layers.baseline;
  if (!resolved.allowlist?.length || !baseline?.allowlist?.length) {
    getAgentLogger().debug(
      `[tool-profiles] widenBaseline skipped for '${profileId}': resolved=${resolved.allowlist?.length ?? 0} baseline=${baseline?.allowlist?.length ?? "unrestricted"}`,
    );
    return;
  }
  const combined = uniqueToolList([
    ...baseline.allowlist,
    ...resolved.allowlist,
  ]);
  setToolProfileLayer(state, "baseline", {
    ...baseline,
    allowlist: combined,
  });
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
