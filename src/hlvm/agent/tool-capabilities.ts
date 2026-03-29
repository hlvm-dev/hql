import type { ToolMetadata } from "./registry.ts";
import { RuntimeError } from "../../common/error.ts";

export type WebCapabilityId =
  | "web_search"
  | "web_page_read"
  | "raw_url_fetch";

export type ProviderExecutionCapabilityId =
  | WebCapabilityId
  | "remote_code_execution";

export type ProviderRoutingProfile = "conservative";
export type WebCapabilityImplementation = "custom" | "native" | "disabled";
export type RemoteExecutionImplementation = "native" | "disabled";

export const CUSTOM_WEB_SEARCH_TOOL_NAME = "search_web";
export const NATIVE_WEB_SEARCH_TOOL_NAME = "web_search";
export const WEB_PAGE_READ_TOOL_NAME = "web_fetch";
export const RAW_URL_FETCH_TOOL_NAME = "fetch_url";
export const REMOTE_CODE_EXECUTE_TOOL_NAME = "remote_code_execute";

const NATIVE_WEB_SEARCH_PROVIDERS = new Set<string>([
  "openai",
  "anthropic",
  "claude-code",
  "google",
]);
const NATIVE_WEB_PAGE_READ_PROVIDERS = new Set<string>(["google"]);
const NATIVE_REMOTE_CODE_EXECUTION_PROVIDERS = new Set<string>([
  "anthropic",
  "claude-code",
  "google",
]);

const NATIVE_WEB_SEARCH_DESCRIPTION =
  "Search the live web using the provider-native web search integration.";
const NATIVE_WEB_PAGE_READ_DESCRIPTION =
  "Read a single known web page using provider-native page context. Use this only for the default readable-page path, not for raw HTML, batch reads, or shaped fetches.";
const REMOTE_CODE_EXECUTION_DESCRIPTION =
  "Run inline code in a provider-hosted sandbox. No workspace access. Provider network/filesystem behavior is limited to whatever the provider itself supports.";
const NATIVE_REMOTE_CODE_EXECUTION_DESCRIPTION =
  "Run inline code in the provider-native server-side sandbox. No workspace access. Network/filesystem behavior depends on the provider and is not guaranteed.";

export interface NativeProviderCapabilityAvailability {
  webSearch: boolean;
  webPageRead: boolean;
  remoteCodeExecution: boolean;
}

export const EMPTY_NATIVE_PROVIDER_CAPABILITY_AVAILABILITY:
  NativeProviderCapabilityAvailability = {
    webSearch: false,
    webPageRead: false,
    remoteCodeExecution: false,
  };

interface WebCapabilitySpec {
  id: WebCapabilityId;
  selectors: readonly string[];
  customToolName: string;
  nativeToolName?: string;
  providerNativeAliases?: readonly string[];
  nativeProviders?: ReadonlySet<string>;
  nativeDescription?: string;
  citationBacked: boolean;
  rawPayloadCitationEligible: boolean;
}

interface ResolvedWebCapability {
  id: WebCapabilityId;
  selectors: readonly string[];
  customToolName: string;
  nativeToolName?: string;
  implementation: WebCapabilityImplementation;
  activeToolName?: string;
  nativeDescription?: string;
  citationBacked: boolean;
  rawPayloadCitationEligible: boolean;
}

export interface ResolvedWebCapabilityPlan {
  providerName: string;
  capabilities: Record<WebCapabilityId, ResolvedWebCapability>;
}

export interface ResolvedRemoteExecutionCapability {
  id: "remote_code_execution";
  selectors: readonly string[];
  customToolName: string;
  nativeToolName: string;
  implementation: RemoteExecutionImplementation;
  activeToolName?: string;
  description: string;
}

export interface ResolvedProviderExecutionPlan {
  providerName: string;
  routingProfile: ProviderRoutingProfile;
  web: ResolvedWebCapabilityPlan;
  remoteCodeExecution: ResolvedRemoteExecutionCapability;
}

type ToolSearchResultLike = {
  name: string;
  description: string;
  category?: string;
  safetyLevel: string;
  source: string;
};

const WEB_CAPABILITY_SPECS: readonly WebCapabilitySpec[] = [
  {
    id: "web_search",
    selectors: [CUSTOM_WEB_SEARCH_TOOL_NAME, NATIVE_WEB_SEARCH_TOOL_NAME],
    customToolName: CUSTOM_WEB_SEARCH_TOOL_NAME,
    nativeToolName: NATIVE_WEB_SEARCH_TOOL_NAME,
    providerNativeAliases: ["google_search"],
    nativeProviders: NATIVE_WEB_SEARCH_PROVIDERS,
    nativeDescription: NATIVE_WEB_SEARCH_DESCRIPTION,
    citationBacked: true,
    rawPayloadCitationEligible: true,
  },
  {
    id: "web_page_read",
    selectors: [WEB_PAGE_READ_TOOL_NAME],
    customToolName: WEB_PAGE_READ_TOOL_NAME,
    nativeToolName: WEB_PAGE_READ_TOOL_NAME,
    providerNativeAliases: ["url_context"],
    nativeProviders: NATIVE_WEB_PAGE_READ_PROVIDERS,
    nativeDescription: NATIVE_WEB_PAGE_READ_DESCRIPTION,
    citationBacked: true,
    rawPayloadCitationEligible: true,
  },
  {
    id: "raw_url_fetch",
    selectors: [RAW_URL_FETCH_TOOL_NAME],
    customToolName: RAW_URL_FETCH_TOOL_NAME,
    citationBacked: true,
    rawPayloadCitationEligible: true,
  },
] as const;

const WEB_CAPABILITY_BY_TOOL_NAME = new Map<string, WebCapabilitySpec>();
const PROVIDER_EXECUTED_WEB_TOOL_NAMES = new Set<string>();
for (const spec of WEB_CAPABILITY_SPECS) {
  WEB_CAPABILITY_BY_TOOL_NAME.set(spec.customToolName, spec);
  if (spec.nativeToolName) {
    WEB_CAPABILITY_BY_TOOL_NAME.set(spec.nativeToolName, spec);
    if (spec.nativeToolName !== spec.customToolName) {
      PROVIDER_EXECUTED_WEB_TOOL_NAMES.add(spec.nativeToolName);
    }
  }
  for (const alias of getProviderNativeAliases(spec)) {
    WEB_CAPABILITY_BY_TOOL_NAME.set(alias, spec);
    PROVIDER_EXECUTED_WEB_TOOL_NAMES.add(alias);
  }
}

export type CapabilityProjectionPlan =
  | ResolvedWebCapabilityPlan
  | ResolvedProviderExecutionPlan;

function listIncludesAnySelector(
  list: readonly string[] | undefined,
  selectors: readonly string[],
): boolean {
  return list?.some((name) => selectors.includes(name)) ?? false;
}

function dedupeToolNames(names: readonly string[]): string[] {
  return [...new Set(names)];
}

function getProviderNativeAliases(spec: WebCapabilitySpec): readonly string[] {
  return spec.providerNativeAliases ?? [];
}

function buildProviderExecutedMetadata(
  description: string,
  base?: ToolMetadata,
  fallback?: Partial<ToolMetadata>,
): ToolMetadata {
  if (base) {
    return {
      ...base,
      description,
    };
  }

  return {
    fn: async () => {
      throw new RuntimeError(
        "provider-executed tool is not callable locally",
      );
    },
    description,
    args: {},
    safetyLevel: fallback?.safetyLevel ?? "L0",
    category: fallback?.category,
    replaces: fallback?.replaces,
  };
}

function resolveNativeAvailability(options: {
  nativeCapabilities?: Partial<NativeProviderCapabilityAvailability>;
  nativeWebSearchAvailable?: boolean;
}): NativeProviderCapabilityAvailability {
  return {
    ...EMPTY_NATIVE_PROVIDER_CAPABILITY_AVAILABILITY,
    ...(options.nativeCapabilities ?? {}),
    ...(typeof options.nativeWebSearchAvailable === "boolean"
      ? { webSearch: options.nativeWebSearchAvailable }
      : {}),
  };
}

function isConservativeNativePageReadEligible(
  allowlist?: readonly string[],
): boolean {
  // Session-scoped routing cannot inspect future tool args, so the only
  // contract-safe activation is an explicit dedicated web_fetch surface.
  return allowlist?.length === 1 && allowlist[0] === WEB_PAGE_READ_TOOL_NAME;
}

function resolveCapabilityImplementation(
  spec: WebCapabilitySpec,
  options: {
    providerName: string;
    allowlist?: readonly string[];
    denylist?: readonly string[];
    nativeCapabilities: NativeProviderCapabilityAvailability;
  },
): WebCapabilityImplementation {
  const denied = listIncludesAnySelector(options.denylist, spec.selectors);
  if (denied) return "disabled";

  if (
    options.allowlist?.length &&
    !listIncludesAnySelector(options.allowlist, spec.selectors)
  ) {
    return "disabled";
  }

  const nativeEligible = spec.id === "web_search"
    ? options.nativeCapabilities.webSearch
    : spec.id === "web_page_read"
    ? options.nativeCapabilities.webPageRead &&
      isConservativeNativePageReadEligible(options.allowlist)
    : false;

  if (
    spec.nativeToolName &&
    nativeEligible &&
    spec.nativeProviders?.has(options.providerName)
  ) {
    return "native";
  }

  return "custom";
}

export function normalizeWebCapabilitySelectors(
  names?: readonly string[],
): string[] | undefined {
  if (!names) return undefined;
  const normalized = [...names];
  const hasSearchSelector = normalized.includes(CUSTOM_WEB_SEARCH_TOOL_NAME) ||
    normalized.includes(NATIVE_WEB_SEARCH_TOOL_NAME);
  if (hasSearchSelector) {
    normalized.push(CUSTOM_WEB_SEARCH_TOOL_NAME, NATIVE_WEB_SEARCH_TOOL_NAME);
  }
  return dedupeToolNames(normalized);
}

export function resolveWebCapabilityPlan(options: {
  providerName: string;
  allowlist?: readonly string[];
  denylist?: readonly string[];
  nativeCapabilities?: Partial<NativeProviderCapabilityAvailability>;
  nativeWebSearchAvailable?: boolean;
}): ResolvedWebCapabilityPlan {
  const nativeCapabilities = resolveNativeAvailability(options);
  const capabilities = Object.fromEntries(
    WEB_CAPABILITY_SPECS.map((spec) => {
      const implementation = resolveCapabilityImplementation(spec, {
        providerName: options.providerName,
        allowlist: options.allowlist,
        denylist: options.denylist,
        nativeCapabilities,
      });
      return [
        spec.id,
        {
          id: spec.id,
          selectors: spec.selectors,
          customToolName: spec.customToolName,
          nativeToolName: spec.nativeToolName,
          implementation,
          activeToolName: implementation === "native"
            ? spec.nativeToolName
            : implementation === "custom"
            ? spec.customToolName
            : undefined,
          nativeDescription: spec.nativeDescription,
          citationBacked: spec.citationBacked,
          rawPayloadCitationEligible: spec.rawPayloadCitationEligible &&
            implementation !== "native",
        },
      ];
    }),
  ) as Record<WebCapabilityId, ResolvedWebCapability>;

  return {
    providerName: options.providerName,
    capabilities,
  };
}

function resolveRemoteCodeExecutionCapability(options: {
  providerName: string;
  allowlist?: readonly string[];
  denylist?: readonly string[];
  nativeCapabilities: NativeProviderCapabilityAvailability;
  autoRequestedRemoteCodeExecution?: boolean;
}): ResolvedRemoteExecutionCapability {
  const selectors = [REMOTE_CODE_EXECUTE_TOOL_NAME] as const;
  const denied = listIncludesAnySelector(options.denylist, selectors);
  const explicitlyAllowlisted = listIncludesAnySelector(
    options.allowlist,
    selectors,
  );
  const autoRequestedWithoutExplicitAllowlist =
    options.autoRequestedRemoteCodeExecution === true &&
    !(options.allowlist?.length);
  const implementation: RemoteExecutionImplementation = !denied &&
      (explicitlyAllowlisted || autoRequestedWithoutExplicitAllowlist) &&
      options.nativeCapabilities.remoteCodeExecution &&
      NATIVE_REMOTE_CODE_EXECUTION_PROVIDERS.has(options.providerName)
    ? "native"
    : "disabled";

  return {
    id: "remote_code_execution",
    selectors,
    customToolName: REMOTE_CODE_EXECUTE_TOOL_NAME,
    nativeToolName: REMOTE_CODE_EXECUTE_TOOL_NAME,
    implementation,
    activeToolName: implementation === "native"
      ? REMOTE_CODE_EXECUTE_TOOL_NAME
      : undefined,
    description: implementation === "native"
      ? NATIVE_REMOTE_CODE_EXECUTION_DESCRIPTION
      : REMOTE_CODE_EXECUTION_DESCRIPTION,
  };
}

export function resolveProviderExecutionPlan(options: {
  providerName: string;
  allowlist?: readonly string[];
  denylist?: readonly string[];
  nativeCapabilities?: Partial<NativeProviderCapabilityAvailability>;
  nativeWebSearchAvailable?: boolean;
  autoRequestedRemoteCodeExecution?: boolean;
}): ResolvedProviderExecutionPlan {
  const nativeCapabilities = resolveNativeAvailability(options);

  return {
    providerName: options.providerName,
    routingProfile: "conservative",
    web: resolveWebCapabilityPlan({
      providerName: options.providerName,
      allowlist: options.allowlist,
      denylist: options.denylist,
      nativeCapabilities,
    }),
    remoteCodeExecution: resolveRemoteCodeExecutionCapability({
      providerName: options.providerName,
      allowlist: options.allowlist,
      denylist: options.denylist,
      nativeCapabilities,
      autoRequestedRemoteCodeExecution: options.autoRequestedRemoteCodeExecution,
    }),
  };
}

export function getResolvedWebCapabilityPlan(
  plan?: CapabilityProjectionPlan,
): ResolvedWebCapabilityPlan | undefined {
  if (!plan) return undefined;
  return "web" in plan ? plan.web : plan;
}

export function getResolvedRemoteExecutionCapability(
  plan?: CapabilityProjectionPlan,
): ResolvedRemoteExecutionCapability | undefined {
  if (!plan || !("remoteCodeExecution" in plan)) return undefined;
  return plan.remoteCodeExecution;
}

export function getResolvedProviderExecutionPlan(
  plan?: CapabilityProjectionPlan,
): ResolvedProviderExecutionPlan | undefined {
  if (!plan || !("web" in plan)) return undefined;
  return plan;
}

export function projectPromptToolsForWebCapabilities(
  tools: Record<string, ToolMetadata>,
  plan?: CapabilityProjectionPlan,
): Record<string, ToolMetadata> {
  const projected = { ...tools };
  const webPlan = getResolvedWebCapabilityPlan(plan);
  const remotePlan = getResolvedRemoteExecutionCapability(plan);
  if (!webPlan && !remotePlan) {
    delete projected[NATIVE_WEB_SEARCH_TOOL_NAME];
    return projected;
  }

  for (const spec of WEB_CAPABILITY_SPECS) {
    const capability = webPlan?.capabilities[spec.id];
    if (!capability) continue;

    if (capability.implementation === "disabled") {
      delete projected[spec.customToolName];
      if (spec.nativeToolName && spec.nativeToolName !== spec.customToolName) {
        delete projected[spec.nativeToolName];
      }
      continue;
    }

    if (capability.implementation !== "native" || !spec.nativeToolName) {
      continue;
    }

    const base = projected[spec.customToolName];
    if (spec.nativeToolName !== spec.customToolName) {
      delete projected[spec.customToolName];
    }
    projected[spec.nativeToolName] = buildProviderExecutedMetadata(
      capability.nativeDescription ?? spec.nativeDescription ??
        base?.description ?? "",
      base,
      {
        category: "web",
        replaces: "curl/wget",
      },
    );
  }

  if (remotePlan?.implementation === "disabled") {
    delete projected[REMOTE_CODE_EXECUTE_TOOL_NAME];
  } else if (remotePlan?.implementation === "native") {
    projected[REMOTE_CODE_EXECUTE_TOOL_NAME] = buildProviderExecutedMetadata(
      remotePlan.description,
      projected[REMOTE_CODE_EXECUTE_TOOL_NAME],
      {
        category: "data",
        safetyLevel: "L2",
      },
    );
  }

  return projected;
}

export function projectToolSearchResultsForWebCapabilities<
  T extends ToolSearchResultLike,
>(
  results: readonly T[],
  plan?: CapabilityProjectionPlan,
): T[] {
  const webPlan = getResolvedWebCapabilityPlan(plan);
  const remotePlan = getResolvedRemoteExecutionCapability(plan);
  if (!webPlan && !remotePlan) {
    return results.map((result) => ({ ...result }));
  }

  const projected: T[] = [];
  const seenNames = new Set<string>();

  for (const result of results) {
    const spec = WEB_CAPABILITY_BY_TOOL_NAME.get(result.name);
    if (!spec && result.name !== REMOTE_CODE_EXECUTE_TOOL_NAME) {
      projected.push({ ...result });
      continue;
    }

    if (result.name === REMOTE_CODE_EXECUTE_TOOL_NAME) {
      if (!remotePlan || remotePlan.implementation === "disabled") {
        continue;
      }
      if (seenNames.has(REMOTE_CODE_EXECUTE_TOOL_NAME)) continue;
      seenNames.add(REMOTE_CODE_EXECUTE_TOOL_NAME);
      projected.push({
        ...result,
        name: REMOTE_CODE_EXECUTE_TOOL_NAME,
        description: remotePlan.description,
      });
      continue;
    }

    if (!spec) continue;

    const capability = webPlan?.capabilities[spec.id];
    if (!capability || capability.implementation === "disabled") {
      continue;
    }

    let nextName = result.name;
    let nextDescription = result.description;
    if (capability.implementation === "native" && capability.nativeToolName) {
      nextName = capability.nativeToolName;
      nextDescription = capability.nativeDescription ??
        spec.nativeDescription ??
        result.description;
    }

    if (seenNames.has(nextName)) continue;
    seenNames.add(nextName);
    projected.push({
      ...result,
      name: nextName,
      description: nextDescription,
    });
  }

  return projected;
}

export function isWebCapabilityToolName(toolName: string): boolean {
  return WEB_CAPABILITY_BY_TOOL_NAME.has(toolName);
}

export function isCitationBackedWebToolName(toolName: string): boolean {
  const spec = WEB_CAPABILITY_BY_TOOL_NAME.get(toolName);
  return spec?.citationBacked ?? false;
}

export function isRawPayloadCitationWebToolName(toolName: string): boolean {
  if (PROVIDER_EXECUTED_WEB_TOOL_NAMES.has(toolName)) return false;
  const spec = WEB_CAPABILITY_BY_TOOL_NAME.get(toolName);
  return spec?.rawPayloadCitationEligible ?? false;
}

function getActiveWebToolNames(
  plan: ResolvedWebCapabilityPlan,
): string[] {
  return WEB_CAPABILITY_SPECS.flatMap((spec) => {
    const active = plan.capabilities[spec.id]?.activeToolName;
    return active ? [active] : [];
  });
}

export function getActiveProviderExecutionToolNames(
  plan: ResolvedProviderExecutionPlan,
): string[] {
  return dedupeToolNames([
    ...getActiveWebToolNames(plan.web),
    ...(plan.remoteCodeExecution.activeToolName
      ? [plan.remoteCodeExecution.activeToolName]
      : []),
  ]);
}

export function getProviderExecutedToolNames(
  plan: ResolvedProviderExecutionPlan,
): string[] {
  return [...getProviderExecutedToolNameSet(plan)];
}

export function getProviderExecutedToolNameSet(
  plan: ResolvedProviderExecutionPlan,
): ReadonlySet<string> {
  const names = new Set<string>();

  for (const spec of WEB_CAPABILITY_SPECS) {
    const capability = plan.web.capabilities[spec.id];
    if (capability?.implementation !== "native" || !capability.activeToolName) {
      continue;
    }
    names.add(capability.activeToolName);
    for (const alias of getProviderNativeAliases(spec)) {
      names.add(alias);
    }
  }

  if (
    plan.remoteCodeExecution.implementation === "native" &&
    plan.remoteCodeExecution.activeToolName
  ) {
    names.add(plan.remoteCodeExecution.activeToolName);
    names.add("code_execution");
  }

  return names;
}
