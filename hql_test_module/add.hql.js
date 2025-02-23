import { exportHqlModules, getHqlModule } from "file:///Users/seoksoonjang/dev/hql/hql.ts";

const _exports = await exportHqlModules("/Users/seoksoonjang/dev/hql/hql_test_module/add.hql");


export async function add(...args) {
  const fn = getHqlModule("add", _exports);
  return await fn(...args);
}
