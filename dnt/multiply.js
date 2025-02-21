import { exportHqlModules, getHqlModule } from "file:///Users/seoksoonjang/dev/hql/hql.ts";

const _exports = await exportHqlModules("/Users/seoksoonjang/dev/hql/test/multiply.hql");


export async function multiply(...args) {
  const fn = getHqlModule("multiply", _exports);
  return await fn(...args);
}
