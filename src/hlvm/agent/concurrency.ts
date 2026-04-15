export function composeAbortSignals(
  signals: readonly (AbortSignal | undefined)[],
): AbortSignal | undefined {
  const active = signals.filter((signal): signal is AbortSignal => !!signal);
  if (active.length === 0) return undefined;
  if (active.length === 1) return active[0];
  return AbortSignal.any(active);
}

export function createLinkedAbortController(
  parent?: AbortSignal,
): AbortController {
  const controller = new AbortController();
  if (!parent) return controller;
  if (parent.aborted) {
    controller.abort(parent.reason);
    return controller;
  }
  parent.addEventListener(
    "abort",
    () => controller.abort(parent.reason),
    { once: true },
  );
  return controller;
}
