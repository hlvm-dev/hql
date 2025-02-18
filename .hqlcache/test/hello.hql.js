import { runHQLFile, getExport } from "file:///Users/seoksoonjang/dev/hql/hql.ts";

const _exports = await runHQLFile("/Users/seoksoonjang/dev/hql/test/hello.hql");


export const chalk = getExport("chalk", _exports);

export const lodash = getExport("lodash", _exports);

export const myvec = getExport("myvec", _exports);

export const mymap = getExport("mymap", _exports);

export const myset = getExport("myset", _exports);

export const pathModule = getExport("pathModule", _exports);

export const join = getExport("join", _exports);

export const datetime = getExport("datetime", _exports);

export const format = getExport("format", _exports);

export const uuidModule = getExport("uuidModule", _exports);

export const generate = getExport("generate", _exports);

export const arr = getExport("arr", _exports);

export const add = getExport("add", _exports);

export const inc = getExport("inc", _exports);

export const addN = getExport("addN", _exports);

export const minus = getExport("minus", _exports);

export const pureMultiply = getExport("pureMultiply", _exports);

export const add2 = getExport("add2", _exports);

export const minus2 = getExport("minus2", _exports);

export const multiply = getExport("multiply", _exports);

export const multiply2 = getExport("multiply2", _exports);

export const Destination = getExport("Destination", _exports);

export const send = getExport("send", _exports);

export const send2 = getExport("send2", _exports);

export const name = getExport("name", _exports);

export const greeting = getExport("greeting", _exports);
