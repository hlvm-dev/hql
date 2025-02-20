import { runHQLFromSource, getExport } from "./hql_runtime.js";

const source = "; add.hql\n(defn add [a b]\n  (+ a b))\n\n(export \"add\" add)\n";
const _exports = await runHQLFromSource(source);


export async function add(...args) {
  const fn = getExport("add", _exports);
  return await fn(...args);
}
