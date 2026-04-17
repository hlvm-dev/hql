import { ValidationError } from "../../common/error.ts";
import type { ToolFilterState } from "./engine.ts";
import { COMPUTER_USE_TOOLS } from "./computer-use/mod.ts";
import { PLAYWRIGHT_TOOLS } from "./playwright/mod.ts";
import { CHROME_EXT_TOOLS } from "./chrome-ext/mod.ts";
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
export const BROWSER_CHROME_PROFILE_ID = "browser_chrome" as const;

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
  {
    id: BROWSER_CHROME_PROFILE_ID,
    allowlist: uniqueToolList(Object.keys(CHROME_EXT_TOOLS)),
    reasonTemplate:
      "Chrome extension profile — user's authenticated browser sessions",
  },
]);

export function cloneToolList(list?: string[]): string[] | undefined {
  return list === undefined ? undefined : [...list];
}

/**
 * Merge two optional denylists into one, preserving both caller-specified
 * and profile-derived denies.  Returns `undefined` when the result is empty.
 */
export function mergeDenylists(
  a: readonly string[] | undefined,
  b: readonly string[] | undefined,
): string[] | undefined {
  const merged = uniqueToolList([...(a ?? []), ...(b ?? [])]);
  return merged.length > 0 ? merged : undefined;
}

export function uniqueToolList(items: readonly string[]): string[] {
  return [...new Set(items)];
}

export function intersectToolLists(
  left?: readonly string[],
  right?: readonly string[],
): string[] | undefined {
  if (left === undefined) {
    return cloneToolList(right ? [...right] : undefined);
  }
  if (right === undefined) {
    return cloneToolList([...left]);
  }
  const rightSet = new Set(right);
  return left.filter((item) => rightSet.has(item));
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
  if (baseAllowlist === undefined) {
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
    if (resolvedLayer.allowlist !== undefined) {
      const before = allowlist?.length ?? 0;
      allowlist = intersectToolLists(allowlist, resolvedLayer.allowlist);
      const after = allowlist?.length ?? 0;
      // Warn when a layer intersection drops significant tools — this
      // catches silent masking bugs (e.g., domain layer wiping CU tools).
      if (before > 0 && after < before) {
        const dropped = before - after;
        getAgentLogger().debug(
          `[tool-profiles] Layer '${slot}'${
            layer.profileId ? ` (${layer.profileId})` : ""
          } dropped ${dropped} tools via intersection: ${before} → ${after}`,
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
  // Merge, not replace — preserve caller denies.
  target.toolDenylist = mergeDenylists(
    target.toolDenylist,
    persistent.denylist,
  );
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
  syncEffectiveToolFilterToConfig(target, state, registry);
  return state;
}

export function clearToolProfileLayerFromTarget(
  target: ToolProfileCarrier & Partial<ToolFilterSyncTarget>,
  slot: ToolProfileSlot,
  registry: DeclaredToolProfileRegistry = DEFAULT_DECLARED_TOOL_PROFILES,
): ToolProfileState {
  const state = ensureToolProfileState(target, registry);
  clearToolProfileLayer(state, slot);
  syncEffectiveToolFilterToConfig(target, state, registry);
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
      `[tool-profiles] widenBaseline skipped for '${profileId}': resolved=${
        resolved.allowlist?.length ?? 0
      } baseline=${baseline?.allowlist?.length ?? "unrestricted"}`,
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
  const hasAllowlist = declared?.allowlist !== undefined ||
    layer.allowlist !== undefined;
  const hasDenylist = declared?.denylist !== undefined ||
    layer.denylist !== undefined;
  return {
    allowlist: hasAllowlist
      ? uniqueToolList([
        ...(declared?.allowlist ?? []),
        ...(layer.allowlist ?? []),
      ])
      : undefined,
    denylist: hasDenylist
      ? uniqueToolList([
        ...(declared?.denylist ?? []),
        ...(layer.denylist ?? []),
      ])
      : undefined,
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
  const baselineAllowlist = cloneToolList(target.toolAllowlist);
  const baselineDenylist = cloneToolList(target.toolDenylist);
  if (baselineAllowlist || baselineDenylist) {
    setToolProfileLayer(state, "baseline", {
      allowlist: baselineAllowlist,
      denylist: baselineDenylist,
    });
  }

  return state;
}
