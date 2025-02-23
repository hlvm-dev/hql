import { exportHql, getHqlModule } from "jsr:@boraseoksoon/hql@0.0.2";

const bundled_hql = "; Module: /Users/seoksoonjang/dev/hql/hql_test_module/2/index.hql\n(def multiply (get  \"multiply\"))\n\n(defn add2 (x y) (+ (multiply x y) 2))\n\n; (print (add2 3 4))\n\n(export \"add2\" add2)";
const _exports = await exportHql(bundled_hql, "bundle.hql");

console.log("_exports : ", _exports)
// export const multiply = getHqlModule("multiply", _exports);

export async function add2(...args) {
  const fn = getHqlModule("add2", _exports);
  return await fn(...args);
}

