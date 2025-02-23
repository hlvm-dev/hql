import { exportHqlModules, getHqlModule } from "../../hql.ts";

const _exports = await exportHqlModules("./multiply.hql");

export async function multiply(...args) {
  const fn = getHqlModule("multiply", _exports);
  return await fn(...args);
}
