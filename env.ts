import { HQLValue } from "./type.ts";

export class Env {
  public bindings: Record<string, HQLValue>;
  public outer: Env | null;
  public exports?: Record<string, HQLValue>;
  constructor(bindings: Record<string, HQLValue> = {}, outer: Env | null = null) {
    this.bindings = bindings;
    this.outer = outer;
  }

  public get(key: string): HQLValue {
    if (key in this.bindings) {
      return this.bindings[key];
    } else if (this.outer) {
      return this.outer.get(key);
    } else {
      throw new Error(`Symbol '${key}' not found`);
    }
  }

  public set(key: string, value: HQLValue): void {
    this.bindings[key] = value;
  }
}

export const baseEnv = new Env();
