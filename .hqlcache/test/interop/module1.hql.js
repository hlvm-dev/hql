import { exportHqlModules, getHqlModule } from "file:///Users/seoksoonjang/dev/hql/hql.ts";

const _exports = await exportHqlModules("/Users/seoksoonjang/dev/hql/test/interop/module1.hql");


export const base = getHqlModule("base", _exports);

export async function addBase(...args) {
  const fn = getHqlModule("addBase", _exports);
  return await fn(...args);
}

export async function doubleAndAdd(...args) {
  const fn = getHqlModule("doubleAndAdd", _exports);
  return await fn(...args);
}
