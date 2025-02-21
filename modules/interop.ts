// interop.ts
import { HQLValue } from "../modules/type.ts";

export function wrapJsValue(obj: any): HQLValue {
  return { type: "opaque", value: obj };
}