// Plain JavaScript module for import testing

export function jsDivide(x, y) {
  return x / y;
}

export function jsConcat(...args) {
  return args.join("-");
}

export const JS_VERSION = "ES6";

export class JsCounter {
  constructor(initial = 0) {
    this.count = initial;
  }

  increment() {
    this.count++;
    return this.count;
  }

  getValue() {
    return this.count;
  }
}
