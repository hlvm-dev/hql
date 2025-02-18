import { runHQLFile, getExport } from "file:///Users/seoksoonjang/dev/hql/hql.ts";

const _exports = await runHQLFile("/Users/seoksoonjang/dev/hql/test/interop/module1.hql");


export const base = getExport("base", _exports);

export async function addBase(...args) {
  const fn = getExport("addBase", _exports);
  return await fn(...args);
}

export async function doubleAndAdd(...args) {
  const fn = getExport("doubleAndAdd", _exports);
  return await fn(...args);
}
