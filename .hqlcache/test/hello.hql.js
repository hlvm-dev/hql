import { runHQLFile, getExport } from "file:///Users/seoksoonjang/dev/hql/hql.ts";

const _exports = await runHQLFile("/Users/seoksoonjang/dev/hql/test/hello.hql");


export const chalk = getExport("chalk", _exports);

export const lodash = getExport("lodash", _exports);

export const myvec = getExport("myvec", _exports);

export const mymap = getExport("mymap", _exports);

export const myset = getExport("myset", _exports);

export const pathModule = getExport("pathModule", _exports);

export async function join(...args) {
  const fn = getExport("join", _exports);
  return await fn(...args);
}

export const datetime = getExport("datetime", _exports);

export async function format(...args) {
  const fn = getExport("format", _exports);
  return await fn(...args);
}

export const uuidModule = getExport("uuidModule", _exports);

export const generate = getExport("generate", _exports);

export const arr = getExport("arr", _exports);

export async function add(...args) {
  const fn = getExport("add", _exports);
  return await fn(...args);
}

export async function inc(...args) {
  const fn = getExport("inc", _exports);
  return await fn(...args);
}

export async function addN(...args) {
  const fn = getExport("addN", _exports);
  return await fn(...args);
}

export async function minus(...args) {
  const fn = getExport("minus", _exports);
  return await fn(...args);
}

export async function pureMultiply(...args) {
  const fn = getExport("pureMultiply", _exports);
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

export async function multiply(...args) {
  const fn = getExport("multiply", _exports);
  return await fn(...args);
}

export async function multiply2(...args) {
  const fn = getExport("multiply2", _exports);
  return await fn(...args);
}

export async function send(...args) {
  const fn = getExport("send", _exports);
  return await fn(...args);
}

export async function send2(...args) {
  const fn = getExport("send2", _exports);
  return await fn(...args);
}

export const name = getExport("name", _exports);

export const greeting = getExport("greeting", _exports);
