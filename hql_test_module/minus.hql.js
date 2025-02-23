import { exportHqlModules, getHqlModule } from "../hql.ts";

const _exports = await exportHqlModules("../minus.hql");


export async function minus(...args) {
  const fn = getHqlModule("minus", _exports);
  return await fn(...args);
}
