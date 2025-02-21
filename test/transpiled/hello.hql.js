import { exportHqlModules, getHqlModule } from "file:///Users/seoksoonjang/dev/hql/hql.ts";

const _exports = await exportHqlModules("/Users/seoksoonjang/dev/hql/test/hello.hql");


export const chalk = getHqlModule("chalk", _exports);

export const lodash = getHqlModule("lodash", _exports);

export const myvec = getHqlModule("myvec", _exports);

export const mymap = getHqlModule("mymap", _exports);

export const myset = getHqlModule("myset", _exports);

export const pathModule = getHqlModule("pathModule", _exports);

export async function join(...args) {
  const fn = getHqlModule("join", _exports);
  return await fn(...args);
}

export const datetime = getHqlModule("datetime", _exports);

export async function format(...args) {
  const fn = getHqlModule("format", _exports);
  return await fn(...args);
}

export const uuidModule = getHqlModule("uuidModule", _exports);

export const generate = getHqlModule("generate", _exports);

export const arr = getHqlModule("arr", _exports);

export async function add(...args) {
  const fn = getHqlModule("add", _exports);
  return await fn(...args);
}

export async function inc(...args) {
  const fn = getHqlModule("inc", _exports);
  return await fn(...args);
}

export async function addN(...args) {
  const fn = getHqlModule("addN", _exports);
  return await fn(...args);
}

export async function minus(...args) {
  const fn = getHqlModule("minus", _exports);
  return await fn(...args);
}

export async function pureMultiply(...args) {
  const fn = getHqlModule("pureMultiply", _exports);
  return await fn(...args);
}

export async function add2(...args) {
  const fn = getHqlModule("add2", _exports);
  return await fn(...args);
}

export async function minus2(...args) {
  const fn = getHqlModule("minus2", _exports);
  return await fn(...args);
}

export async function multiply(...args) {
  const fn = getHqlModule("multiply", _exports);
  return await fn(...args);
}

export async function multiply2(...args) {
  const fn = getHqlModule("multiply2", _exports);
  return await fn(...args);
}

export async function send(...args) {
  const fn = getHqlModule("send", _exports);
  return await fn(...args);
}

export async function send2(...args) {
  const fn = getHqlModule("send2", _exports);
  return await fn(...args);
}

export const name = getHqlModule("name", _exports);

export const greeting = getHqlModule("greeting", _exports);
