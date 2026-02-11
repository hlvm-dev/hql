/**
 * Ollama Cloud — SSOT for cloud model detection.
 *
 * After `ollama signin`, the local daemon transparently proxies cloud models.
 * Cloud model naming: `{base}:{size}-cloud` (e.g., `deepseek-v3.1:671b-cloud`).
 * Tag portion always contains "cloud".
 */

/** SSOT: detect whether an Ollama model name refers to a cloud-hosted variant */
export function isOllamaCloudModel(name: string): boolean {
  const tag = name.includes(":") ? name.split(":").pop() ?? "" : "";
  return tag.includes("cloud");
}
