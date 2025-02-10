import { runHQLFile, getExport } from "./hql.ts";

const _exports = await runHQLFile("hello.hql");


export async function addSync(...args) {
  const fn = getExport("addSync", _exports);
  return await fn(...args);
}

export async function minusSync(...args) {
  const fn = getExport("minusSync", _exports);
  return await fn(...args);
}

export async function addDynamic(...args) {
  const fn = getExport("addDynamic", _exports);
  return await fn(...args);
}

export async function minusDynamic(...args) {
  const fn = getExport("minusDynamic", _exports);
  return await fn(...args);
}
