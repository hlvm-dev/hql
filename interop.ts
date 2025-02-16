import { HQLValue } from "./type.ts";

export function wrapJsValue(obj: any): HQLValue {
  return { type: "opaque", value: obj };
}
