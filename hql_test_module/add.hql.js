import { exportHqlModules, getHqlModule } from "../hql.ts";

const _exports = await exportHqlModules("./add.hql");


export async function add(...args) {
  const fn = getHqlModule("add", _exports);
  return await fn(...args);
}
