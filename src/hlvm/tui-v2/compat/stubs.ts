// Compat domain: no-op stubs for Anthropic-only / CC-only concerns.
//
// Purpose: donor CC code often reads from growthbook flags, analytics
// events, product-specific auth state, and swarm/coordinator product
// services. HLVM does not have those. Rather than deleting every call-site
// in transplanted code (which would diverge from the donor), this file
// provides no-op replacements that keep the shape of the API the donor
// expects.
//
// STATUS: scaffold. Fill in as transplants surface real calls.

/** Donor analytics. HLVM drops these. */
export function logEvent(_name: string, _properties?: Record<string, unknown>): void {
  // intentional no-op
}

/** Donor growthbook feature flag read. HLVM returns the safe default. */
export function getFeatureValue<T>(_key: string, fallback: T): T {
  return fallback;
}

/** Donor auth status. HLVM does not use Anthropic auth directly in TUI. */
export function isCcAuthenticated(): boolean {
  return true;
}

/** Donor coordinator / swarm / remote-session checks. HLVM does not use these. */
export function isCoordinatorEnabled(): boolean {
  return false;
}

/** Donor fastMode. HLVM does not expose a fast-mode toggle in TUI v2 yet. */
export function isFastModeEnabled(): boolean {
  return false;
}
