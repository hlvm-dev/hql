import { exportHql, getHqlModule } from "jsr:@boraseoksoon/hql@0.0.2";

const bundled_hql = "; Module: /Users/seoksoonjang/dev/hql/hql_test_module/2/multiply.hql\n(defn multiply (x y)\n  (* x y))\n\n(export \"multiply\" multiply)";
const _exports = await exportHql(bundled_hql, "bundle.hql");

export async function multiply(...args) {
  const fn = getHqlModule("multiply", _exports);
  return await fn(...args);
}

