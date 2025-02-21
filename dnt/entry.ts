// wrapper.ts
import { multiply as multiplyDeno } from "./bundle.ts";
import { multiply as multiplyNode } from "./npm/esm/bundle.js";

const isDeno = "Deno" in globalThis && globalThis.Deno?.version != null;

export function multiply(a: number, b: number): number {
  return isDeno ? multiplyDeno(a, b) : multiplyNode(a, b);
}
