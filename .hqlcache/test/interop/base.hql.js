import { exportHqlModules, getHqlModule } from "file:///Users/seoksoonjang/dev/hql/hql.ts";

const _exports = await exportHqlModules("/Users/seoksoonjang/dev/hql/test/interop/base.hql");


export async function add(...args) {
  const fn = getHqlModule("add", _exports);
  return await fn(...args);
}
