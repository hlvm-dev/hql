import { exportHqlModules, getHqlModule } from "../hql.ts";

const _exports = await exportHqlModules("./hello.hql");


export const chalk = getHqlModule("chalk", _exports);

export const lodash = getHqlModule("lodash", _exports);

export const myvec = getHqlModule("myvec", _exports);

export const mymap = getHqlModule("mymap", _exports);

export const myset = getHqlModule("myset", _exports);

export const pathModule = getHqlModule("pathModule", _exports);

export const join = getHqlModule("join", _exports);

export const datetime = getHqlModule("datetime", _exports);

export const format = getHqlModule("format", _exports);

export const uuidModule = getHqlModule("uuidModule", _exports);

export const generate = getHqlModule("generate", _exports);

export const arr = getHqlModule("arr", _exports);

export const add = getHqlModule("add", _exports);

export const inc = getHqlModule("inc", _exports);

export const addN = getHqlModule("addN", _exports);

export const minus = getHqlModule("minus", _exports);

export const pureMultiply = getHqlModule("pureMultiply", _exports);

export const add2 = getHqlModule("add2", _exports);

export const minus2 = getHqlModule("minus2", _exports);

export const multiply = getHqlModule("multiply", _exports);

export const multiply2 = getHqlModule("multiply2", _exports);

export const Destination = getHqlModule("Destination", _exports);

export const send = getHqlModule("send", _exports);

export const send2 = getHqlModule("send2", _exports);

export const name = getHqlModule("name", _exports);

export const greeting = getHqlModule("greeting", _exports);
