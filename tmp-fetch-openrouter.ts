try {
  const r = await fetch("https://openrouter.ai/api/v1/models", { signal: AbortSignal.timeout(10_000) });
  const j = await r.json();
  console.log("ok", r.status, (j.data || []).length);
} catch (e) {
  console.log("err", (e as Error).message);
}
