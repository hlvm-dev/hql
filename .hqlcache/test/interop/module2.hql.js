import { runHQLFile, getExport } from "file:///Users/seoksoonjang/dev/hql/hql.ts";

const _exports = await runHQLFile("/Users/seoksoonjang/dev/hql/test/interop/module2.hql");


export const mod1 = getExport("mod1", _exports);

export const jsMod = getExport("jsMod", _exports);

export async function doubleAndAdd(...args) {
  const fn = getExport("doubleAndAdd", _exports);
  return await fn(...args);
}

export async function multiply(...args) {
  const fn = getExport("multiply", _exports);
  return await fn(...args);
}

export async function combine(...args) {
  const fn = getExport("combine", _exports);
  return await fn(...args);
}
