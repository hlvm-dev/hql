import { exportHqlModules, getHqlModule } from "./hql_runtime.bundle.js";

const _exports = await exportHqlModules("/Users/seoksoonjang/dev/hql/publish/add.hql");


export async function add(...args) {
  const fn = getHqlModule("add", _exports);
  return await fn(...args);
}
