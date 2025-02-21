import { exportHqlModules, getHqlModule } from "file:///Users/seoksoonjang/dev/hql/hql.ts";

const _exports = await exportHqlModules("/Users/seoksoonjang/dev/hql/test/interop/module2.hql");


export const mod1 = getHqlModule("mod1", _exports);

export const jsMod = getHqlModule("jsMod", _exports);

export async function doubleAndAdd(...args) {
  const fn = getHqlModule("doubleAndAdd", _exports);
  return await fn(...args);
}

export async function multiply(...args) {
  const fn = getHqlModule("multiply", _exports);
  return await fn(...args);
}

export async function combine(...args) {
  const fn = getHqlModule("combine", _exports);
  return await fn(...args);
}
