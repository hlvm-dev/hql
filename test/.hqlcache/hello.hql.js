import { runHQLFile, getExport } from "./hql.ts";

const _exports = await runHQLFile("/Users/seoksoonjang/dev/hql/test/hello.hql");


export async function add(...args) {
  const fn = getExport("add", _exports);
  return await fn(...args);
}

export async function minus(...args) {
  const fn = getExport("minus", _exports);
  return await fn(...args);
}

export async function add2(...args) {
  const fn = getExport("add2", _exports);
  return await fn(...args);
}

export async function minus2(...args) {
  const fn = getExport("minus2", _exports);
  return await fn(...args);
}
