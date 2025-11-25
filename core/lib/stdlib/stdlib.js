// .hql-cache/1/core/lib/stdlib/js/internal/lazy-seq.js
const PREVIEW_SIZE = 20;
const LazySeq = class {
  constructor(producer) {
    this._producer = producer;
    this._iterator = null;
    this._realized = [];
    this._exhausted = false;
  }
  // Get a specific index, realizing values up to that point
  get(index) {
    this._realize(index + 1);
    return index < this._realized.length ? this._realized[index] : void 0;
  }
  // Convert to array up to a certain size (or all if realized)
  toArray(maxSize = Infinity) {
    if (maxSize === Infinity && this._exhausted) {
      return this._realized.slice();
    }
    this._realize(maxSize);
    return this._realized.slice(0, maxSize);
  }
  // Internal method to realize values up to a certain count
  _realize(count2) {
    if (this._exhausted || this._realized.length >= count2) {
      return;
    }
    if (!this._iterator) {
      this._iterator = this._producer();
    }
    while (this._realized.length < count2 && !this._exhausted) {
      const { value, done } = this._iterator.next();
      if (done) {
        this._exhausted = true;
        break;
      }
      this._realized.push(value);
    }
  }
  // Make the sequence iterable (optimized to avoid repeated get() calls)
  [Symbol.iterator]() {
    let index = 0;
    return {
      next: () => {
        if (index >= this._realized.length && !this._exhausted) {
          this._realize(index + 1);
        }
        if (index < this._realized.length) {
          return { value: this._realized[index++], done: false };
        }
        return { done: true, value: void 0 };
      },
    };
  }
  // Add slice compatibility with normal arrays
  slice(start, end) {
    if (end === void 0) {
      if (!this._exhausted) {
        throw new Error(
          "slice() requires an end parameter for potentially infinite sequences. Use toArray() to realize the entire sequence first, or provide an end index.",
        );
      }
      return this._realized.slice(start);
    }
    this._realize(end);
    return this._realized.slice(start, end);
  }
  // Internal helper: get preview for REPL/serialization
  _getPreview() {
    return this.toArray(PREVIEW_SIZE);
  }
  // Safe toString for REPL printing (shows preview, not full realization)
  toString() {
    const preview = this._getPreview();
    return this._exhausted
      ? JSON.stringify(preview)
      : JSON.stringify(preview) + " ...";
  }
  // JSON serialization (shows preview)
  toJSON() {
    const preview = this._getPreview();
    return this._exhausted
      ? preview
      : { preview, hasMore: true, type: "LazySeq" };
  }
  // Node.js/Deno REPL integration (shows preview as array)
  inspect() {
    const preview = this._getPreview();
    return this._exhausted ? preview : [...preview, "..."];
  }
  // Deno-specific REPL integration
  [Symbol.for("Deno.customInspect")]() {
    return this.inspect();
  }
  // Node.js-specific REPL integration
  [Symbol.for("nodejs.util.inspect.custom")]() {
    return this.inspect();
  }
};
function lazySeq(generatorFn) {
  return new LazySeq(generatorFn);
}
const EMPTY_LAZY_SEQ = lazySeq(function* () {
});

// .hql-cache/1/core/lib/stdlib/js/internal/normalize.js
function normalize(coll) {
  if (coll == null) {
    return null;
  }
  if (Array.isArray(coll)) {
    return coll.length > 0 ? coll : null;
  }
  if (typeof coll === "string") {
    return coll.length > 0 ? coll : null;
  }
  if (coll instanceof LazySeq) {
    coll._realize(1);
    const empty2 = coll._exhausted && coll._realized.length === 0;
    return empty2 ? null : coll;
  }
  return coll;
}

// .hql-cache/1/core/lib/stdlib/js/internal/validators.js
function validateNonNegativeNumber(n, functionName) {
  if (typeof n !== "number" || n < 0 || !Number.isFinite(n)) {
    const valueDesc = typeof n === "number" ? n : `${n} (type: ${typeof n})`;
    throw new TypeError(
      `${functionName}: first argument must be a non-negative finite number, got ${valueDesc}`,
    );
  }
}
function validateFiniteNumber(n, functionName, paramName) {
  if (typeof n !== "number" || !Number.isFinite(n)) {
    throw new TypeError(
      `${functionName}: ${paramName} must be a finite number, got ${typeof n}`,
    );
  }
}
function validateNonZeroNumber(n, functionName, paramName) {
  if (typeof n !== "number" || n === 0 || !Number.isFinite(n)) {
    throw new TypeError(
      `${functionName}: ${paramName} must be a non-zero finite number, got ${typeof n === "number" ? n : typeof n
      }`,
    );
  }
}
function safeStringify(value, maxLength = 50) {
  try {
    const str = JSON.stringify(value);
    return str.length > maxLength ? str.slice(0, maxLength) + "..." : str;
  } catch {
    return Object.prototype.toString.call(value);
  }
}
function validateFunction(f, functionName, paramName = "first argument") {
  if (typeof f !== "function") {
    const valuePreview = typeof f === "object" && f !== null
      ? safeStringify(f)
      : String(f);
    throw new TypeError(
      `${functionName}: ${paramName} must be a function, got ${typeof f} (value: ${valuePreview})`,
    );
  }
}

// .hql-cache/1/core/lib/stdlib/js/core.js
function cons(item, coll) {
  return concat([item], coll);
}
function count(coll) {
  if (coll == null) {
    return 0;
  }
  if (Array.isArray(coll) || typeof coll === "string") {
    return coll.length;
  }
  if (coll instanceof Set || coll instanceof Map) {
    return coll.size;
  }
  if (coll instanceof LazySeq) {
    coll._realize(Infinity);
    return coll._realized.length;
  }
  let n = 0;
  for (const _ of coll) {
    n++;
  }
  return n;
}
function last(coll) {
  if (coll == null) {
    return null;
  }
  if (Array.isArray(coll)) {
    return coll.length > 0 ? coll[coll.length - 1] : null;
  }
  if (typeof coll === "string") {
    return coll.length > 0 ? coll[coll.length - 1] : null;
  }
  if (coll instanceof LazySeq) {
    coll._realize(Infinity);
    return coll._realized.length > 0
      ? coll._realized[coll._realized.length - 1]
      : null;
  }
  let lastItem = null;
  for (const item of coll) {
    lastItem = item;
  }
  return lastItem;
}
function isEmpty(coll) {
  return normalize(coll) === null;
}
function some(pred, coll) {
  validateFunction(pred, "some", "predicate");
  if (coll == null) {
    return null;
  }
  if (Array.isArray(coll)) {
    for (let i = 0; i < coll.length; i++) {
      if (pred(coll[i])) {
        return coll[i];
      }
    }
    return null;
  }
  for (const item of coll) {
    if (pred(item)) {
      return item;
    }
  }
  return null;
}
function take(n, coll) {
  validateNonNegativeNumber(n, "take");
  if (coll == null) {
    return EMPTY_LAZY_SEQ;
  }
  if (Array.isArray(coll)) {
    const limit = Math.min(n, coll.length);
    if (limit === 0) {
      return EMPTY_LAZY_SEQ;
    }
    return lazySeq(function* () {
      for (let i = 0; i < limit; i++) {
        yield coll[i];
      }
    });
  }
  return lazySeq(function* () {
    let count2 = 0;
    const iterator = coll[Symbol.iterator]();
    while (count2 < n) {
      const { value, done } = iterator.next();
      if (done) {
        break;
      }
      yield value;
      count2++;
    }
  });
}
function drop(n, coll) {
  validateNonNegativeNumber(n, "drop");
  if (coll == null) {
    return EMPTY_LAZY_SEQ;
  }
  if (Array.isArray(coll)) {
    if (n >= coll.length) {
      return EMPTY_LAZY_SEQ;
    }
    return lazySeq(function* () {
      for (let i = n; i < coll.length; i++) {
        yield coll[i];
      }
    });
  }
  return lazySeq(function* () {
    let count2 = 0;
    for (const item of coll) {
      if (count2 >= n) {
        yield item;
      }
      count2++;
    }
  });
}
function map(f, coll) {
  validateFunction(f, "map");
  if (coll == null) {
    return EMPTY_LAZY_SEQ;
  }
  if (Array.isArray(coll)) {
    return lazySeq(function* () {
      for (let i = 0; i < coll.length; i++) {
        yield f(coll[i]);
      }
    });
  }
  return lazySeq(function* () {
    for (const item of coll) {
      yield f(item);
    }
  });
}
function filter(pred, coll) {
  validateFunction(pred, "filter", "predicate");
  if (coll == null) {
    return EMPTY_LAZY_SEQ;
  }
  if (Array.isArray(coll)) {
    return lazySeq(function* () {
      for (let i = 0; i < coll.length; i++) {
        if (pred(coll[i])) {
          yield coll[i];
        }
      }
    });
  }
  return lazySeq(function* () {
    for (const item of coll) {
      if (pred(item)) {
        yield item;
      }
    }
  });
}
function reduce(f, init, coll) {
  validateFunction(f, "reduce", "reducer");
  if (coll == null) {
    return init;
  }
  if (Array.isArray(coll)) {
    let acc2 = init;
    for (let i = 0; i < coll.length; i++) {
      acc2 = f(acc2, coll[i]);
    }
    return acc2;
  }
  let acc = init;
  for (const item of coll) {
    acc = f(acc, item);
  }
  return acc;
}
function concat(...colls) {
  return lazySeq(function* () {
    for (const coll of colls) {
      if (coll != null) {
        for (const item of coll) {
          yield item;
        }
      }
    }
  });
}
function flatten(coll) {
  if (coll == null) {
    return EMPTY_LAZY_SEQ;
  }
  return lazySeq(function* () {
    for (const item of coll) {
      if (
        item != null && typeof item !== "string" &&
        typeof item[Symbol.iterator] === "function"
      ) {
        for (const nested of item) {
          yield nested;
        }
      } else {
        yield item;
      }
    }
  });
}
function distinct(coll) {
  if (coll == null) {
    return EMPTY_LAZY_SEQ;
  }
  return lazySeq(function* () {
    const seen = /* @__PURE__ */ new Set();
    for (const item of coll) {
      if (!seen.has(item)) {
        seen.add(item);
        yield item;
      }
    }
  });
}
function mapIndexed(f, coll) {
  validateFunction(f, "mapIndexed", "indexing function");
  if (coll == null) {
    return EMPTY_LAZY_SEQ;
  }
  if (Array.isArray(coll)) {
    return lazySeq(function* () {
      for (let i = 0; i < coll.length; i++) {
        yield f(i, coll[i]);
      }
    });
  }
  return lazySeq(function* () {
    let i = 0;
    for (const item of coll) {
      yield f(i, item);
      i++;
    }
  });
}
function keepIndexed(f, coll) {
  validateFunction(f, "keepIndexed", "indexing function");
  if (coll == null) {
    return EMPTY_LAZY_SEQ;
  }
  if (Array.isArray(coll)) {
    return lazySeq(function* () {
      for (let i = 0; i < coll.length; i++) {
        const result = f(i, coll[i]);
        if (result != null) {
          yield result;
        }
      }
    });
  }
  return lazySeq(function* () {
    let i = 0;
    for (const item of coll) {
      const result = f(i, item);
      if (result != null) {
        yield result;
      }
      i++;
    }
  });
}
function mapcat(f, coll) {
  validateFunction(f, "mapcat", "mapping function");
  if (coll == null) {
    return EMPTY_LAZY_SEQ;
  }
  return lazySeq(function* () {
    for (const item of coll) {
      const result = f(item);
      if (result == null) {
        continue;
      }
      if (typeof result[Symbol.iterator] !== "function") {
        throw new TypeError(
          `mapcat: mapping function must return iterable, got ${typeof result}`,
        );
      }
      for (const nested of result) {
        yield nested;
      }
    }
  });
}
function keep(f, coll) {
  validateFunction(f, "keep", "mapping function");
  if (coll == null) {
    return EMPTY_LAZY_SEQ;
  }
  if (Array.isArray(coll)) {
    return lazySeq(function* () {
      for (let i = 0; i < coll.length; i++) {
        const result = f(coll[i]);
        if (result != null) {
          yield result;
        }
      }
    });
  }
  return lazySeq(function* () {
    for (const item of coll) {
      const result = f(item);
      if (result != null) {
        yield result;
      }
    }
  });
}
function range(start, end, step = 1) {
  validateNonZeroNumber(step, "range", "step");
  if (start === void 0) {
    return lazySeq(function* () {
      let i = 0;
      while (true) {
        yield i;
        i += step;
      }
    });
  }
  validateFiniteNumber(start, "range", "start");
  if (end === void 0) {
    end = start;
    start = 0;
  } else {
    if (typeof end !== "number") {
      throw new TypeError(`range: end must be a number, got ${typeof end}`);
    }
  }
  return lazySeq(function* () {
    if (step > 0) {
      for (let i = start; i < end; i += step) {
        yield i;
      }
    } else {
      for (let i = start; i > end; i += step) {
        yield i;
      }
    }
  });
}
function iterate(f, x) {
  validateFunction(f, "iterate", "iterator function");
  return lazySeq(function* () {
    let current = x;
    while (true) {
      yield current;
      current = f(current);
    }
  });
}
function comp(...fns) {
  fns.forEach((fn, i) => {
    validateFunction(fn, "comp", `argument ${i + 1}`);
  });
  if (fns.length === 0) {
    return (x) => x;
  }
  if (fns.length === 1) {
    return fns[0];
  }
  return function (...args) {
    let result = fns[fns.length - 1](...args);
    for (let i = fns.length - 2; i >= 0; i--) {
      result = fns[i](result);
    }
    return result;
  };
}
function partial(f, ...args) {
  validateFunction(f, "partial", "function");
  return function (...moreArgs) {
    return f(...args, ...moreArgs);
  };
}
function apply(f, args) {
  validateFunction(f, "apply", "function");
  if (args == null || typeof args[Symbol.iterator] !== "function") {
    throw new TypeError(
      `apply: second argument must be iterable, got ${typeof args}`,
    );
  }
  const argsArray = Array.isArray(args) ? args : Array.from(args);
  return f(...argsArray);
}
function groupBy(f, coll) {
  validateFunction(f, "groupBy", "key function");
  if (coll == null) {
    return /* @__PURE__ */ new Map();
  }
  const result = /* @__PURE__ */ new Map();
  for (const item of coll) {
    const key = f(item);
    if (!result.has(key)) {
      result.set(key, []);
    }
    result.get(key).push(item);
  }
  return result;
}
function keys(obj) {
  if (obj == null) {
    return [];
  }
  return Object.keys(obj);
}
function doall(coll) {
  if (coll == null) {
    return [];
  }
  if (Array.isArray(coll)) {
    return coll;
  }
  return Array.from(coll);
}
function realized(coll) {
  if (coll == null) {
    return true;
  }
  if (coll instanceof LazySeq) {
    return coll._exhausted;
  }
  return true;
}
function empty(coll) {
  if (coll == null) {
    return null;
  }
  if (Array.isArray(coll)) {
    return [];
  }
  if (typeof coll === "string") {
    return "";
  }
  if (coll instanceof LazySeq) {
    return EMPTY_LAZY_SEQ;
  }
  if (coll instanceof Set) {
    return /* @__PURE__ */ new Set();
  }
  if (coll instanceof Map) {
    return /* @__PURE__ */ new Map();
  }
  if (typeof coll === "object") {
    return {};
  }
  throw new TypeError(`Cannot create empty collection from ${typeof coll}`);
}
function conj(coll, ...items) {
  if (items.length === 0) {
    return coll == null ? [] : coll;
  }
  if (coll == null) {
    return [...items];
  }
  if (Array.isArray(coll)) {
    return [...coll, ...items];
  }
  if (typeof coll === "string") {
    return coll + items.join("");
  }
  if (coll instanceof LazySeq) {
    let result = coll;
    for (let i = items.length - 1; i >= 0; i--) {
      result = cons(items[i], result);
    }
    return result;
  }
  if (coll instanceof Set) {
    const result = new Set(coll);
    for (const item of items) {
      result.add(item);
    }
    return result;
  }
  if (coll instanceof Map) {
    const result = new Map(coll);
    for (const item of items) {
      if (!Array.isArray(item) || item.length !== 2) {
        throw new TypeError(
          `Map entries must be [key, value] pairs, got ${typeof item}`,
        );
      }
      result.set(item[0], item[1]);
    }
    return result;
  }
  if (typeof coll === "object") {
    const result = { ...coll };
    for (const item of items) {
      if (!Array.isArray(item) || item.length !== 2) {
        throw new TypeError(
          `Object entries must be [key, value] pairs, got ${typeof item}`,
        );
      }
      result[item[0]] = item[1];
    }
    return result;
  }
  throw new TypeError(`Cannot conj to ${typeof coll}`);
}
function into(to, from) {
  if (from == null) {
    return to == null ? [] : to;
  }
  return reduce((acc, item) => conj(acc, item), to, from);
}
function repeatedly(f) {
  validateFunction(f, "repeatedly", "generator function");
  return lazySeq(function* () {
    while (true) {
      yield f();
    }
  });
}
function cycle(coll) {
  if (coll == null) {
    return EMPTY_LAZY_SEQ;
  }
  const items = Array.from(coll);
  if (items.length === 0) {
    return EMPTY_LAZY_SEQ;
  }
  return lazySeq(function* () {
    while (true) {
      for (const item of items) {
        yield item;
      }
    }
  });
}
function every(pred, coll) {
  validateFunction(pred, "every", "predicate");
  if (coll == null) {
    return true;
  }
  if (Array.isArray(coll)) {
    for (let i = 0; i < coll.length; i++) {
      if (!pred(coll[i])) {
        return false;
      }
    }
    return true;
  }
  for (const item of coll) {
    if (!pred(item)) {
      return false;
    }
  }
  return true;
}
function notAny(pred, coll) {
  validateFunction(pred, "notAny", "predicate");
  if (coll == null) {
    return true;
  }
  if (Array.isArray(coll)) {
    for (let i = 0; i < coll.length; i++) {
      if (pred(coll[i])) {
        return false;
      }
    }
    return true;
  }
  for (const item of coll) {
    if (pred(item)) {
      return false;
    }
  }
  return true;
}
function notEvery(pred, coll) {
  validateFunction(pred, "notEvery", "predicate");
  if (coll == null) {
    return false;
  }
  if (Array.isArray(coll)) {
    for (let i = 0; i < coll.length; i++) {
      if (!pred(coll[i])) {
        return true;
      }
    }
    return false;
  }
  for (const item of coll) {
    if (!pred(item)) {
      return true;
    }
  }
  return false;
}
function isSome(x) {
  return x != null;
}
function get(map2, key, notFound = void 0) {
  if (map2 == null) {
    return notFound;
  }
  if (map2 instanceof Map) {
    return map2.has(key) ? map2.get(key) : notFound;
  }
  return key in map2 ? map2[key] : notFound;
}
function getIn(map2, path, notFound = void 0) {
  if (path.length === 0) {
    return map2;
  }
  let current = map2;
  for (const key of path) {
    current = get(current, key, null);
    if (current == null) {
      return notFound;
    }
  }
  return current;
}
function assoc(map2, key, value) {
  if (map2 == null) {
    if (typeof key === "number") {
      const arr = [];
      arr[key] = value;
      return arr;
    }
    return { [key]: value };
  }
  if (map2 instanceof Map) {
    const result = new Map(map2);
    result.set(key, value);
    return result;
  }
  if (Array.isArray(map2)) {
    const result = [...map2];
    result[key] = value;
    return result;
  }
  return { ...map2, [key]: value };
}
function assocIn(map2, path, value) {
  if (path.length === 0) {
    return value;
  }
  if (path.length === 1) {
    return assoc(map2, path[0], value);
  }
  const [key, ...restPath] = path;
  const existing = get(map2 == null ? {} : map2, key);
  let nested;
  if (existing != null && typeof existing === "object") {
    nested = existing;
  } else {
    const nextKey = restPath[0];
    nested = typeof nextKey === "number" ? [] : {};
  }
  return assoc(map2 == null ? {} : map2, key, assocIn(nested, restPath, value));
}
function dissoc(map2, ...keys2) {
  if (map2 == null) {
    return {};
  }
  if (map2 instanceof Map) {
    const result2 = new Map(map2);
    for (const key of keys2) {
      result2.delete(key);
    }
    return result2;
  }
  if (Array.isArray(map2)) {
    const result2 = [...map2];
    for (const key of keys2) {
      delete result2[key];
    }
    return result2;
  }
  const result = { ...map2 };
  for (const key of keys2) {
    delete result[key];
  }
  return result;
}
function update(map2, key, fn) {
  validateFunction(fn, "update", "transform function");
  const currentValue = get(map2, key);
  return assoc(map2, key, fn(currentValue));
}
function updateIn(map2, path, fn) {
  validateFunction(fn, "updateIn", "transform function");
  if (path.length === 0) {
    return fn(map2);
  }
  const currentValue = getIn(map2, path);
  return assocIn(map2, path, fn(currentValue));
}
function merge(...maps) {
  const nonNilMaps = maps.filter((m) => m != null);
  if (nonNilMaps.length === 0) {
    return {};
  }
  const firstMap = nonNilMaps[0];
  if (firstMap instanceof Map) {
    const result = /* @__PURE__ */ new Map();
    for (const m of nonNilMaps) {
      if (m instanceof Map) {
        for (const [k, v] of m) {
          result.set(k, v);
        }
      }
    }
    return result;
  }
  return Object.assign({}, ...nonNilMaps);
}
function vec(coll) {
  if (coll == null) {
    return [];
  }
  return Array.from(coll);
}

// .hql-cache/1/core/lib/stdlib/js/index.js
const rangeGenerator = range;

// .hql-cache/1/core/lib/stdlib/stdlib.ts
const range2 = typeof __hql_callFn === "function"
  ? __hql_callFn.call(void 0, __hql_deepFreeze, void 0, rangeGenerator)
  : __hql_deepFreeze(rangeGenerator);
export {
  apply,
  assoc,
  assocIn,
  comp,
  concat,
  conj,
  count,
  cycle,
  dissoc,
  distinct,
  doall,
  drop,
  empty,
  every,
  filter,
  flatten,
  get,
  getIn,
  groupBy,
  into,
  isEmpty,
  isSome,
  iterate,
  keep,
  keepIndexed,
  keys,
  last,
  lazySeq,
  map,
  mapcat,
  mapIndexed,
  merge,
  notAny,
  notEvery,
  partial,
  range2 as range,
  rangeGenerator,
  realized,
  reduce,
  repeatedly,
  some,
  take,
  update,
  updateIn,
  vec,
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vLi4vLi4vLmhxbC1jYWNoZS8xL2NvcmUvbGliL3N0ZGxpYi9qcy9pbnRlcm5hbC9sYXp5LXNlcS5qcyIsICIuLi8uLi8uLi8uaHFsLWNhY2hlLzEvY29yZS9saWIvc3RkbGliL2pzL2ludGVybmFsL25vcm1hbGl6ZS5qcyIsICIuLi8uLi8uLi8uaHFsLWNhY2hlLzEvY29yZS9saWIvc3RkbGliL2pzL2ludGVybmFsL3ZhbGlkYXRvcnMuanMiLCAiLi4vLi4vLi4vLmhxbC1jYWNoZS8xL2NvcmUvbGliL3N0ZGxpYi9qcy9jb3JlLmpzIiwgIi4uLy4uLy4uLy5ocWwtY2FjaGUvMS9jb3JlL2xpYi9zdGRsaWIvanMvaW5kZXguanMiLCAiLi4vLi4vLi4vLmhxbC1jYWNoZS8xL2NvcmUvbGliL3N0ZGxpYi9zdGRsaWIudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbIi8vIGludGVybmFsL2xhenktc2VxLmpzIC0gTGF6eVNlcSBpbXBsZW1lbnRhdGlvblxuLy8gSW50ZXJuYWwgaW1wbGVtZW50YXRpb24gZGV0YWlsLCBub3QgcGFydCBvZiBwdWJsaWMgQVBJXG5cbi8vIFx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVxuLy8gQ09OU1RBTlRTXG4vLyBcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcblxuY29uc3QgUFJFVklFV19TSVpFID0gMjA7IC8vIE51bWJlciBvZiBpdGVtcyB0byBzaG93IGluIFJFUEwvdG9TdHJpbmdcblxuLy8gXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXG4vLyBMQVpZU0VRIENMQVNTXG4vLyBcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcblxuLyoqXG4gKiBMYXp5U2VxIC0gQSBjbGFzcyByZXByZXNlbnRpbmcgYSBsYXp5IHNlcXVlbmNlXG4gKlxuICogSW1wbGVtZW50cyBDbG9qdXJlLXN0eWxlIGxhenkgZXZhbHVhdGlvbjpcbiAqIC0gVmFsdWVzIGNvbXB1dGVkIG9uIGRlbWFuZFxuICogLSBSZXN1bHRzIG1lbW9pemVkIChjYWNoZWQpXG4gKiAtIFNpbmdsZSBpdGVyYXRvciByZXVzZWRcbiAqIC0gU3VwcG9ydHMgaW5maW5pdGUgc2VxdWVuY2VzXG4gKi9cbmV4cG9ydCBjbGFzcyBMYXp5U2VxIHtcbiAgY29uc3RydWN0b3IocHJvZHVjZXIpIHtcbiAgICB0aGlzLl9wcm9kdWNlciA9IHByb2R1Y2VyOyAvLyBGdW5jdGlvbiB0aGF0IGdlbmVyYXRlcyB2YWx1ZXNcbiAgICB0aGlzLl9pdGVyYXRvciA9IG51bGw7IC8vIFNpbmdsZSBpdGVyYXRvciBpbnN0YW5jZSAoY3JlYXRlZCBsYXppbHkpXG4gICAgdGhpcy5fcmVhbGl6ZWQgPSBbXTsgLy8gQ2FjaGUgb2YgcmVhbGl6ZWQgdmFsdWVzXG4gICAgdGhpcy5fZXhoYXVzdGVkID0gZmFsc2U7IC8vIFRyYWNrIGlmIHdlJ3ZlIHJlYWNoZWQgdGhlIGVuZFxuICB9XG5cbiAgLy8gR2V0IGEgc3BlY2lmaWMgaW5kZXgsIHJlYWxpemluZyB2YWx1ZXMgdXAgdG8gdGhhdCBwb2ludFxuICBnZXQoaW5kZXgpIHtcbiAgICB0aGlzLl9yZWFsaXplKGluZGV4ICsgMSk7XG4gICAgcmV0dXJuIGluZGV4IDwgdGhpcy5fcmVhbGl6ZWQubGVuZ3RoID8gdGhpcy5fcmVhbGl6ZWRbaW5kZXhdIDogdW5kZWZpbmVkO1xuICB9XG5cbiAgLy8gQ29udmVydCB0byBhcnJheSB1cCB0byBhIGNlcnRhaW4gc2l6ZSAob3IgYWxsIGlmIHJlYWxpemVkKVxuICB0b0FycmF5KG1heFNpemUgPSBJbmZpbml0eSkge1xuICAgIGlmIChtYXhTaXplID09PSBJbmZpbml0eSAmJiB0aGlzLl9leGhhdXN0ZWQpIHtcbiAgICAgIHJldHVybiB0aGlzLl9yZWFsaXplZC5zbGljZSgpO1xuICAgIH1cbiAgICB0aGlzLl9yZWFsaXplKG1heFNpemUpO1xuICAgIHJldHVybiB0aGlzLl9yZWFsaXplZC5zbGljZSgwLCBtYXhTaXplKTtcbiAgfVxuXG4gIC8vIEludGVybmFsIG1ldGhvZCB0byByZWFsaXplIHZhbHVlcyB1cCB0byBhIGNlcnRhaW4gY291bnRcbiAgX3JlYWxpemUoY291bnQpIHtcbiAgICBpZiAodGhpcy5fZXhoYXVzdGVkIHx8IHRoaXMuX3JlYWxpemVkLmxlbmd0aCA+PSBjb3VudCkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIC8vIENyZWF0ZSBpdGVyYXRvciBvbmx5IG9uY2UsIHRoZW4gcmV1c2UgaXRcbiAgICBpZiAoIXRoaXMuX2l0ZXJhdG9yKSB7XG4gICAgICB0aGlzLl9pdGVyYXRvciA9IHRoaXMuX3Byb2R1Y2VyKCk7XG4gICAgfVxuXG4gICAgd2hpbGUgKHRoaXMuX3JlYWxpemVkLmxlbmd0aCA8IGNvdW50ICYmICF0aGlzLl9leGhhdXN0ZWQpIHtcbiAgICAgIGNvbnN0IHsgdmFsdWUsIGRvbmUgfSA9IHRoaXMuX2l0ZXJhdG9yLm5leHQoKTtcbiAgICAgIGlmIChkb25lKSB7XG4gICAgICAgIHRoaXMuX2V4aGF1c3RlZCA9IHRydWU7XG4gICAgICAgIGJyZWFrO1xuICAgICAgfVxuICAgICAgdGhpcy5fcmVhbGl6ZWQucHVzaCh2YWx1ZSk7XG4gICAgfVxuICB9XG5cbiAgLy8gTWFrZSB0aGUgc2VxdWVuY2UgaXRlcmFibGUgKG9wdGltaXplZCB0byBhdm9pZCByZXBlYXRlZCBnZXQoKSBjYWxscylcbiAgW1N5bWJvbC5pdGVyYXRvcl0oKSB7XG4gICAgbGV0IGluZGV4ID0gMDtcbiAgICByZXR1cm4ge1xuICAgICAgbmV4dDogKCkgPT4ge1xuICAgICAgICAvLyBSZWFsaXplIG9uZSBtb3JlIGVsZW1lbnQgaWYgbmVlZGVkIGFuZCBub3QgZXhoYXVzdGVkXG4gICAgICAgIGlmIChpbmRleCA+PSB0aGlzLl9yZWFsaXplZC5sZW5ndGggJiYgIXRoaXMuX2V4aGF1c3RlZCkge1xuICAgICAgICAgIHRoaXMuX3JlYWxpemUoaW5kZXggKyAxKTtcbiAgICAgICAgfVxuICAgICAgICAvLyBSZXR1cm4gY3VycmVudCBlbGVtZW50IGlmIGF2YWlsYWJsZVxuICAgICAgICBpZiAoaW5kZXggPCB0aGlzLl9yZWFsaXplZC5sZW5ndGgpIHtcbiAgICAgICAgICByZXR1cm4geyB2YWx1ZTogdGhpcy5fcmVhbGl6ZWRbaW5kZXgrK10sIGRvbmU6IGZhbHNlIH07XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHsgZG9uZTogdHJ1ZSwgdmFsdWU6IHVuZGVmaW5lZCB9O1xuICAgICAgfVxuICAgIH07XG4gIH1cblxuICAvLyBBZGQgc2xpY2UgY29tcGF0aWJpbGl0eSB3aXRoIG5vcm1hbCBhcnJheXNcbiAgc2xpY2Uoc3RhcnQsIGVuZCkge1xuICAgIGlmIChlbmQgPT09IHVuZGVmaW5lZCkge1xuICAgICAgLy8gQ1JJVElDQUwgRklYOiBDYW5ub3Qgc2xpY2UgaW5maW5pdGUgc2VxdWVuY2VzIHdpdGhvdXQgYW4gZW5kXG4gICAgICAvLyBNdXN0IHJlYWxpemUgZW50aXJlIHNlcXVlbmNlIGZpcnN0LCB3aGljaCBmYWlscyBmb3IgaW5maW5pdGUgc2VxdWVuY2VzXG4gICAgICBpZiAoIXRoaXMuX2V4aGF1c3RlZCkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICAgICAgXCJzbGljZSgpIHJlcXVpcmVzIGFuIGVuZCBwYXJhbWV0ZXIgZm9yIHBvdGVudGlhbGx5IGluZmluaXRlIHNlcXVlbmNlcy4gXCIgK1xuICAgICAgICAgIFwiVXNlIHRvQXJyYXkoKSB0byByZWFsaXplIHRoZSBlbnRpcmUgc2VxdWVuY2UgZmlyc3QsIG9yIHByb3ZpZGUgYW4gZW5kIGluZGV4LlwiXG4gICAgICAgICk7XG4gICAgICB9XG4gICAgICAvLyBTZXF1ZW5jZSBpcyBleGhhdXN0ZWQsIHNhZmUgdG8gc2xpY2VcbiAgICAgIHJldHVybiB0aGlzLl9yZWFsaXplZC5zbGljZShzdGFydCk7XG4gICAgfVxuICAgIHRoaXMuX3JlYWxpemUoZW5kKTtcbiAgICByZXR1cm4gdGhpcy5fcmVhbGl6ZWQuc2xpY2Uoc3RhcnQsIGVuZCk7XG4gIH1cblxuICAvLyBJbnRlcm5hbCBoZWxwZXI6IGdldCBwcmV2aWV3IGZvciBSRVBML3NlcmlhbGl6YXRpb25cbiAgX2dldFByZXZpZXcoKSB7XG4gICAgcmV0dXJuIHRoaXMudG9BcnJheShQUkVWSUVXX1NJWkUpO1xuICB9XG5cbiAgLy8gU2FmZSB0b1N0cmluZyBmb3IgUkVQTCBwcmludGluZyAoc2hvd3MgcHJldmlldywgbm90IGZ1bGwgcmVhbGl6YXRpb24pXG4gIHRvU3RyaW5nKCkge1xuICAgIGNvbnN0IHByZXZpZXcgPSB0aGlzLl9nZXRQcmV2aWV3KCk7XG4gICAgcmV0dXJuIHRoaXMuX2V4aGF1c3RlZFxuICAgICAgPyBKU09OLnN0cmluZ2lmeShwcmV2aWV3KVxuICAgICAgOiBKU09OLnN0cmluZ2lmeShwcmV2aWV3KSArIFwiIC4uLlwiO1xuICB9XG5cbiAgLy8gSlNPTiBzZXJpYWxpemF0aW9uIChzaG93cyBwcmV2aWV3KVxuICB0b0pTT04oKSB7XG4gICAgY29uc3QgcHJldmlldyA9IHRoaXMuX2dldFByZXZpZXcoKTtcbiAgICByZXR1cm4gdGhpcy5fZXhoYXVzdGVkXG4gICAgICA/IHByZXZpZXdcbiAgICAgIDogeyBwcmV2aWV3LCBoYXNNb3JlOiB0cnVlLCB0eXBlOiBcIkxhenlTZXFcIiB9O1xuICB9XG5cbiAgLy8gTm9kZS5qcy9EZW5vIFJFUEwgaW50ZWdyYXRpb24gKHNob3dzIHByZXZpZXcgYXMgYXJyYXkpXG4gIGluc3BlY3QoKSB7XG4gICAgY29uc3QgcHJldmlldyA9IHRoaXMuX2dldFByZXZpZXcoKTtcbiAgICByZXR1cm4gdGhpcy5fZXhoYXVzdGVkID8gcHJldmlldyA6IFsuLi5wcmV2aWV3LCBcIi4uLlwiXTtcbiAgfVxuXG4gIC8vIERlbm8tc3BlY2lmaWMgUkVQTCBpbnRlZ3JhdGlvblxuICBbU3ltYm9sLmZvcignRGVuby5jdXN0b21JbnNwZWN0JyldKCkge1xuICAgIHJldHVybiB0aGlzLmluc3BlY3QoKTtcbiAgfVxuXG4gIC8vIE5vZGUuanMtc3BlY2lmaWMgUkVQTCBpbnRlZ3JhdGlvblxuICBbU3ltYm9sLmZvcignbm9kZWpzLnV0aWwuaW5zcGVjdC5jdXN0b20nKV0oKSB7XG4gICAgcmV0dXJuIHRoaXMuaW5zcGVjdCgpO1xuICB9XG59XG5cbi8qKlxuICogQ3JlYXRlIGEgbGF6eSBzZXF1ZW5jZSBmcm9tIGEgZ2VuZXJhdG9yIGZ1bmN0aW9uXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBsYXp5U2VxKGdlbmVyYXRvckZuKSB7XG4gIHJldHVybiBuZXcgTGF6eVNlcShnZW5lcmF0b3JGbik7XG59XG5cbi8qKlxuICogU2luZ2xldG9uIGVtcHR5IExhenlTZXEgLSByZXVzZWQgdG8gYXZvaWQgY3JlYXRpbmcgd2FzdGVmdWwgZW1wdHkgZ2VuZXJhdG9yc1xuICovXG5leHBvcnQgY29uc3QgRU1QVFlfTEFaWV9TRVEgPSBsYXp5U2VxKGZ1bmN0aW9uKiAoKSB7fSk7XG4iLCAiLy8gaW50ZXJuYWwvbm9ybWFsaXplLmpzIC0gSW50ZXJuYWwgaGVscGVyIGZvciBjb2xsZWN0aW9uIG5vcm1hbGl6YXRpb25cbi8vIE5PVEU6IFRoaXMgaXMgTk9UIHRoZSBwdWJsaWMgc2VxKCkgQVBJIChzZWUgV2VlayAzKVxuLy8gUHVycG9zZTogRFJZIGhlbHBlciBmb3IgdHlwZSBjaGVja2luZyBhY3Jvc3Mgc3RkbGliIGZ1bmN0aW9uc1xuXG5pbXBvcnQgeyBMYXp5U2VxIH0gZnJvbSAnLi9sYXp5LXNlcS5qcyc7XG5cbi8qKlxuICogTm9ybWFsaXplcyBhbnkgY29sbGVjdGlvbiBmb3IgdHlwZSBjaGVja2luZy5cbiAqIFJldHVybnMgbnVsbCBmb3IgbmlsL2VtcHR5IGNvbGxlY3Rpb25zLCBlbHNlIHJldHVybnMgY29sbGVjdGlvbiBhcy1pcy5cbiAqXG4gKiBJTlRFUk5BTCBVU0UgT05MWSAtIE5PVCBwYXJ0IG9mIHB1YmxpYyBBUEkhXG4gKlxuICogVGhpcyBoZWxwZXIgcHJvdmlkZXMgY29uc2lzdGVudCBoYW5kbGluZyBvZjpcbiAqIC0gbnVsbC91bmRlZmluZWQgXHUyMTkyIG51bGxcbiAqIC0gRW1wdHkgYXJyYXlzL3N0cmluZ3MgXHUyMTkyIG51bGxcbiAqIC0gRW1wdHkgTGF6eVNlcSBcdTIxOTIgbnVsbCAoYWZ0ZXIgcGVla2luZyBmaXJzdCBlbGVtZW50KVxuICogLSBOb24tZW1wdHkgY29sbGVjdGlvbnMgXHUyMTkyIHJldHVybmVkIGFzLWlzXG4gKlxuICogTmFtZWQgXCJub3JtYWxpemVcIiAobm90IFwic2VxXCIpIHRvIGF2b2lkIGNvbmZ1c2lvbiB3aXRoIFdlZWsgMydzIHB1YmxpYyBzZXEoKSBBUEk6XG4gKiAtIG5vcm1hbGl6ZSgpOiBSZXR1cm5zIG51bGwgZm9yIGVtcHR5LCBjb2xsZWN0aW9uLWFzLWlzIGZvciBub24tZW1wdHkgKGludGVybmFsKVxuICogLSBzZXEoKTogV3JhcHMgY29sbGVjdGlvbiBpbiBMYXp5U2VxIChwdWJsaWMgQVBJLCBXZWVrIDMpXG4gKlxuICogQHBhcmFtIHsqfSBjb2xsIC0gQ29sbGVjdGlvbiB0byBub3JtYWxpemVcbiAqIEByZXR1cm5zIHsqfSAtIG51bGwgaWYgZW1wdHkvbmlsLCBlbHNlIHRoZSBjb2xsZWN0aW9uIGFzLWlzXG4gKlxuICogQGV4YW1wbGVcbiAqIG5vcm1hbGl6ZShudWxsKSAvLyBcdTIxOTIgbnVsbFxuICogbm9ybWFsaXplKFtdKSAvLyBcdTIxOTIgbnVsbFxuICogbm9ybWFsaXplKFsxLCAyLCAzXSkgLy8gXHUyMTkyIFsxLCAyLCAzXVxuICogbm9ybWFsaXplKGxhenlTZXEoZnVuY3Rpb24qICgpIHt9KSkgLy8gXHUyMTkyIG51bGwgKGVtcHR5IExhenlTZXEpXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBub3JtYWxpemUoY29sbCkge1xuICAvLyBOaWwvdW5kZWZpbmVkIFx1MjE5MiBudWxsXG4gIGlmIChjb2xsID09IG51bGwpIHJldHVybiBudWxsO1xuXG4gIC8vIEVtcHR5IGFycmF5IFx1MjE5MiBudWxsLCBub24tZW1wdHkgXHUyMTkyIGFzLWlzXG4gIGlmIChBcnJheS5pc0FycmF5KGNvbGwpKSB7XG4gICAgcmV0dXJuIGNvbGwubGVuZ3RoID4gMCA/IGNvbGwgOiBudWxsO1xuICB9XG5cbiAgLy8gRW1wdHkgc3RyaW5nIFx1MjE5MiBudWxsLCBub24tZW1wdHkgXHUyMTkyIGFzLWlzXG4gIGlmICh0eXBlb2YgY29sbCA9PT0gJ3N0cmluZycpIHtcbiAgICByZXR1cm4gY29sbC5sZW5ndGggPiAwID8gY29sbCA6IG51bGw7XG4gIH1cblxuICAvLyBMYXp5U2VxOiBQZWVrIGZpcnN0IGVsZW1lbnQgdG8gY2hlY2sgaWYgdHJ1bHkgZW1wdHlcbiAgaWYgKGNvbGwgaW5zdGFuY2VvZiBMYXp5U2VxKSB7XG4gICAgY29sbC5fcmVhbGl6ZSgxKTsgIC8vIFJlYWxpemUgdXAgdG8gMSBlbGVtZW50XG4gICAgY29uc3QgZW1wdHkgPSBjb2xsLl9leGhhdXN0ZWQgJiYgY29sbC5fcmVhbGl6ZWQubGVuZ3RoID09PSAwO1xuICAgIHJldHVybiBlbXB0eSA/IG51bGwgOiBjb2xsO1xuICB9XG5cbiAgLy8gT3RoZXIgaXRlcmFibGVzIChTZXQsIE1hcCwgY3VzdG9tKTogYXNzdW1lIG5vbi1lbXB0eVxuICAvLyAoSWYgZW1wdHksIGl0ZXJhdGlvbiB3aWxsIGhhbmRsZSBpdCBuYXR1cmFsbHkpXG4gIHJldHVybiBjb2xsO1xufVxuIiwgIi8vIGludGVybmFsL3ZhbGlkYXRvcnMuanMgLSBWYWxpZGF0aW9uIGhlbHBlcnNcbi8vIEludGVybmFsIGltcGxlbWVudGF0aW9uIGRldGFpbCwgbm90IHBhcnQgb2YgcHVibGljIEFQSVxuXG4vLyBcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcbi8vIFZBTElEQVRJT04gSEVMUEVSU1xuLy8gXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXG5cbi8qKlxuICogVmFsaWRhdGUgdGhhdCBhIHZhbHVlIGlzIGEgbm9uLW5lZ2F0aXZlIGZpbml0ZSBudW1iZXJcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHZhbGlkYXRlTm9uTmVnYXRpdmVOdW1iZXIobiwgZnVuY3Rpb25OYW1lKSB7XG4gIGlmICh0eXBlb2YgbiAhPT0gJ251bWJlcicgfHwgbiA8IDAgfHwgIU51bWJlci5pc0Zpbml0ZShuKSkge1xuICAgIC8vIFNob3cgYWN0dWFsIHZhbHVlIGZvciBiZXR0ZXIgZGVidWdnaW5nXG4gICAgY29uc3QgdmFsdWVEZXNjID0gdHlwZW9mIG4gPT09ICdudW1iZXInID8gbiA6IGAke259ICh0eXBlOiAke3R5cGVvZiBufSlgO1xuICAgIHRocm93IG5ldyBUeXBlRXJyb3IoXG4gICAgICBgJHtmdW5jdGlvbk5hbWV9OiBmaXJzdCBhcmd1bWVudCBtdXN0IGJlIGEgbm9uLW5lZ2F0aXZlIGZpbml0ZSBudW1iZXIsIGdvdCAke3ZhbHVlRGVzY31gXG4gICAgKTtcbiAgfVxufVxuXG4vKipcbiAqIFZhbGlkYXRlIHRoYXQgYSB2YWx1ZSBpcyBhIGZpbml0ZSBudW1iZXIgKGNhbiBiZSBuZWdhdGl2ZSlcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHZhbGlkYXRlRmluaXRlTnVtYmVyKG4sIGZ1bmN0aW9uTmFtZSwgcGFyYW1OYW1lKSB7XG4gIGlmICh0eXBlb2YgbiAhPT0gJ251bWJlcicgfHwgIU51bWJlci5pc0Zpbml0ZShuKSkge1xuICAgIHRocm93IG5ldyBUeXBlRXJyb3IoXG4gICAgICBgJHtmdW5jdGlvbk5hbWV9OiAke3BhcmFtTmFtZX0gbXVzdCBiZSBhIGZpbml0ZSBudW1iZXIsIGdvdCAke3R5cGVvZiBufWBcbiAgICApO1xuICB9XG59XG5cbi8qKlxuICogVmFsaWRhdGUgdGhhdCBhIHZhbHVlIGlzIGEgbm9uLXplcm8gZmluaXRlIG51bWJlclxuICovXG5leHBvcnQgZnVuY3Rpb24gdmFsaWRhdGVOb25aZXJvTnVtYmVyKG4sIGZ1bmN0aW9uTmFtZSwgcGFyYW1OYW1lKSB7XG4gIGlmICh0eXBlb2YgbiAhPT0gJ251bWJlcicgfHwgbiA9PT0gMCB8fCAhTnVtYmVyLmlzRmluaXRlKG4pKSB7XG4gICAgdGhyb3cgbmV3IFR5cGVFcnJvcihcbiAgICAgIGAke2Z1bmN0aW9uTmFtZX06ICR7cGFyYW1OYW1lfSBtdXN0IGJlIGEgbm9uLXplcm8gZmluaXRlIG51bWJlciwgZ290ICR7dHlwZW9mIG4gPT09ICdudW1iZXInID8gbiA6IHR5cGVvZiBufWBcbiAgICApO1xuICB9XG59XG5cbi8qKlxuICogU2FmZWx5IHNlcmlhbGl6ZSBhIHZhbHVlIGZvciBlcnJvciBtZXNzYWdlcyAoaGFuZGxlcyBjaXJjdWxhciByZWZzKVxuICovXG5mdW5jdGlvbiBzYWZlU3RyaW5naWZ5KHZhbHVlLCBtYXhMZW5ndGggPSA1MCkge1xuICB0cnkge1xuICAgIGNvbnN0IHN0ciA9IEpTT04uc3RyaW5naWZ5KHZhbHVlKTtcbiAgICByZXR1cm4gc3RyLmxlbmd0aCA+IG1heExlbmd0aCA/IHN0ci5zbGljZSgwLCBtYXhMZW5ndGgpICsgJy4uLicgOiBzdHI7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICAvLyBIYW5kbGUgY2lyY3VsYXIgcmVmZXJlbmNlcywgbm9uLXNlcmlhbGl6YWJsZSB2YWx1ZXMsIGV0Yy5cbiAgICByZXR1cm4gT2JqZWN0LnByb3RvdHlwZS50b1N0cmluZy5jYWxsKHZhbHVlKTtcbiAgfVxufVxuXG4vKipcbiAqIFZhbGlkYXRlIHRoYXQgYSB2YWx1ZSBpcyBhIGZ1bmN0aW9uXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiB2YWxpZGF0ZUZ1bmN0aW9uKGYsIGZ1bmN0aW9uTmFtZSwgcGFyYW1OYW1lID0gJ2ZpcnN0IGFyZ3VtZW50Jykge1xuICBpZiAodHlwZW9mIGYgIT09ICdmdW5jdGlvbicpIHtcbiAgICAvLyBTaG93IHZhbHVlIHByZXZpZXcgZm9yIGJldHRlciBkZWJ1Z2dpbmcgKG9ubHkgb24gZXJyb3IgcGF0aCwgbm8gcGVyZiBjb3N0KVxuICAgIGNvbnN0IHZhbHVlUHJldmlldyA9IHR5cGVvZiBmID09PSAnb2JqZWN0JyAmJiBmICE9PSBudWxsXG4gICAgICA/IHNhZmVTdHJpbmdpZnkoZilcbiAgICAgIDogU3RyaW5nKGYpO1xuICAgIHRocm93IG5ldyBUeXBlRXJyb3IoXG4gICAgICBgJHtmdW5jdGlvbk5hbWV9OiAke3BhcmFtTmFtZX0gbXVzdCBiZSBhIGZ1bmN0aW9uLCBnb3QgJHt0eXBlb2YgZn0gKHZhbHVlOiAke3ZhbHVlUHJldmlld30pYFxuICAgICk7XG4gIH1cbn1cbiIsICIvLyBjb3JlLmpzIC0gRnVuZGFtZW50YWwgY29yZSBmdW5jdGlvbnMgKDUxIGZ1bmN0aW9ucylcbi8vIFRoZXNlIGFyZSB0aGUgaXJyZWR1Y2libGUgcHJpbWl0aXZlcyAtIGNhbm5vdCBiZSBidWlsdCBmcm9tIG90aGVyIGZ1bmN0aW9uc1xuLy8gSW5zcGlyZWQgYnkgY2xvanVyZS5jb3JlXG4vL1xuLy8gV2VlayAxIGFkZGl0aW9uczogbnRoLCBjb3VudCwgc2Vjb25kLCBsYXN0XG4vLyBXZWVrIDIgYWRkaXRpb25zOiBtYXBJbmRleGVkLCBrZWVwSW5kZXhlZCwgbWFwY2F0LCBrZWVwXG4vLyBXZWVrIDMgYWRkaXRpb25zOiBzZXEsIGVtcHR5LCBjb25qLCBpbnRvXG4vLyBXZWVrIDQgYWRkaXRpb25zOiByZXBlYXQsIHJlcGVhdGVkbHksIGN5Y2xlXG4vLyBXZWVrIDUgYWRkaXRpb25zOiBldmVyeSwgbm90QW55LCBub3RFdmVyeSwgaXNTb21lXG4vLyBXZWVrIDYgYWRkaXRpb25zOiBnZXQsIGdldEluLCBhc3NvYywgYXNzb2NJbiwgZGlzc29jLCB1cGRhdGUsIHVwZGF0ZUluLCBtZXJnZSwgdmVjLCBzZXRcblxuaW1wb3J0IHsgTGF6eVNlcSwgbGF6eVNlcSwgRU1QVFlfTEFaWV9TRVEgfSBmcm9tICcuL2ludGVybmFsL2xhenktc2VxLmpzJztcbmltcG9ydCB7IG5vcm1hbGl6ZSB9IGZyb20gJy4vaW50ZXJuYWwvbm9ybWFsaXplLmpzJztcbmltcG9ydCB7XG4gIHZhbGlkYXRlTm9uTmVnYXRpdmVOdW1iZXIsXG4gIHZhbGlkYXRlRmluaXRlTnVtYmVyLFxuICB2YWxpZGF0ZU5vblplcm9OdW1iZXIsXG4gIHZhbGlkYXRlRnVuY3Rpb25cbn0gZnJvbSAnLi9pbnRlcm5hbC92YWxpZGF0b3JzLmpzJztcblxuLy8gXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXG4vLyBTRVFVRU5DRSBQUklNSVRJVkVTIChUaGUgTGlzcCBUcmluaXR5KVxuLy8gXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXG5cbi8qKlxuICogUmV0dXJucyB0aGUgZmlyc3QgZWxlbWVudCBvZiBhIGNvbGxlY3Rpb25cbiAqXG4gKiBAcGFyYW0ge0l0ZXJhYmxlfG51bGx8dW5kZWZpbmVkfSBjb2xsIC0gQW55IGl0ZXJhYmxlIGNvbGxlY3Rpb25cbiAqIEByZXR1cm5zIHsqfSBGaXJzdCBlbGVtZW50LCBvciB1bmRlZmluZWQgaWYgZW1wdHlcbiAqXG4gKiBAZXhhbXBsZVxuICogZmlyc3QoWzEsIDIsIDNdKSAgLy8gXHUyMTkyIDFcbiAqIGZpcnN0KFtdKSAgICAgICAgIC8vIFx1MjE5MiB1bmRlZmluZWRcbiAqIGZpcnN0KG51bGwpICAgICAgIC8vIFx1MjE5MiB1bmRlZmluZWRcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGZpcnN0KGNvbGwpIHtcbiAgaWYgKGNvbGwgPT0gbnVsbCkgcmV0dXJuIHVuZGVmaW5lZDtcblxuICAvLyBPcHRpbWl6ZSBmb3IgYXJyYXlzXG4gIGlmIChBcnJheS5pc0FycmF5KGNvbGwpKSB7XG4gICAgcmV0dXJuIGNvbGwubGVuZ3RoID4gMCA/IGNvbGxbMF0gOiB1bmRlZmluZWQ7XG4gIH1cblxuICAvLyBPcHRpbWl6ZSBmb3IgTGF6eVNlcVxuICBpZiAoY29sbCBpbnN0YW5jZW9mIExhenlTZXEpIHtcbiAgICByZXR1cm4gY29sbC5nZXQoMCk7XG4gIH1cblxuICAvLyBHZW5lcmFsIGl0ZXJhYmxlXG4gIGZvciAoY29uc3QgaXRlbSBvZiBjb2xsKSB7XG4gICAgcmV0dXJuIGl0ZW07XG4gIH1cbiAgcmV0dXJuIHVuZGVmaW5lZDtcbn1cblxuLyoqXG4gKiBSZXR1cm5zIGEgc2VxdWVuY2Ugb2YgYWxsIGJ1dCB0aGUgZmlyc3QgZWxlbWVudFxuICpcbiAqIEBwYXJhbSB7SXRlcmFibGV8bnVsbHx1bmRlZmluZWR9IGNvbGwgLSBBbnkgaXRlcmFibGUgY29sbGVjdGlvblxuICogQHJldHVybnMge0xhenlTZXF9IExhenkgc2VxdWVuY2Ugb2YgcmVtYWluaW5nIGVsZW1lbnRzXG4gKlxuICogQGV4YW1wbGVcbiAqIHJlc3QoWzEsIDIsIDNdKSAgLy8gXHUyMTkyIFsyLCAzXVxuICogcmVzdChbMV0pICAgICAgICAvLyBcdTIxOTIgW11cbiAqIHJlc3QoW10pICAgICAgICAgLy8gXHUyMTkyIFtdXG4gKiByZXN0KG51bGwpICAgICAgIC8vIFx1MjE5MiBbXVxuICovXG5leHBvcnQgZnVuY3Rpb24gcmVzdChjb2xsKSB7XG4gIGlmIChjb2xsID09IG51bGwpIHJldHVybiBFTVBUWV9MQVpZX1NFUTtcblxuICAvLyBBcnJheSBmYXN0IHBhdGg6IGluZGV4ZWQgaXRlcmF0aW9uICgyLTN4IGZhc3RlciArIGxhenkpXG4gIGlmIChBcnJheS5pc0FycmF5KGNvbGwpKSB7XG4gICAgaWYgKGNvbGwubGVuZ3RoIDw9IDEpIHJldHVybiBFTVBUWV9MQVpZX1NFUTtcbiAgICByZXR1cm4gbGF6eVNlcShmdW5jdGlvbiogKCkge1xuICAgICAgZm9yIChsZXQgaSA9IDE7IGkgPCBjb2xsLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgIHlpZWxkIGNvbGxbaV07XG4gICAgICB9XG4gICAgfSk7XG4gIH1cblxuICAvLyBHZW5lcmljIHBhdGggZm9yIG90aGVyIGl0ZXJhYmxlc1xuICByZXR1cm4gbGF6eVNlcShmdW5jdGlvbiogKCkge1xuICAgIGxldCBpc0ZpcnN0ID0gdHJ1ZTtcbiAgICBmb3IgKGNvbnN0IGl0ZW0gb2YgY29sbCkge1xuICAgICAgaWYgKGlzRmlyc3QpIHtcbiAgICAgICAgaXNGaXJzdCA9IGZhbHNlO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIHlpZWxkIGl0ZW07XG4gICAgfVxuICB9KTtcbn1cblxuLyoqXG4gKiBSZXR1cm5zIGEgbmV3IHNlcXVlbmNlIHdpdGggZWxlbWVudCBwcmVwZW5kZWRcbiAqXG4gKiBEUlk6IERlbGVnYXRlcyB0byBjb25jYXQoKSBmb3Igc2ltcGxpY2l0eSBhbmQgY29uc2lzdGVuY3kuXG4gKiBGdW5jdGlvbmFsbHkgZXF1aXZhbGVudCB0byB5aWVsZGluZyBpdGVtIHRoZW4gaXRlcmF0aW5nIGNvbGwuXG4gKlxuICogQHBhcmFtIHsqfSBpdGVtIC0gRWxlbWVudCB0byBwcmVwZW5kXG4gKiBAcGFyYW0ge0l0ZXJhYmxlfG51bGx8dW5kZWZpbmVkfSBjb2xsIC0gQ29sbGVjdGlvbiB0byBwcmVwZW5kIHRvXG4gKiBAcmV0dXJucyB7TGF6eVNlcX0gTmV3IGxhenkgc2VxdWVuY2Ugd2l0aCBpdGVtIGZpcnN0XG4gKlxuICogQGV4YW1wbGVcbiAqIGNvbnMoMCwgWzEsIDIsIDNdKSAgLy8gXHUyMTkyIFswLCAxLCAyLCAzXVxuICogY29ucygxLCBbXSkgICAgICAgICAvLyBcdTIxOTIgWzFdXG4gKiBjb25zKDEsIG51bGwpICAgICAgIC8vIFx1MjE5MiBbMV1cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNvbnMoaXRlbSwgY29sbCkge1xuICByZXR1cm4gY29uY2F0KFtpdGVtXSwgY29sbCk7XG59XG5cbi8vIFx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVxuLy8gSU5ERVhFRCBBQ0NFU1MgJiBDT1VOVElORyAoV2VlayAxKVxuLy8gXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXG5cbi8qKlxuICogUmV0dXJucyBlbGVtZW50IGF0IGluZGV4LCB3aXRoIG9wdGlvbmFsIGZhbGxiYWNrIHZhbHVlXG4gKlxuICogR2V0cyB0aGUgZWxlbWVudCBhdCB6ZXJvLWJhc2VkIGluZGV4IHBvc2l0aW9uLiBJZiBpbmRleCBpcyBvdXQgb2YgYm91bmRzOlxuICogLSBXaXRoIG5vdEZvdW5kIGFyZzogcmV0dXJucyBub3RGb3VuZCB2YWx1ZVxuICogLSBXaXRob3V0IG5vdEZvdW5kIGFyZzogdGhyb3dzIGVycm9yXG4gKlxuICogTGF6eTogUmVhbGl6ZXMgb25seSB1cCB0byBpbmRleCArIDEgZWxlbWVudHMgZm9yIExhenlTZXEuXG4gKlxuICogQHBhcmFtIHtJdGVyYWJsZXxudWxsfHVuZGVmaW5lZH0gY29sbCAtIENvbGxlY3Rpb24gdG8gYWNjZXNzXG4gKiBAcGFyYW0ge251bWJlcn0gaW5kZXggLSBaZXJvLWJhc2VkIGluZGV4IChtdXN0IGJlIG5vbi1uZWdhdGl2ZSBpbnRlZ2VyKVxuICogQHBhcmFtIHsqfSBbbm90Rm91bmRdIC0gVmFsdWUgdG8gcmV0dXJuIGlmIGluZGV4IG91dCBvZiBib3VuZHNcbiAqIEByZXR1cm5zIHsqfSBFbGVtZW50IGF0IGluZGV4LCBvciBub3RGb3VuZCBpZiBvdXQgb2YgYm91bmRzXG4gKiBAdGhyb3dzIHtUeXBlRXJyb3J9IElmIGluZGV4IGlzIG5vdCBhIG5vbi1uZWdhdGl2ZSBpbnRlZ2VyXG4gKiBAdGhyb3dzIHtFcnJvcn0gSWYgaW5kZXggb3V0IG9mIGJvdW5kcyBhbmQgbm90Rm91bmQgbm90IHByb3ZpZGVkXG4gKlxuICogQGV4YW1wbGVcbiAqIG50aChbMTAsIDIwLCAzMF0sIDEpICAgICAgIC8vIFx1MjE5MiAyMFxuICogbnRoKFsxMCwgMjAsIDMwXSwgNSwgOTkpICAgLy8gXHUyMTkyIDk5IChvdXQgb2YgYm91bmRzLCByZXR1cm5zIG5vdEZvdW5kKVxuICogbnRoKFsxMCwgMjAsIDMwXSwgNSkgICAgICAgLy8gXHUyMTkyIHRocm93cyBFcnJvciAob3V0IG9mIGJvdW5kcywgbm8gbm90Rm91bmQpXG4gKlxuICogQGV4YW1wbGVcbiAqIC8vIFdvcmtzIHdpdGggc3RyaW5nc1xuICogbnRoKFwiaGVsbG9cIiwgMSkgIC8vIFx1MjE5MiBcImVcIlxuICpcbiAqIEBleGFtcGxlXG4gKiAvLyBMYXp5IHJlYWxpemF0aW9uXG4gKiBjb25zdCBsYXp5ID0gbWFwKHggPT4geCAqIDIsIFsxLCAyLCAzXSk7XG4gKiBudGgobGF6eSwgMSkgIC8vIFx1MjE5MiA0IChyZWFsaXplcyBvbmx5IGZpcnN0IDIgZWxlbWVudHMpXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBudGgoY29sbCwgaW5kZXgsIG5vdEZvdW5kKSB7XG4gIC8vIFZhbGlkYXRlIGluZGV4OiBtdXN0IGJlIG5vbi1uZWdhdGl2ZSBpbnRlZ2VyXG4gIGlmICghTnVtYmVyLmlzSW50ZWdlcihpbmRleCkgfHwgaW5kZXggPCAwKSB7XG4gICAgdGhyb3cgbmV3IFR5cGVFcnJvcihgbnRoOiBpbmRleCBtdXN0IGJlIG5vbi1uZWdhdGl2ZSBpbnRlZ2VyLCBnb3QgJHtpbmRleH1gKTtcbiAgfVxuXG4gIC8vIENoZWNrIGlmIG5vdEZvdW5kIHdhcyBleHBsaWNpdGx5IHByb3ZpZGVkICh1c2UgYXJndW1lbnRzLmxlbmd0aClcbiAgY29uc3QgaGFzTm90Rm91bmQgPSBhcmd1bWVudHMubGVuZ3RoID49IDM7XG5cbiAgLy8gSGFuZGxlIG5pbCBjb2xsZWN0aW9uXG4gIGlmIChjb2xsID09IG51bGwpIHtcbiAgICBpZiAoaGFzTm90Rm91bmQpIHJldHVybiBub3RGb3VuZDtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYG50aDogaW5kZXggJHtpbmRleH0gb3V0IG9mIGJvdW5kcyBmb3IgbnVsbCBjb2xsZWN0aW9uYCk7XG4gIH1cblxuICAvLyBBcnJheSBmYXN0IHBhdGg6IE8oMSkgZGlyZWN0IGluZGV4IGFjY2Vzc1xuICBpZiAoQXJyYXkuaXNBcnJheShjb2xsKSkge1xuICAgIGlmIChpbmRleCA8IGNvbGwubGVuZ3RoKSByZXR1cm4gY29sbFtpbmRleF07XG4gICAgaWYgKGhhc05vdEZvdW5kKSByZXR1cm4gbm90Rm91bmQ7XG4gICAgdGhyb3cgbmV3IEVycm9yKGBudGg6IGluZGV4ICR7aW5kZXh9IG91dCBvZiBib3VuZHMgKGxlbmd0aCAke2NvbGwubGVuZ3RofSlgKTtcbiAgfVxuXG4gIC8vIFN0cmluZyBmYXN0IHBhdGg6IE8oMSkgY2hhcmFjdGVyIGFjY2Vzc1xuICBpZiAodHlwZW9mIGNvbGwgPT09ICdzdHJpbmcnKSB7XG4gICAgaWYgKGluZGV4IDwgY29sbC5sZW5ndGgpIHJldHVybiBjb2xsW2luZGV4XTtcbiAgICBpZiAoaGFzTm90Rm91bmQpIHJldHVybiBub3RGb3VuZDtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYG50aDogaW5kZXggJHtpbmRleH0gb3V0IG9mIGJvdW5kcyAobGVuZ3RoICR7Y29sbC5sZW5ndGh9KWApO1xuICB9XG5cbiAgLy8gTGF6eVNlcTogcmVhbGl6ZSB1cCB0byBpbmRleCArIDEsIHRoZW4gY2hlY2sgX3JlYWxpemVkIGFycmF5XG4gIGlmIChjb2xsIGluc3RhbmNlb2YgTGF6eVNlcSkge1xuICAgIGNvbGwuX3JlYWxpemUoaW5kZXggKyAxKTsgIC8vIFJlYWxpemUgdXAgdG8gYW5kIGluY2x1ZGluZyBpbmRleFxuICAgIGlmIChpbmRleCA8IGNvbGwuX3JlYWxpemVkLmxlbmd0aCkgcmV0dXJuIGNvbGwuX3JlYWxpemVkW2luZGV4XTtcbiAgICBpZiAoaGFzTm90Rm91bmQpIHJldHVybiBub3RGb3VuZDtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYG50aDogaW5kZXggJHtpbmRleH0gb3V0IG9mIGJvdW5kcyBmb3Igc2VxdWVuY2VgKTtcbiAgfVxuXG4gIC8vIEdlbmVyaWMgaXRlcmFibGU6IGl0ZXJhdGUgd2l0aCBjb3VudGVyIHVudGlsIGluZGV4IHJlYWNoZWRcbiAgbGV0IGkgPSAwO1xuICBmb3IgKGNvbnN0IGl0ZW0gb2YgY29sbCkge1xuICAgIGlmIChpID09PSBpbmRleCkgcmV0dXJuIGl0ZW07XG4gICAgaSsrO1xuICB9XG5cbiAgLy8gT3V0IG9mIGJvdW5kcyBvbiBnZW5lcmljIGl0ZXJhYmxlXG4gIGlmIChoYXNOb3RGb3VuZCkgcmV0dXJuIG5vdEZvdW5kO1xuICB0aHJvdyBuZXcgRXJyb3IoYG50aDogaW5kZXggJHtpbmRleH0gb3V0IG9mIGJvdW5kc2ApO1xufVxuXG4vKipcbiAqIFJldHVybnMgdGhlIGNvdW50IG9mIGVsZW1lbnRzIGluIGEgY29sbGVjdGlvblxuICpcbiAqIEVBR0VSOiBGb3JjZXMgZnVsbCByZWFsaXphdGlvbiBvZiBsYXp5IHNlcXVlbmNlcy5cbiAqIFRoaXMgbWF0Y2hlcyBDbG9qdXJlJ3MgYmVoYXZpb3Igd2hlcmUgY291bnQgcmVhbGl6ZXMgdGhlIGVudGlyZSBzZXF1ZW5jZS5cbiAqXG4gKiBAcGFyYW0ge0l0ZXJhYmxlfG51bGx8dW5kZWZpbmVkfSBjb2xsIC0gQ29sbGVjdGlvbiB0byBjb3VudFxuICogQHJldHVybnMge251bWJlcn0gTnVtYmVyIG9mIGVsZW1lbnRzICgwIGZvciBuaWwpXG4gKlxuICogQGV4YW1wbGVcbiAqIGNvdW50KFsxLCAyLCAzXSkgIC8vIFx1MjE5MiAzXG4gKiBjb3VudChbXSkgICAgICAgICAvLyBcdTIxOTIgMFxuICogY291bnQobnVsbCkgICAgICAgLy8gXHUyMTkyIDBcbiAqXG4gKiBAZXhhbXBsZVxuICogLy8gU3RyaW5nc1xuICogY291bnQoXCJoZWxsb1wiKSAgLy8gXHUyMTkyIDVcbiAqXG4gKiBAZXhhbXBsZVxuICogLy8gRm9yY2VzIGZ1bGwgcmVhbGl6YXRpb24gKEVBR0VSISlcbiAqIGNvbnN0IGxhenkgPSBtYXAoeCA9PiB4ICogMiwgWzEsIDIsIDNdKTtcbiAqIGNvdW50KGxhenkpICAvLyBcdTIxOTIgMyAocmVhbGl6ZXMgYWxsIDMgZWxlbWVudHMpXG4gKlxuICogQGV4YW1wbGVcbiAqIC8vIFVzZSB3aXRoIHRha2UgZm9yIGZpbml0ZSBwb3J0aW9ucyBvZiBpbmZpbml0ZSBzZXF1ZW5jZXNcbiAqIGNvdW50KHRha2UoNSwgaXRlcmF0ZSh4ID0+IHggKyAxLCAwKSkpICAvLyBcdTIxOTIgNVxuICovXG5leHBvcnQgZnVuY3Rpb24gY291bnQoY29sbCkge1xuICAvLyBOaWwgXHUyMTkyIDBcbiAgaWYgKGNvbGwgPT0gbnVsbCkgcmV0dXJuIDA7XG5cbiAgLy8gQXJyYXkvc3RyaW5nOiBPKDEpIHZpYSAubGVuZ3RoXG4gIGlmIChBcnJheS5pc0FycmF5KGNvbGwpIHx8IHR5cGVvZiBjb2xsID09PSAnc3RyaW5nJykge1xuICAgIHJldHVybiBjb2xsLmxlbmd0aDtcbiAgfVxuXG4gIC8vIFNldC9NYXA6IE8oMSkgdmlhIC5zaXplXG4gIGlmIChjb2xsIGluc3RhbmNlb2YgU2V0IHx8IGNvbGwgaW5zdGFuY2VvZiBNYXApIHtcbiAgICByZXR1cm4gY29sbC5zaXplO1xuICB9XG5cbiAgLy8gTGF6eVNlcTogRk9SQ0UgRlVMTCBSRUFMSVpBVElPTiAoZWFnZXIhKVxuICBpZiAoY29sbCBpbnN0YW5jZW9mIExhenlTZXEpIHtcbiAgICBjb2xsLl9yZWFsaXplKEluZmluaXR5KTsgIC8vIFJlYWxpemUgYWxsIGVsZW1lbnRzXG4gICAgcmV0dXJuIGNvbGwuX3JlYWxpemVkLmxlbmd0aDtcbiAgfVxuXG4gIC8vIEdlbmVyaWMgaXRlcmFibGU6IGl0ZXJhdGUgYW5kIGNvdW50IE8obilcbiAgbGV0IG4gPSAwO1xuICBmb3IgKGNvbnN0IF8gb2YgY29sbCkge1xuICAgIG4rKztcbiAgfVxuICByZXR1cm4gbjtcbn1cblxuLyoqXG4gKiBSZXR1cm5zIHRoZSBzZWNvbmQgZWxlbWVudCBvZiBhIGNvbGxlY3Rpb25cbiAqXG4gKiBTaG9ydGhhbmQgZm9yIG50aChjb2xsLCAxLCBudWxsKS5cbiAqIFJldHVybnMgbnVsbCBpZiBjb2xsZWN0aW9uIGhhcyBmZXdlciB0aGFuIDIgZWxlbWVudHMuXG4gKlxuICogTGF6eTogUmVhbGl6ZXMgb25seSB1cCB0byAyIGVsZW1lbnRzIGZvciBMYXp5U2VxLlxuICpcbiAqIEBwYXJhbSB7SXRlcmFibGV8bnVsbHx1bmRlZmluZWR9IGNvbGwgLSBDb2xsZWN0aW9uIHRvIGFjY2Vzc1xuICogQHJldHVybnMgeyp9IFNlY29uZCBlbGVtZW50LCBvciBudWxsIGlmIG5vdCBwcmVzZW50XG4gKlxuICogQGV4YW1wbGVcbiAqIHNlY29uZChbMSwgMiwgM10pICAvLyBcdTIxOTIgMlxuICogc2Vjb25kKFsxXSkgICAgICAgIC8vIFx1MjE5MiBudWxsXG4gKiBzZWNvbmQoW10pICAgICAgICAgLy8gXHUyMTkyIG51bGxcbiAqIHNlY29uZChudWxsKSAgICAgICAvLyBcdTIxOTIgbnVsbFxuICpcbiAqIEBleGFtcGxlXG4gKiAvLyBXb3JrcyB3aXRoIHN0cmluZ3NcbiAqIHNlY29uZChcImhlbGxvXCIpICAvLyBcdTIxOTIgXCJlXCJcbiAqIHNlY29uZChcImFcIikgICAgICAvLyBcdTIxOTIgbnVsbFxuICovXG5leHBvcnQgZnVuY3Rpb24gc2Vjb25kKGNvbGwpIHtcbiAgcmV0dXJuIG50aChjb2xsLCAxLCBudWxsKTtcbn1cblxuLyoqXG4gKiBSZXR1cm5zIHRoZSBsYXN0IGVsZW1lbnQgb2YgYSBjb2xsZWN0aW9uXG4gKlxuICogRUFHRVI6IEZvcmNlcyBmdWxsIHJlYWxpemF0aW9uIG9mIGxhenkgc2VxdWVuY2VzLlxuICogRm9yIGFycmF5cyBhbmQgc3RyaW5ncywgdXNlcyBPKDEpIGluZGV4ZWQgYWNjZXNzLlxuICogRm9yIGl0ZXJhYmxlcywgaXRlcmF0ZXMgdG8gdGhlIGVuZC5cbiAqXG4gKiBAcGFyYW0ge0l0ZXJhYmxlfG51bGx8dW5kZWZpbmVkfSBjb2xsIC0gQ29sbGVjdGlvbiB0byBhY2Nlc3NcbiAqIEByZXR1cm5zIHsqfSBMYXN0IGVsZW1lbnQsIG9yIG51bGwgaWYgZW1wdHkvbmlsXG4gKlxuICogQGV4YW1wbGVcbiAqIGxhc3QoWzEsIDIsIDNdKSAgLy8gXHUyMTkyIDNcbiAqIGxhc3QoWzQyXSkgICAgICAgLy8gXHUyMTkyIDQyXG4gKiBsYXN0KFtdKSAgICAgICAgIC8vIFx1MjE5MiBudWxsXG4gKiBsYXN0KG51bGwpICAgICAgIC8vIFx1MjE5MiBudWxsXG4gKlxuICogQGV4YW1wbGVcbiAqIC8vIFdvcmtzIHdpdGggc3RyaW5nc1xuICogbGFzdChcImhlbGxvXCIpICAvLyBcdTIxOTIgXCJvXCJcbiAqIGxhc3QoXCJcIikgICAgICAgLy8gXHUyMTkyIG51bGxcbiAqXG4gKiBAZXhhbXBsZVxuICogLy8gRm9yY2VzIGZ1bGwgcmVhbGl6YXRpb24gKEVBR0VSISlcbiAqIGNvbnN0IGxhenkgPSBtYXAoeCA9PiB4ICogMiwgWzEsIDIsIDNdKTtcbiAqIGxhc3QobGF6eSkgIC8vIFx1MjE5MiA2IChyZWFsaXplcyBhbGwgZWxlbWVudHMpXG4gKlxuICogQGV4YW1wbGVcbiAqIC8vIFVzZSB3aXRoIHRha2UgZm9yIGZpbml0ZSBwb3J0aW9ucyBvZiBpbmZpbml0ZSBzZXF1ZW5jZXNcbiAqIGxhc3QodGFrZSg1LCBpdGVyYXRlKHggPT4geCArIDEsIDApKSkgIC8vIFx1MjE5MiA0XG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBsYXN0KGNvbGwpIHtcbiAgLy8gTmlsIFx1MjE5MiBudWxsXG4gIGlmIChjb2xsID09IG51bGwpIHJldHVybiBudWxsO1xuXG4gIC8vIEFycmF5IGZhc3QgcGF0aDogTygxKSBkaXJlY3QgYWNjZXNzIHRvIGxhc3QgaW5kZXhcbiAgaWYgKEFycmF5LmlzQXJyYXkoY29sbCkpIHtcbiAgICByZXR1cm4gY29sbC5sZW5ndGggPiAwID8gY29sbFtjb2xsLmxlbmd0aCAtIDFdIDogbnVsbDtcbiAgfVxuXG4gIC8vIFN0cmluZyBmYXN0IHBhdGg6IE8oMSkgY2hhcmFjdGVyIGFjY2Vzc1xuICBpZiAodHlwZW9mIGNvbGwgPT09ICdzdHJpbmcnKSB7XG4gICAgcmV0dXJuIGNvbGwubGVuZ3RoID4gMCA/IGNvbGxbY29sbC5sZW5ndGggLSAxXSA6IG51bGw7XG4gIH1cblxuICAvLyBMYXp5U2VxOiBmb3JjZSBmdWxsIHJlYWxpemF0aW9uIChlYWdlciEpXG4gIGlmIChjb2xsIGluc3RhbmNlb2YgTGF6eVNlcSkge1xuICAgIGNvbGwuX3JlYWxpemUoSW5maW5pdHkpOyAgLy8gUmVhbGl6ZSBhbGwgZWxlbWVudHNcbiAgICByZXR1cm4gY29sbC5fcmVhbGl6ZWQubGVuZ3RoID4gMCA/IGNvbGwuX3JlYWxpemVkW2NvbGwuX3JlYWxpemVkLmxlbmd0aCAtIDFdIDogbnVsbDtcbiAgfVxuXG4gIC8vIEdlbmVyaWMgaXRlcmFibGU6IGl0ZXJhdGUgdG8gZW5kLCByZW1lbWJlciBsYXN0IGl0ZW1cbiAgbGV0IGxhc3RJdGVtID0gbnVsbDtcbiAgZm9yIChjb25zdCBpdGVtIG9mIGNvbGwpIHtcbiAgICBsYXN0SXRlbSA9IGl0ZW07XG4gIH1cbiAgcmV0dXJuIGxhc3RJdGVtO1xufVxuXG4vLyBcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcbi8vIFNFUVVFTkNFIFBSRURJQ0FURVNcbi8vIFx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVxuXG4vKipcbiAqIFRlc3RzIGlmIGNvbGxlY3Rpb24gaXMgZW1wdHlcbiAqXG4gKiBVc2VzIHRoZSBpbnRlcm5hbCBub3JtYWxpemUoKSBoZWxwZXIgZm9yIERSWSAtIGFsbCBlbXB0eS1jaGVja2luZyBsb2dpY1xuICogaXMgY2VudHJhbGl6ZWQgaW4gb25lIHBsYWNlLlxuICpcbiAqIEBwYXJhbSB7Kn0gY29sbCAtIENvbGxlY3Rpb24gdG8gdGVzdFxuICogQHJldHVybnMge2Jvb2xlYW59IFRydWUgaWYgZW1wdHksIGZhbHNlIG90aGVyd2lzZVxuICpcbiAqIEBleGFtcGxlXG4gKiBpc0VtcHR5KFtdKSAgICAgICAvLyBcdTIxOTIgdHJ1ZVxuICogaXNFbXB0eShbMSwyXSkgICAgLy8gXHUyMTkyIGZhbHNlXG4gKiBpc0VtcHR5KG51bGwpICAgICAvLyBcdTIxOTIgdHJ1ZVxuICogaXNFbXB0eShcIlwiKSAgICAgICAvLyBcdTIxOTIgdHJ1ZVxuICogaXNFbXB0eShsYXp5U2VxKGZ1bmN0aW9uKiAoKSB7fSkpIC8vIFx1MjE5MiB0cnVlXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBpc0VtcHR5KGNvbGwpIHtcbiAgcmV0dXJuIG5vcm1hbGl6ZShjb2xsKSA9PT0gbnVsbDtcbn1cblxuLyoqXG4gKiBSZXR1cm5zIHRoZSBmaXJzdCBpdGVtIHdoZXJlIHByZWRpY2F0ZSByZXR1cm5zIHRydXRoeSB2YWx1ZSwgZWxzZSBudWxsXG4gKlxuICogTm90ZTogVGhpcyByZXR1cm5zIHRoZSBJVEVNIGl0c2VsZiAoSmF2YVNjcmlwdCBpZGlvbSksIG5vdCB0aGUgcHJlZGljYXRlIHJlc3VsdC5cbiAqIERpZmZlcnMgZnJvbSBDbG9qdXJlJ3MgYHNvbWVgIHdoaWNoIHJldHVybnMgcHJlZChpdGVtKS5cbiAqIEZvciBDbG9qdXJlLWNvbXBhdGlibGUgYmVoYXZpb3IsIHVzZTogZmlyc3QoZmlsdGVyKHByZWQsIGNvbGwpKVxuICpcbiAqIEBwYXJhbSB7RnVuY3Rpb259IHByZWQgLSBQcmVkaWNhdGUgZnVuY3Rpb25cbiAqIEBwYXJhbSB7SXRlcmFibGV8bnVsbHx1bmRlZmluZWR9IGNvbGwgLSBDb2xsZWN0aW9uIHRvIHNlYXJjaFxuICogQHJldHVybnMgeyp9IEZpcnN0IGl0ZW0gd2hlcmUgcHJlZChpdGVtKSBpcyB0cnV0aHksIG9yIG51bGxcbiAqXG4gKiBAZXhhbXBsZVxuICogc29tZSh4ID0+IHggPiA1LCBbMSwyLDYsM10pICAgICAvLyBcdTIxOTIgNiAoZmlyc3QgaXRlbSB3aGVyZSB4ID4gNSlcbiAqIHNvbWUoeCA9PiB4ID4gMTAsIFsxLDIsM10pICAgICAgLy8gXHUyMTkyIG51bGwgKG5vIG1hdGNoKVxuICogc29tZSh4ID0+IHggPT09IDUsIFsxLDIsNSw2XSkgICAvLyBcdTIxOTIgNSAoZm91bmQgaXRlbSlcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHNvbWUocHJlZCwgY29sbCkge1xuICB2YWxpZGF0ZUZ1bmN0aW9uKHByZWQsICdzb21lJywgJ3ByZWRpY2F0ZScpO1xuXG4gIGlmIChjb2xsID09IG51bGwpIHJldHVybiBudWxsO1xuXG4gIC8vIEFycmF5IGZhc3QgcGF0aDogaW5kZXhlZCBpdGVyYXRpb24gKDItM3ggZmFzdGVyKVxuICBpZiAoQXJyYXkuaXNBcnJheShjb2xsKSkge1xuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgY29sbC5sZW5ndGg7IGkrKykge1xuICAgICAgaWYgKHByZWQoY29sbFtpXSkpIHtcbiAgICAgICAgcmV0dXJuIGNvbGxbaV07XG4gICAgICB9XG4gICAgfVxuICAgIHJldHVybiBudWxsO1xuICB9XG5cbiAgLy8gR2VuZXJpYyBwYXRoIGZvciBvdGhlciBpdGVyYWJsZXNcbiAgZm9yIChjb25zdCBpdGVtIG9mIGNvbGwpIHtcbiAgICBpZiAocHJlZChpdGVtKSkge1xuICAgICAgcmV0dXJuIGl0ZW07XG4gICAgfVxuICB9XG4gIHJldHVybiBudWxsO1xufVxuXG4vLyBcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcbi8vIFNFUVVFTkNFIE9QRVJBVElPTlNcbi8vIFx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVxuXG4vKipcbiAqIFRha2VzIGZpcnN0IG4gZWxlbWVudHMgZnJvbSBhIGNvbGxlY3Rpb25cbiAqIFJldHVybnMgYSBMYXp5U2VxIChsYXp5IGV2YWx1YXRpb24pXG4gKlxuICogQHBhcmFtIHtudW1iZXJ9IG4gLSBOdW1iZXIgb2YgZWxlbWVudHMgdG8gdGFrZVxuICogQHBhcmFtIHtJdGVyYWJsZXxudWxsfHVuZGVmaW5lZH0gY29sbCAtIENvbGxlY3Rpb24gdG8gdGFrZSBmcm9tXG4gKiBAcmV0dXJucyB7TGF6eVNlcX0gTGF6eSBzZXF1ZW5jZSBvZiBmaXJzdCBuIGVsZW1lbnRzXG4gKlxuICogQGV4YW1wbGVcbiAqIHRha2UoMywgWzEsMiwzLDQsNV0pICAvLyBcdTIxOTIgWzEsMiwzXVxuICogdGFrZSgxMCwgWzEsMiwzXSkgICAgIC8vIFx1MjE5MiBbMSwyLDNdXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiB0YWtlKG4sIGNvbGwpIHtcbiAgdmFsaWRhdGVOb25OZWdhdGl2ZU51bWJlcihuLCAndGFrZScpO1xuXG4gIGlmIChjb2xsID09IG51bGwpIHtcbiAgICByZXR1cm4gRU1QVFlfTEFaWV9TRVE7XG4gIH1cblxuICAvLyBBcnJheSBmYXN0IHBhdGg6IGluZGV4ZWQgaXRlcmF0aW9uICgyLTN4IGZhc3RlciArIG5vIGNvdW50ZXIpXG4gIGlmIChBcnJheS5pc0FycmF5KGNvbGwpKSB7XG4gICAgY29uc3QgbGltaXQgPSBNYXRoLm1pbihuLCBjb2xsLmxlbmd0aCk7XG4gICAgaWYgKGxpbWl0ID09PSAwKSByZXR1cm4gRU1QVFlfTEFaWV9TRVE7XG4gICAgcmV0dXJuIGxhenlTZXEoZnVuY3Rpb24qICgpIHtcbiAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgbGltaXQ7IGkrKykge1xuICAgICAgICB5aWVsZCBjb2xsW2ldO1xuICAgICAgfVxuICAgIH0pO1xuICB9XG5cbiAgLy8gR2VuZXJpYyBwYXRoIGZvciBvdGhlciBpdGVyYWJsZXNcbiAgcmV0dXJuIGxhenlTZXEoZnVuY3Rpb24qICgpIHtcbiAgICBsZXQgY291bnQgPSAwO1xuICAgIGNvbnN0IGl0ZXJhdG9yID0gY29sbFtTeW1ib2wuaXRlcmF0b3JdKCk7XG4gICAgd2hpbGUgKGNvdW50IDwgbikge1xuICAgICAgY29uc3QgeyB2YWx1ZSwgZG9uZSB9ID0gaXRlcmF0b3IubmV4dCgpO1xuICAgICAgaWYgKGRvbmUpIGJyZWFrO1xuICAgICAgeWllbGQgdmFsdWU7XG4gICAgICBjb3VudCsrO1xuICAgIH1cbiAgfSk7XG59XG5cbi8qKlxuICogRHJvcHMgZmlyc3QgbiBlbGVtZW50cyBmcm9tIGEgY29sbGVjdGlvblxuICogUmV0dXJucyBhIExhenlTZXEgKGxhenkgZXZhbHVhdGlvbilcbiAqXG4gKiBAcGFyYW0ge251bWJlcn0gbiAtIE51bWJlciBvZiBlbGVtZW50cyB0byBkcm9wXG4gKiBAcGFyYW0ge0l0ZXJhYmxlfG51bGx8dW5kZWZpbmVkfSBjb2xsIC0gQ29sbGVjdGlvbiB0byBkcm9wIGZyb21cbiAqIEByZXR1cm5zIHtMYXp5U2VxfSBMYXp5IHNlcXVlbmNlIHdpdGhvdXQgZmlyc3QgbiBlbGVtZW50c1xuICovXG5leHBvcnQgZnVuY3Rpb24gZHJvcChuLCBjb2xsKSB7XG4gIHZhbGlkYXRlTm9uTmVnYXRpdmVOdW1iZXIobiwgJ2Ryb3AnKTtcblxuICBpZiAoY29sbCA9PSBudWxsKSB7XG4gICAgcmV0dXJuIEVNUFRZX0xBWllfU0VRO1xuICB9XG5cbiAgLy8gQXJyYXkgZmFzdCBwYXRoOiBpbmRleGVkIGl0ZXJhdGlvbiAoMi0zeCBmYXN0ZXIgKyBubyBjb3VudGVyKVxuICBpZiAoQXJyYXkuaXNBcnJheShjb2xsKSkge1xuICAgIGlmIChuID49IGNvbGwubGVuZ3RoKSByZXR1cm4gRU1QVFlfTEFaWV9TRVE7XG4gICAgcmV0dXJuIGxhenlTZXEoZnVuY3Rpb24qICgpIHtcbiAgICAgIGZvciAobGV0IGkgPSBuOyBpIDwgY29sbC5sZW5ndGg7IGkrKykge1xuICAgICAgICB5aWVsZCBjb2xsW2ldO1xuICAgICAgfVxuICAgIH0pO1xuICB9XG5cbiAgLy8gR2VuZXJpYyBwYXRoIGZvciBvdGhlciBpdGVyYWJsZXNcbiAgcmV0dXJuIGxhenlTZXEoZnVuY3Rpb24qICgpIHtcbiAgICBsZXQgY291bnQgPSAwO1xuICAgIGZvciAoY29uc3QgaXRlbSBvZiBjb2xsKSB7XG4gICAgICBpZiAoY291bnQgPj0gbikge1xuICAgICAgICB5aWVsZCBpdGVtO1xuICAgICAgfVxuICAgICAgY291bnQrKztcbiAgICB9XG4gIH0pO1xufVxuXG4vKipcbiAqIE1hcHMgZnVuY3Rpb24gb3ZlciBjb2xsZWN0aW9uIChsYXp5KVxuICpcbiAqIEBwYXJhbSB7RnVuY3Rpb259IGYgLSBGdW5jdGlvbiB0byBtYXBcbiAqIEBwYXJhbSB7SXRlcmFibGV8bnVsbHx1bmRlZmluZWR9IGNvbGwgLSBDb2xsZWN0aW9uIHRvIG1hcCBvdmVyXG4gKiBAcmV0dXJucyB7TGF6eVNlcX0gTGF6eSBzZXF1ZW5jZSBvZiBtYXBwZWQgdmFsdWVzXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBtYXAoZiwgY29sbCkge1xuICB2YWxpZGF0ZUZ1bmN0aW9uKGYsICdtYXAnKTtcblxuICBpZiAoY29sbCA9PSBudWxsKSB7XG4gICAgcmV0dXJuIEVNUFRZX0xBWllfU0VRO1xuICB9XG5cbiAgLy8gQXJyYXkgZmFzdCBwYXRoOiBpbmRleGVkIGl0ZXJhdGlvbiAoMi0zeCBmYXN0ZXIpXG4gIGlmIChBcnJheS5pc0FycmF5KGNvbGwpKSB7XG4gICAgcmV0dXJuIGxhenlTZXEoZnVuY3Rpb24qICgpIHtcbiAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgY29sbC5sZW5ndGg7IGkrKykge1xuICAgICAgICB5aWVsZCBmKGNvbGxbaV0pO1xuICAgICAgfVxuICAgIH0pO1xuICB9XG5cbiAgLy8gR2VuZXJpYyBwYXRoIGZvciBvdGhlciBpdGVyYWJsZXNcbiAgcmV0dXJuIGxhenlTZXEoZnVuY3Rpb24qICgpIHtcbiAgICBmb3IgKGNvbnN0IGl0ZW0gb2YgY29sbCkge1xuICAgICAgeWllbGQgZihpdGVtKTtcbiAgICB9XG4gIH0pO1xufVxuXG4vKipcbiAqIEZpbHRlcnMgY29sbGVjdGlvbiB3aXRoIHByZWRpY2F0ZSAobGF6eSlcbiAqXG4gKiBAcGFyYW0ge0Z1bmN0aW9ufSBwcmVkIC0gUHJlZGljYXRlIGZ1bmN0aW9uXG4gKiBAcGFyYW0ge0l0ZXJhYmxlfG51bGx8dW5kZWZpbmVkfSBjb2xsIC0gQ29sbGVjdGlvbiB0byBmaWx0ZXJcbiAqIEByZXR1cm5zIHtMYXp5U2VxfSBMYXp5IHNlcXVlbmNlIG9mIGVsZW1lbnRzIHRoYXQgc2F0aXNmeSBwcmVkaWNhdGVcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGZpbHRlcihwcmVkLCBjb2xsKSB7XG4gIHZhbGlkYXRlRnVuY3Rpb24ocHJlZCwgJ2ZpbHRlcicsICdwcmVkaWNhdGUnKTtcblxuICBpZiAoY29sbCA9PSBudWxsKSB7XG4gICAgcmV0dXJuIEVNUFRZX0xBWllfU0VRO1xuICB9XG5cbiAgLy8gQXJyYXkgZmFzdCBwYXRoOiBpbmRleGVkIGl0ZXJhdGlvbiAoMi0zeCBmYXN0ZXIpXG4gIGlmIChBcnJheS5pc0FycmF5KGNvbGwpKSB7XG4gICAgcmV0dXJuIGxhenlTZXEoZnVuY3Rpb24qICgpIHtcbiAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgY29sbC5sZW5ndGg7IGkrKykge1xuICAgICAgICBpZiAocHJlZChjb2xsW2ldKSkge1xuICAgICAgICAgIHlpZWxkIGNvbGxbaV07XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9KTtcbiAgfVxuXG4gIC8vIEdlbmVyaWMgcGF0aCBmb3Igb3RoZXIgaXRlcmFibGVzXG4gIHJldHVybiBsYXp5U2VxKGZ1bmN0aW9uKiAoKSB7XG4gICAgZm9yIChjb25zdCBpdGVtIG9mIGNvbGwpIHtcbiAgICAgIGlmIChwcmVkKGl0ZW0pKSB7XG4gICAgICAgIHlpZWxkIGl0ZW07XG4gICAgICB9XG4gICAgfVxuICB9KTtcbn1cblxuLyoqXG4gKiBSZWR1Y2VzIGNvbGxlY3Rpb24gd2l0aCBmdW5jdGlvbiBhbmQgaW5pdGlhbCB2YWx1ZSAoRUFHRVIpXG4gKlxuICogQHBhcmFtIHtGdW5jdGlvbn0gZiAtIFJlZHVjZXIgZnVuY3Rpb25cbiAqIEBwYXJhbSB7Kn0gaW5pdCAtIEluaXRpYWwgdmFsdWVcbiAqIEBwYXJhbSB7SXRlcmFibGV8bnVsbHx1bmRlZmluZWR9IGNvbGwgLSBDb2xsZWN0aW9uIHRvIHJlZHVjZVxuICogQHJldHVybnMgeyp9IFJlZHVjZWQgdmFsdWVcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHJlZHVjZShmLCBpbml0LCBjb2xsKSB7XG4gIHZhbGlkYXRlRnVuY3Rpb24oZiwgJ3JlZHVjZScsICdyZWR1Y2VyJyk7XG5cbiAgaWYgKGNvbGwgPT0gbnVsbCkgcmV0dXJuIGluaXQ7XG5cbiAgLy8gQXJyYXkgZmFzdCBwYXRoOiBpbmRleGVkIGl0ZXJhdGlvbiAoMi0zeCBmYXN0ZXIpXG4gIGlmIChBcnJheS5pc0FycmF5KGNvbGwpKSB7XG4gICAgbGV0IGFjYyA9IGluaXQ7XG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCBjb2xsLmxlbmd0aDsgaSsrKSB7XG4gICAgICBhY2MgPSBmKGFjYywgY29sbFtpXSk7XG4gICAgfVxuICAgIHJldHVybiBhY2M7XG4gIH1cblxuICAvLyBHZW5lcmljIHBhdGggZm9yIG90aGVyIGl0ZXJhYmxlc1xuICBsZXQgYWNjID0gaW5pdDtcbiAgZm9yIChjb25zdCBpdGVtIG9mIGNvbGwpIHtcbiAgICBhY2MgPSBmKGFjYywgaXRlbSk7XG4gIH1cbiAgcmV0dXJuIGFjYztcbn1cblxuLyoqXG4gKiBDb25jYXRlbmF0ZXMgbXVsdGlwbGUgY29sbGVjdGlvbnMgKGxhenkpXG4gKlxuICogQHBhcmFtIHsuLi5JdGVyYWJsZX0gY29sbHMgLSBDb2xsZWN0aW9ucyB0byBjb25jYXRlbmF0ZVxuICogQHJldHVybnMge0xhenlTZXF9IExhenkgc2VxdWVuY2Ugb2YgYWxsIGVsZW1lbnRzXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjb25jYXQoLi4uY29sbHMpIHtcbiAgcmV0dXJuIGxhenlTZXEoZnVuY3Rpb24qICgpIHtcbiAgICBmb3IgKGNvbnN0IGNvbGwgb2YgY29sbHMpIHtcbiAgICAgIGlmIChjb2xsICE9IG51bGwpIHtcbiAgICAgICAgZm9yIChjb25zdCBpdGVtIG9mIGNvbGwpIHtcbiAgICAgICAgICB5aWVsZCBpdGVtO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuICB9KTtcbn1cblxuLyoqXG4gKiBGbGF0dGVucyBuZXN0ZWQgY29sbGVjdGlvbnMgb25lIGxldmVsIChsYXp5KVxuICpcbiAqIEBwYXJhbSB7SXRlcmFibGV8bnVsbHx1bmRlZmluZWR9IGNvbGwgLSBDb2xsZWN0aW9uIHRvIGZsYXR0ZW5cbiAqIEByZXR1cm5zIHtMYXp5U2VxfSBMYXp5IHNlcXVlbmNlIG9mIGZsYXR0ZW5lZCBlbGVtZW50c1xuICovXG5leHBvcnQgZnVuY3Rpb24gZmxhdHRlbihjb2xsKSB7XG4gIGlmIChjb2xsID09IG51bGwpIHtcbiAgICByZXR1cm4gRU1QVFlfTEFaWV9TRVE7XG4gIH1cblxuICByZXR1cm4gbGF6eVNlcShmdW5jdGlvbiogKCkge1xuICAgIGZvciAoY29uc3QgaXRlbSBvZiBjb2xsKSB7XG4gICAgICAvLyBcdTI3MDUgRmxhdHRlbiBhbnkgaXRlcmFibGUgKEFycmF5LCBMYXp5U2VxLCBTZXQsIE1hcCwgZXRjLilcbiAgICAgIC8vIEJVVCBleGNsdWRlIHN0cmluZ3MgKHN0cmluZ3MgYXJlIGl0ZXJhYmxlIGJ1dCBzaG91bGRuJ3QgYmUgZmxhdHRlbmVkKVxuICAgICAgaWYgKGl0ZW0gIT0gbnVsbCAmJlxuICAgICAgICAgIHR5cGVvZiBpdGVtICE9PSAnc3RyaW5nJyAmJlxuICAgICAgICAgIHR5cGVvZiBpdGVtW1N5bWJvbC5pdGVyYXRvcl0gPT09ICdmdW5jdGlvbicpIHtcbiAgICAgICAgZm9yIChjb25zdCBuZXN0ZWQgb2YgaXRlbSkge1xuICAgICAgICAgIHlpZWxkIG5lc3RlZDtcbiAgICAgICAgfVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgeWllbGQgaXRlbTtcbiAgICAgIH1cbiAgICB9XG4gIH0pO1xufVxuXG4vKipcbiAqIFJlbW92ZXMgZHVwbGljYXRlIGVsZW1lbnRzIChsYXp5KVxuICpcbiAqIEBwYXJhbSB7SXRlcmFibGV8bnVsbHx1bmRlZmluZWR9IGNvbGwgLSBDb2xsZWN0aW9uIHRvIHJlbW92ZSBkdXBsaWNhdGVzIGZyb21cbiAqIEByZXR1cm5zIHtMYXp5U2VxfSBMYXp5IHNlcXVlbmNlIHdpdGggdW5pcXVlIGVsZW1lbnRzXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBkaXN0aW5jdChjb2xsKSB7XG4gIGlmIChjb2xsID09IG51bGwpIHtcbiAgICByZXR1cm4gRU1QVFlfTEFaWV9TRVE7XG4gIH1cblxuICByZXR1cm4gbGF6eVNlcShmdW5jdGlvbiogKCkge1xuICAgIGNvbnN0IHNlZW4gPSBuZXcgU2V0KCk7XG4gICAgZm9yIChjb25zdCBpdGVtIG9mIGNvbGwpIHtcbiAgICAgIGlmICghc2Vlbi5oYXMoaXRlbSkpIHtcbiAgICAgICAgc2Vlbi5hZGQoaXRlbSk7XG4gICAgICAgIHlpZWxkIGl0ZW07XG4gICAgICB9XG4gICAgfVxuICB9KTtcbn1cblxuLy8gXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXG4vLyBNQVAgT1BFUkFUSU9OUyAoV2VlayAyKVxuLy8gXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXG5cbi8qKlxuICogTWFwcyBmdW5jdGlvbiBvdmVyIGNvbGxlY3Rpb24gd2l0aCBpbmRleCBhcyBzZWNvbmQgcGFyYW1ldGVyXG4gKlxuICogTGlrZSBtYXAsIGJ1dCB0aGUgbWFwcGluZyBmdW5jdGlvbiByZWNlaXZlcyAoaW5kZXgsIGl0ZW0pIGluc3RlYWQgb2YganVzdCBpdGVtLlxuICogSW5kZXggaXMgemVyby1iYXNlZCBhbmQgaW5jcmVtZW50cyBmb3IgZWFjaCBlbGVtZW50LlxuICpcbiAqIExhenk6IFJldHVybnMgbGF6eSBzZXF1ZW5jZSB0aGF0IHJlYWxpemVzIGVsZW1lbnRzIG9uIGRlbWFuZC5cbiAqXG4gKiBAcGFyYW0ge0Z1bmN0aW9ufSBmIC0gTWFwcGluZyBmdW5jdGlvbiAoaW5kZXgsIGl0ZW0pIFx1MjE5MiB0cmFuc2Zvcm1lZF92YWx1ZVxuICogQHBhcmFtIHtJdGVyYWJsZXxudWxsfHVuZGVmaW5lZH0gY29sbCAtIENvbGxlY3Rpb24gdG8gbWFwIG92ZXJcbiAqIEByZXR1cm5zIHtMYXp5U2VxfSBMYXp5IHNlcXVlbmNlIG9mIHRyYW5zZm9ybWVkIHZhbHVlc1xuICogQHRocm93cyB7VHlwZUVycm9yfSBJZiBmIGlzIG5vdCBhIGZ1bmN0aW9uXG4gKlxuICogQGV4YW1wbGVcbiAqIG1hcEluZGV4ZWQoKGksIHgpID0+IFtpLCB4XSwgWzEwLCAyMCwgMzBdKVxuICogLy8gXHUyMTkyIFtbMCwgMTBdLCBbMSwgMjBdLCBbMiwgMzBdXVxuICpcbiAqIEBleGFtcGxlXG4gKiAvLyBVc2UgaW5kZXggaW4gdHJhbnNmb3JtYXRpb25cbiAqIG1hcEluZGV4ZWQoKGksIHgpID0+IHggKiBpLCBbMTAsIDIwLCAzMF0pXG4gKiAvLyBcdTIxOTIgWzAsIDIwLCA2MF1cbiAqXG4gKiBAZXhhbXBsZVxuICogLy8gV29ya3Mgd2l0aCBzdHJpbmdzXG4gKiBtYXBJbmRleGVkKChpLCBjKSA9PiBjLnJlcGVhdChpICsgMSksIFwiYWJjXCIpXG4gKiAvLyBcdTIxOTIgW1wiYVwiLCBcImJiXCIsIFwiY2NjXCJdXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBtYXBJbmRleGVkKGYsIGNvbGwpIHtcbiAgdmFsaWRhdGVGdW5jdGlvbihmLCAnbWFwSW5kZXhlZCcsICdpbmRleGluZyBmdW5jdGlvbicpO1xuXG4gIGlmIChjb2xsID09IG51bGwpIHJldHVybiBFTVBUWV9MQVpZX1NFUTtcblxuICAvLyBBcnJheSBmYXN0IHBhdGg6IGluZGV4ZWQgaXRlcmF0aW9uXG4gIGlmIChBcnJheS5pc0FycmF5KGNvbGwpKSB7XG4gICAgcmV0dXJuIGxhenlTZXEoZnVuY3Rpb24qICgpIHtcbiAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgY29sbC5sZW5ndGg7IGkrKykge1xuICAgICAgICB5aWVsZCBmKGksIGNvbGxbaV0pO1xuICAgICAgfVxuICAgIH0pO1xuICB9XG5cbiAgLy8gR2VuZXJpYyBpdGVyYWJsZTogZm9yLi4ub2Ygd2l0aCBjb3VudGVyXG4gIHJldHVybiBsYXp5U2VxKGZ1bmN0aW9uKiAoKSB7XG4gICAgbGV0IGkgPSAwO1xuICAgIGZvciAoY29uc3QgaXRlbSBvZiBjb2xsKSB7XG4gICAgICB5aWVsZCBmKGksIGl0ZW0pO1xuICAgICAgaSsrO1xuICAgIH1cbiAgfSk7XG59XG5cbi8qKlxuICogTGlrZSBtYXBJbmRleGVkLCBidXQgZmlsdGVycyBvdXQgbmlsL3VuZGVmaW5lZCByZXN1bHRzXG4gKlxuICogTWFwcyBmdW5jdGlvbiBvdmVyIGNvbGxlY3Rpb24gd2l0aCBpbmRleCwga2VlcGluZyBvbmx5IG5vbi1uaWwgcmVzdWx0cy5cbiAqIE9ubHkgbnVsbCBhbmQgdW5kZWZpbmVkIGFyZSBmaWx0ZXJlZCAtIGFsbCBvdGhlciBmYWxzeSB2YWx1ZXMgKDAsIGZhbHNlLCBcIlwiKSBhcmUga2VwdC5cbiAqXG4gKiBMYXp5OiBSZXR1cm5zIGxhenkgc2VxdWVuY2UgdGhhdCByZWFsaXplcyBlbGVtZW50cyBvbiBkZW1hbmQuXG4gKlxuICogQHBhcmFtIHtGdW5jdGlvbn0gZiAtIEluZGV4aW5nIGZ1bmN0aW9uIChpbmRleCwgaXRlbSkgXHUyMTkyIHZhbHVlX29yX25pbFxuICogQHBhcmFtIHtJdGVyYWJsZXxudWxsfHVuZGVmaW5lZH0gY29sbCAtIENvbGxlY3Rpb24gdG8gcHJvY2Vzc1xuICogQHJldHVybnMge0xhenlTZXF9IExhenkgc2VxdWVuY2Ugd2l0aCBuaWwgcmVzdWx0cyBmaWx0ZXJlZFxuICogQHRocm93cyB7VHlwZUVycm9yfSBJZiBmIGlzIG5vdCBhIGZ1bmN0aW9uXG4gKlxuICogQGV4YW1wbGVcbiAqIC8vIEtlZXAgZWxlbWVudHMgYXQgZXZlbiBpbmRpY2VzXG4gKiBrZWVwSW5kZXhlZCgoaSwgeCkgPT4gaSAlIDIgPT09IDAgPyB4IDogbnVsbCwgWydhJywgJ2InLCAnYycsICdkJ10pXG4gKiAvLyBcdTIxOTIgWydhJywgJ2MnXVxuICpcbiAqIEBleGFtcGxlXG4gKiAvLyBSZXR1cm4gaW5kaWNlcyB3aGVyZSB2YWx1ZSA+IDVcbiAqIGtlZXBJbmRleGVkKChpLCB4KSA9PiB4ID4gNSA/IGkgOiBudWxsLCBbMSwgOCwgMywgOV0pXG4gKiAvLyBcdTIxOTIgWzEsIDNdXG4gKlxuICogQGV4YW1wbGVcbiAqIC8vIEZhbHN5IHZhbHVlcyAoZXhjZXB0IG5pbCkgYXJlIGtlcHRcbiAqIGtlZXBJbmRleGVkKCgpID0+IDAsIFsxLCAyLCAzXSlcbiAqIC8vIFx1MjE5MiBbMCwgMCwgMF1cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGtlZXBJbmRleGVkKGYsIGNvbGwpIHtcbiAgdmFsaWRhdGVGdW5jdGlvbihmLCAna2VlcEluZGV4ZWQnLCAnaW5kZXhpbmcgZnVuY3Rpb24nKTtcblxuICBpZiAoY29sbCA9PSBudWxsKSByZXR1cm4gRU1QVFlfTEFaWV9TRVE7XG5cbiAgLy8gQXJyYXkgZmFzdCBwYXRoXG4gIGlmIChBcnJheS5pc0FycmF5KGNvbGwpKSB7XG4gICAgcmV0dXJuIGxhenlTZXEoZnVuY3Rpb24qICgpIHtcbiAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgY29sbC5sZW5ndGg7IGkrKykge1xuICAgICAgICBjb25zdCByZXN1bHQgPSBmKGksIGNvbGxbaV0pO1xuICAgICAgICBpZiAocmVzdWx0ICE9IG51bGwpIHsgIC8vIFx1MjcwNSBPbmx5IGZpbHRlciBudWxsL3VuZGVmaW5lZFxuICAgICAgICAgIHlpZWxkIHJlc3VsdDtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH0pO1xuICB9XG5cbiAgLy8gR2VuZXJpYyBpdGVyYWJsZVxuICByZXR1cm4gbGF6eVNlcShmdW5jdGlvbiogKCkge1xuICAgIGxldCBpID0gMDtcbiAgICBmb3IgKGNvbnN0IGl0ZW0gb2YgY29sbCkge1xuICAgICAgY29uc3QgcmVzdWx0ID0gZihpLCBpdGVtKTtcbiAgICAgIGlmIChyZXN1bHQgIT0gbnVsbCkgeyAgLy8gXHUyNzA1IE9ubHkgZmlsdGVyIG51bGwvdW5kZWZpbmVkXG4gICAgICAgIHlpZWxkIHJlc3VsdDtcbiAgICAgIH1cbiAgICAgIGkrKztcbiAgICB9XG4gIH0pO1xufVxuXG4vKipcbiAqIE1hcHMgZnVuY3Rpb24gb3ZlciBjb2xsZWN0aW9uIGFuZCBmbGF0dGVucyByZXN1bHRzIG9uZSBsZXZlbFxuICpcbiAqIEFsc28ga25vd24gYXMgZmxhdE1hcC4gRXF1aXZhbGVudCB0byBmbGF0dGVuKG1hcChmLCBjb2xsKSkgYnV0IG1vcmUgZWZmaWNpZW50LlxuICogRWFjaCByZXN1bHQgbXVzdCBiZSBpdGVyYWJsZSAob3IgbmlsIGZvciBlbXB0eSkuXG4gKlxuICogTGF6eTogUmV0dXJucyBsYXp5IHNlcXVlbmNlIHRoYXQgcmVhbGl6ZXMgZWxlbWVudHMgb24gZGVtYW5kLlxuICpcbiAqIEBwYXJhbSB7RnVuY3Rpb259IGYgLSBNYXBwaW5nIGZ1bmN0aW9uIGl0ZW0gXHUyMTkyIGl0ZXJhYmxlXG4gKiBAcGFyYW0ge0l0ZXJhYmxlfG51bGx8dW5kZWZpbmVkfSBjb2xsIC0gQ29sbGVjdGlvbiB0byBtYXAgb3ZlclxuICogQHJldHVybnMge0xhenlTZXF9IExhenkgc2VxdWVuY2Ugb2YgZmxhdHRlbmVkIHJlc3VsdHNcbiAqIEB0aHJvd3Mge1R5cGVFcnJvcn0gSWYgZiBpcyBub3QgYSBmdW5jdGlvbiBvciByZXR1cm5zIG5vbi1pdGVyYWJsZVxuICpcbiAqIEBleGFtcGxlXG4gKiAvLyBFeHBhbmQgZWFjaCBlbGVtZW50XG4gKiBtYXBjYXQoeCA9PiBbeCwgeCAqIDJdLCBbMSwgMiwgM10pXG4gKiAvLyBcdTIxOTIgWzEsIDIsIDIsIDQsIDMsIDZdXG4gKlxuICogQGV4YW1wbGVcbiAqIC8vIFZhcmlhYmxlIGxlbmd0aCByZXN1bHRzXG4gKiBtYXBjYXQoeCA9PiBBcnJheSh4KS5maWxsKHgpLCBbMSwgMiwgM10pXG4gKiAvLyBcdTIxOTIgWzEsIDIsIDIsIDMsIDMsIDNdXG4gKlxuICogQGV4YW1wbGVcbiAqIC8vIFJldmVyc2UgbmVzdGVkIGFycmF5c1xuICogbWFwY2F0KGFyciA9PiBhcnIucmV2ZXJzZSgpLCBbWzMsMiwxXSwgWzYsNSw0XV0pXG4gKiAvLyBcdTIxOTIgWzEsIDIsIDMsIDQsIDUsIDZdXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBtYXBjYXQoZiwgY29sbCkge1xuICB2YWxpZGF0ZUZ1bmN0aW9uKGYsICdtYXBjYXQnLCAnbWFwcGluZyBmdW5jdGlvbicpO1xuXG4gIGlmIChjb2xsID09IG51bGwpIHJldHVybiBFTVBUWV9MQVpZX1NFUTtcblxuICAvLyBJbXBsZW1lbnQgZGlyZWN0bHkgKG5vdCB2aWEgZmxhdHRlbikgdG8gaGFuZGxlIHN0cmluZ3MgcHJvcGVybHlcbiAgcmV0dXJuIGxhenlTZXEoZnVuY3Rpb24qICgpIHtcbiAgICBmb3IgKGNvbnN0IGl0ZW0gb2YgY29sbCkge1xuICAgICAgY29uc3QgcmVzdWx0ID0gZihpdGVtKTtcblxuICAgICAgLy8gTmlsL3VuZGVmaW5lZCBcdTIxOTIgc2tpcFxuICAgICAgaWYgKHJlc3VsdCA9PSBudWxsKSBjb250aW51ZTtcblxuICAgICAgLy8gTXVzdCBiZSBpdGVyYWJsZVxuICAgICAgaWYgKHR5cGVvZiByZXN1bHRbU3ltYm9sLml0ZXJhdG9yXSAhPT0gJ2Z1bmN0aW9uJykge1xuICAgICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKFxuICAgICAgICAgIGBtYXBjYXQ6IG1hcHBpbmcgZnVuY3Rpb24gbXVzdCByZXR1cm4gaXRlcmFibGUsIGdvdCAke3R5cGVvZiByZXN1bHR9YFxuICAgICAgICApO1xuICAgICAgfVxuXG4gICAgICAvLyBZaWVsZCBhbGwgaXRlbXMgZnJvbSByZXN1bHQgKGluY2x1ZGluZyBzdHJpbmcgY2hhcmFjdGVycyEpXG4gICAgICBmb3IgKGNvbnN0IG5lc3RlZCBvZiByZXN1bHQpIHtcbiAgICAgICAgeWllbGQgbmVzdGVkO1xuICAgICAgfVxuICAgIH1cbiAgfSk7XG59XG5cbi8qKlxuICogTWFwcyBmdW5jdGlvbiBvdmVyIGNvbGxlY3Rpb24sIGZpbHRlcmluZyBvdXQgbmlsL3VuZGVmaW5lZCByZXN1bHRzXG4gKlxuICogTGlrZSBrZWVwSW5kZXhlZCBidXQgd2l0aG91dCB0aGUgaW5kZXggcGFyYW1ldGVyLlxuICogT25seSBudWxsIGFuZCB1bmRlZmluZWQgYXJlIGZpbHRlcmVkIC0gYWxsIG90aGVyIGZhbHN5IHZhbHVlcyAoMCwgZmFsc2UsIFwiXCIpIGFyZSBrZXB0LlxuICpcbiAqIExhenk6IFJldHVybnMgbGF6eSBzZXF1ZW5jZSB0aGF0IHJlYWxpemVzIGVsZW1lbnRzIG9uIGRlbWFuZC5cbiAqXG4gKiBAcGFyYW0ge0Z1bmN0aW9ufSBmIC0gTWFwcGluZyBmdW5jdGlvbiBpdGVtIFx1MjE5MiB2YWx1ZV9vcl9uaWxcbiAqIEBwYXJhbSB7SXRlcmFibGV8bnVsbHx1bmRlZmluZWR9IGNvbGwgLSBDb2xsZWN0aW9uIHRvIHByb2Nlc3NcbiAqIEByZXR1cm5zIHtMYXp5U2VxfSBMYXp5IHNlcXVlbmNlIHdpdGggbmlsIHJlc3VsdHMgZmlsdGVyZWRcbiAqIEB0aHJvd3Mge1R5cGVFcnJvcn0gSWYgZiBpcyBub3QgYSBmdW5jdGlvblxuICpcbiAqIEBleGFtcGxlXG4gKiAvLyBLZWVwIGV2ZW4gbnVtYmVyc1xuICoga2VlcCh4ID0+IHggJSAyID09PSAwID8geCA6IG51bGwsIFsxLCAyLCAzLCA0XSlcbiAqIC8vIFx1MjE5MiBbMiwgNF1cbiAqXG4gKiBAZXhhbXBsZVxuICogLy8gVHJhbnNmb3JtIGFuZCBmaWx0ZXJcbiAqIGtlZXAoeCA9PiB4ID4gMiA/IHggKiAyIDogbnVsbCwgWzEsIDIsIDMsIDRdKVxuICogLy8gXHUyMTkyIFs2LCA4XVxuICpcbiAqIEBleGFtcGxlXG4gKiAvLyBpZGVudGl0eSBmaWx0ZXJzIG5pbCBidXQga2VlcHMgb3RoZXIgZmFsc3kgdmFsdWVzXG4gKiBrZWVwKHggPT4geCwgWzEsIG51bGwsIDIsIGZhbHNlLCAzXSlcbiAqIC8vIFx1MjE5MiBbMSwgMiwgZmFsc2UsIDNdXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBrZWVwKGYsIGNvbGwpIHtcbiAgdmFsaWRhdGVGdW5jdGlvbihmLCAna2VlcCcsICdtYXBwaW5nIGZ1bmN0aW9uJyk7XG5cbiAgaWYgKGNvbGwgPT0gbnVsbCkgcmV0dXJuIEVNUFRZX0xBWllfU0VRO1xuXG4gIC8vIEFycmF5IGZhc3QgcGF0aFxuICBpZiAoQXJyYXkuaXNBcnJheShjb2xsKSkge1xuICAgIHJldHVybiBsYXp5U2VxKGZ1bmN0aW9uKiAoKSB7XG4gICAgICBmb3IgKGxldCBpID0gMDsgaSA8IGNvbGwubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgY29uc3QgcmVzdWx0ID0gZihjb2xsW2ldKTtcbiAgICAgICAgaWYgKHJlc3VsdCAhPSBudWxsKSB7ICAvLyBcdTI3MDUgT25seSBmaWx0ZXIgbnVsbC91bmRlZmluZWRcbiAgICAgICAgICB5aWVsZCByZXN1bHQ7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9KTtcbiAgfVxuXG4gIC8vIEdlbmVyaWMgaXRlcmFibGVcbiAgcmV0dXJuIGxhenlTZXEoZnVuY3Rpb24qICgpIHtcbiAgICBmb3IgKGNvbnN0IGl0ZW0gb2YgY29sbCkge1xuICAgICAgY29uc3QgcmVzdWx0ID0gZihpdGVtKTtcbiAgICAgIGlmIChyZXN1bHQgIT0gbnVsbCkgeyAgLy8gXHUyNzA1IE9ubHkgZmlsdGVyIG51bGwvdW5kZWZpbmVkXG4gICAgICAgIHlpZWxkIHJlc3VsdDtcbiAgICAgIH1cbiAgICB9XG4gIH0pO1xufVxuXG4vLyBcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcbi8vIFNFUVVFTkNFIEdFTkVSQVRPUlNcbi8vIFx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVxuXG4vKipcbiAqIENyZWF0ZXMgYSBsYXp5IHJhbmdlIHVzaW5nIEphdmFTY3JpcHQgZ2VuZXJhdG9yc1xuICogQ2xvanVyZS1jb21wYXRpYmxlIHNlbWFudGljczpcbiAqXG4gKiByYW5nZSgpICAgICAgICAgIFx1MjE5MiAwLCAxLCAyLCAzLi4uIFx1MjIxRSAgICAgKGluZmluaXRlIGZyb20gMClcbiAqIHJhbmdlKGVuZCkgICAgICAgXHUyMTkyIDAsIDEsIDIuLi4gZW5kLTEgICAgKGZpbml0ZSB0byBlbmQpXG4gKiByYW5nZShzdGFydCxlbmQpIFx1MjE5MiBzdGFydC4uLiBlbmQtMSAgICAgIChmaW5pdGUgcmFuZ2UpXG4gKiByYW5nZShzdGFydCxlbmQsc3RlcCkgXHUyMTkyIHN0YXJ0Li4uIGVuZC0xIGJ5IHN0ZXBcbiAqXG4gKiBAcGFyYW0ge251bWJlcn0gW3N0YXJ0XSAtIFN0YXJ0aW5nIHZhbHVlXG4gKiBAcGFyYW0ge251bWJlcn0gW2VuZF0gLSBFbmRpbmcgdmFsdWUgKGV4Y2x1c2l2ZSlcbiAqIEBwYXJhbSB7bnVtYmVyfSBbc3RlcD0xXSAtIFN0ZXAgc2l6ZVxuICogQHJldHVybnMge0xhenlTZXF9IExhenkgc2VxdWVuY2Ugb2YgbnVtYmVyc1xuICovXG5leHBvcnQgZnVuY3Rpb24gcmFuZ2Uoc3RhcnQsIGVuZCwgc3RlcCA9IDEpIHtcbiAgdmFsaWRhdGVOb25aZXJvTnVtYmVyKHN0ZXAsICdyYW5nZScsICdzdGVwJyk7XG5cbiAgLy8gTm8gYXJndW1lbnRzIFx1MjE5MiBpbmZpbml0ZSBzZXF1ZW5jZSBmcm9tIDBcbiAgaWYgKHN0YXJ0ID09PSB1bmRlZmluZWQpIHtcbiAgICByZXR1cm4gbGF6eVNlcShmdW5jdGlvbiogKCkge1xuICAgICAgbGV0IGkgPSAwO1xuICAgICAgd2hpbGUgKHRydWUpIHtcbiAgICAgICAgeWllbGQgaTtcbiAgICAgICAgaSArPSBzdGVwO1xuICAgICAgfVxuICAgIH0pO1xuICB9XG5cbiAgLy8gVmFsaWRhdGUgc3RhcnQgLSBtdXN0IGJlIGZpbml0ZSBudW1iZXJcbiAgdmFsaWRhdGVGaW5pdGVOdW1iZXIoc3RhcnQsICdyYW5nZScsICdzdGFydCcpO1xuXG4gIC8vIE9uZSBhcmd1bWVudCBcdTIxOTIgcmFuZ2UgZnJvbSAwIHRvIHN0YXJ0XG4gIGlmIChlbmQgPT09IHVuZGVmaW5lZCkge1xuICAgIGVuZCA9IHN0YXJ0O1xuICAgIHN0YXJ0ID0gMDtcbiAgfSBlbHNlIHtcbiAgICAvLyBWYWxpZGF0ZSBlbmQgaWYgcHJvdmlkZWQgLSBhbGxvdyBJbmZpbml0eSBmb3IgaW5maW5pdGUgc2VxdWVuY2VzXG4gICAgaWYgKHR5cGVvZiBlbmQgIT09ICdudW1iZXInKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKGByYW5nZTogZW5kIG11c3QgYmUgYSBudW1iZXIsIGdvdCAke3R5cGVvZiBlbmR9YCk7XG4gICAgfVxuICB9XG5cbiAgLy8gU2VwYXJhdGUgbG9vcHMgZm9yIHBvc2l0aXZlL25lZ2F0aXZlIHN0ZXBzIChhdm9pZHMgZnVuY3Rpb24gY2FsbCBvdmVyaGVhZClcbiAgcmV0dXJuIGxhenlTZXEoZnVuY3Rpb24qICgpIHtcbiAgICBpZiAoc3RlcCA+IDApIHtcbiAgICAgIGZvciAobGV0IGkgPSBzdGFydDsgaSA8IGVuZDsgaSArPSBzdGVwKSB7XG4gICAgICAgIHlpZWxkIGk7XG4gICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgIGZvciAobGV0IGkgPSBzdGFydDsgaSA+IGVuZDsgaSArPSBzdGVwKSB7XG4gICAgICAgIHlpZWxkIGk7XG4gICAgICB9XG4gICAgfVxuICB9KTtcbn1cblxuLyoqXG4gKiBSZXR1cm5zIGxhenkgc2VxdWVuY2Ugb2YgeCwgZih4KSwgZihmKHgpKSwgZXRjLlxuICogSW5maW5pdGUgc2VxdWVuY2UgYnkgZGVmYXVsdFxuICpcbiAqIEBwYXJhbSB7RnVuY3Rpb259IGYgLSBGdW5jdGlvbiB0byBpdGVyYXRlXG4gKiBAcGFyYW0geyp9IHggLSBJbml0aWFsIHZhbHVlXG4gKiBAcmV0dXJucyB7TGF6eVNlcX0gSW5maW5pdGUgbGF6eSBzZXF1ZW5jZVxuICpcbiAqIEBleGFtcGxlXG4gKiBpdGVyYXRlKHggPT4geCAqIDIsIDEpICAvLyBcdTIxOTIgWzEsIDIsIDQsIDgsIDE2LCAzMiwgLi4uXVxuICogdGFrZSg1LCBpdGVyYXRlKHggPT4geCArIDEsIDApKSAgLy8gXHUyMTkyIFswLCAxLCAyLCAzLCA0XVxuICovXG5leHBvcnQgZnVuY3Rpb24gaXRlcmF0ZShmLCB4KSB7XG4gIHZhbGlkYXRlRnVuY3Rpb24oZiwgJ2l0ZXJhdGUnLCAnaXRlcmF0b3IgZnVuY3Rpb24nKTtcblxuICByZXR1cm4gbGF6eVNlcShmdW5jdGlvbiogKCkge1xuICAgIGxldCBjdXJyZW50ID0geDtcbiAgICB3aGlsZSAodHJ1ZSkge1xuICAgICAgeWllbGQgY3VycmVudDtcbiAgICAgIGN1cnJlbnQgPSBmKGN1cnJlbnQpO1xuICAgIH1cbiAgfSk7XG59XG5cbi8vIFx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVxuLy8gRlVOQ1RJT04gT1BFUkFUSU9OU1xuLy8gXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXG5cbi8qKlxuICogQ29tcG9zZXMgZnVuY3Rpb25zIHJpZ2h0LXRvLWxlZnRcbiAqIGNvbXAoZiwgZywgaCkoeCkgPT09IGYoZyhoKHgpKSlcbiAqXG4gKiBAcGFyYW0gey4uLkZ1bmN0aW9ufSBmbnMgLSBGdW5jdGlvbnMgdG8gY29tcG9zZVxuICogQHJldHVybnMge0Z1bmN0aW9ufSBDb21wb3NlZCBmdW5jdGlvblxuICpcbiAqIEBleGFtcGxlXG4gKiBjb25zdCBmID0gY29tcCh4ID0+IHggKiAyLCB4ID0+IHggKyAxKVxuICogZig1KSAgLy8gXHUyMTkyIDEyICAoNSsxPTYsIDYqMj0xMilcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNvbXAoLi4uZm5zKSB7XG4gIC8vIFZhbGlkYXRlIGFsbCBhcmd1bWVudHMgYXJlIGZ1bmN0aW9uc1xuICBmbnMuZm9yRWFjaCgoZm4sIGkpID0+IHtcbiAgICB2YWxpZGF0ZUZ1bmN0aW9uKGZuLCAnY29tcCcsIGBhcmd1bWVudCAke2kgKyAxfWApO1xuICB9KTtcblxuICBpZiAoZm5zLmxlbmd0aCA9PT0gMCkge1xuICAgIHJldHVybiB4ID0+IHg7ICAvLyBpZGVudGl0eVxuICB9XG5cbiAgaWYgKGZucy5sZW5ndGggPT09IDEpIHtcbiAgICByZXR1cm4gZm5zWzBdO1xuICB9XG5cbiAgcmV0dXJuIGZ1bmN0aW9uKC4uLmFyZ3MpIHtcbiAgICAvLyBBcHBseSByaWdodG1vc3QgZnVuY3Rpb24gZmlyc3RcbiAgICBsZXQgcmVzdWx0ID0gZm5zW2Zucy5sZW5ndGggLSAxXSguLi5hcmdzKTtcbiAgICAvLyBUaGVuIGFwcGx5IGVhY2ggZnVuY3Rpb24gcmlnaHQtdG8tbGVmdFxuICAgIGZvciAobGV0IGkgPSBmbnMubGVuZ3RoIC0gMjsgaSA+PSAwOyBpLS0pIHtcbiAgICAgIHJlc3VsdCA9IGZuc1tpXShyZXN1bHQpO1xuICAgIH1cbiAgICByZXR1cm4gcmVzdWx0O1xuICB9O1xufVxuXG4vKipcbiAqIFBhcnRpYWwgYXBwbGljYXRpb24gLSByZXR1cm5zIGZ1bmN0aW9uIHdpdGggc29tZSBhcmd1bWVudHMgcHJlLWZpbGxlZFxuICpcbiAqIEBwYXJhbSB7RnVuY3Rpb259IGYgLSBGdW5jdGlvbiB0byBwYXJ0aWFsbHkgYXBwbHlcbiAqIEBwYXJhbSB7Li4uKn0gYXJncyAtIEFyZ3VtZW50cyB0byBwcmUtZmlsbFxuICogQHJldHVybnMge0Z1bmN0aW9ufSBQYXJ0aWFsbHkgYXBwbGllZCBmdW5jdGlvblxuICpcbiAqIEBleGFtcGxlXG4gKiBjb25zdCBhZGQ1ID0gcGFydGlhbCgoYSwgYikgPT4gYSArIGIsIDUpXG4gKiBhZGQ1KDEwKSAgLy8gXHUyMTkyIDE1XG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBwYXJ0aWFsKGYsIC4uLmFyZ3MpIHtcbiAgdmFsaWRhdGVGdW5jdGlvbihmLCAncGFydGlhbCcsICdmdW5jdGlvbicpO1xuXG4gIHJldHVybiBmdW5jdGlvbiguLi5tb3JlQXJncykge1xuICAgIHJldHVybiBmKC4uLmFyZ3MsIC4uLm1vcmVBcmdzKTtcbiAgfTtcbn1cblxuLyoqXG4gKiBBcHBsaWVzIGZ1bmN0aW9uIHRvIGFycmF5IG9yIGl0ZXJhYmxlIG9mIGFyZ3VtZW50c1xuICpcbiAqIEBwYXJhbSB7RnVuY3Rpb259IGYgLSBGdW5jdGlvbiB0byBhcHBseVxuICogQHBhcmFtIHtJdGVyYWJsZXxudWxsfHVuZGVmaW5lZH0gYXJncyAtIEFycmF5IG9yIGl0ZXJhYmxlIG9mIGFyZ3VtZW50c1xuICogQHJldHVybnMgeyp9IFJlc3VsdCBvZiBmdW5jdGlvbiBhcHBsaWNhdGlvblxuICpcbiAqIEBleGFtcGxlXG4gKiBhcHBseSgoYSxiLGMpID0+IGErYitjLCBbMSwyLDNdKSAgLy8gXHUyMTkyIDZcbiAqIGFwcGx5KE1hdGgubWF4LCBbMSw1LDMsMl0pICAgICAgICAvLyBcdTIxOTIgNVxuICogYXBwbHkoTWF0aC5tYXgsIHRha2UoNSwgcmFuZ2UoKSkpIC8vIFx1MjE5MiA0ICh3b3JrcyB3aXRoIExhenlTZXEpXG4gKiBhcHBseShNYXRoLm1heCwgbmV3IFNldChbMSw1LDNdKSkgLy8gXHUyMTkyIDUgKHdvcmtzIHdpdGggU2V0KVxuICovXG5leHBvcnQgZnVuY3Rpb24gYXBwbHkoZiwgYXJncykge1xuICB2YWxpZGF0ZUZ1bmN0aW9uKGYsICdhcHBseScsICdmdW5jdGlvbicpO1xuXG4gIC8vIEFjY2VwdCBhbnkgaXRlcmFibGUsIG5vdCBqdXN0IGFycmF5c1xuICBpZiAoYXJncyA9PSBudWxsIHx8IHR5cGVvZiBhcmdzW1N5bWJvbC5pdGVyYXRvcl0gIT09ICdmdW5jdGlvbicpIHtcbiAgICB0aHJvdyBuZXcgVHlwZUVycm9yKGBhcHBseTogc2Vjb25kIGFyZ3VtZW50IG11c3QgYmUgaXRlcmFibGUsIGdvdCAke3R5cGVvZiBhcmdzfWApO1xuICB9XG5cbiAgLy8gQ29udmVydCB0byBhcnJheSBpZiBuZWVkZWQgKGVmZmljaWVudCBmb3IgYXJyYXlzLCB3b3JrcyBmb3IgYWxsIGl0ZXJhYmxlcylcbiAgY29uc3QgYXJnc0FycmF5ID0gQXJyYXkuaXNBcnJheShhcmdzKSA/IGFyZ3MgOiBBcnJheS5mcm9tKGFyZ3MpO1xuICByZXR1cm4gZiguLi5hcmdzQXJyYXkpO1xufVxuXG4vLyBcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcdTI1MDFcbi8vIFVUSUxJVElFU1xuLy8gXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXG5cbi8qKlxuICogR3JvdXBzIGNvbGxlY3Rpb24gZWxlbWVudHMgYnkgZnVuY3Rpb24gcmVzdWx0XG4gKlxuICogQHBhcmFtIHtGdW5jdGlvbn0gZiAtIEdyb3VwaW5nIGZ1bmN0aW9uXG4gKiBAcGFyYW0ge0l0ZXJhYmxlfG51bGx8dW5kZWZpbmVkfSBjb2xsIC0gQ29sbGVjdGlvbiB0byBncm91cFxuICogQHJldHVybnMge01hcH0gTWFwIHdpdGggZ3JvdXBlZCBlbGVtZW50cyAoa2V5cyBwcmVzZXJ2ZSB0aGVpciB0eXBlcylcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGdyb3VwQnkoZiwgY29sbCkge1xuICB2YWxpZGF0ZUZ1bmN0aW9uKGYsICdncm91cEJ5JywgJ2tleSBmdW5jdGlvbicpO1xuXG4gIGlmIChjb2xsID09IG51bGwpIHJldHVybiBuZXcgTWFwKCk7XG5cbiAgY29uc3QgcmVzdWx0ID0gbmV3IE1hcCgpO1xuICBmb3IgKGNvbnN0IGl0ZW0gb2YgY29sbCkge1xuICAgIGNvbnN0IGtleSA9IGYoaXRlbSk7ICAvLyBcdTI3MDUgUHJlc2VydmUga2V5IHR5cGUgKG5vIFN0cmluZyBjb252ZXJzaW9uKVxuICAgIGlmICghcmVzdWx0LmhhcyhrZXkpKSB7XG4gICAgICByZXN1bHQuc2V0KGtleSwgW10pO1xuICAgIH1cbiAgICByZXN1bHQuZ2V0KGtleSkucHVzaChpdGVtKTtcbiAgfVxuICByZXR1cm4gcmVzdWx0O1xufVxuXG4vKipcbiAqIEdldHMga2V5cyBmcm9tIGFuIG9iamVjdFxuICpcbiAqIEBwYXJhbSB7T2JqZWN0fG51bGx8dW5kZWZpbmVkfSBvYmogLSBPYmplY3QgdG8gZ2V0IGtleXMgZnJvbVxuICogQHJldHVybnMge0FycmF5fSBBcnJheSBvZiBrZXlzXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBrZXlzKG9iaikge1xuICBpZiAob2JqID09IG51bGwpIHJldHVybiBbXTtcbiAgcmV0dXJuIE9iamVjdC5rZXlzKG9iaik7XG59XG5cbi8qKlxuICogRm9yY2VzIGZ1bGwgZXZhbHVhdGlvbiBvZiBsYXp5IHNlcXVlbmNlXG4gKlxuICogTWF0Y2hlcyBDbG9qdXJlIHNlbWFudGljczogXCJmb3JjZSByZWFsaXphdGlvblwiLCBub3QgXCJjb3B5XCIuXG4gKiBSZXR1cm5zIGFycmF5cyBhcy1pcyAoTygxKSksIG5vdCBjb3BpZWQgKE8obikpLlxuICpcbiAqIEBwYXJhbSB7SXRlcmFibGV8bnVsbHx1bmRlZmluZWR9IGNvbGwgLSBDb2xsZWN0aW9uIHRvIHJlYWxpemVcbiAqIEByZXR1cm5zIHtBcnJheX0gRnVsbHkgcmVhbGl6ZWQgYXJyYXlcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGRvYWxsKGNvbGwpIHtcbiAgaWYgKGNvbGwgPT0gbnVsbCkgcmV0dXJuIFtdO1xuICAvLyBBcnJheSBmYXN0IHBhdGg6IEFscmVhZHkgcmVhbGl6ZWQsIHJldHVybiBhcy1pcyAoTygxKSAtIDEwMHggZmFzdGVyISlcbiAgLy8gTWF0Y2hlcyBDbG9qdXJlOiBkb2FsbCByZXR1cm5zIHNhbWUgcmVmZXJlbmNlIGZvciByZWFsaXplZCBjb2xsZWN0aW9uc1xuICBpZiAoQXJyYXkuaXNBcnJheShjb2xsKSkgcmV0dXJuIGNvbGw7XG4gIHJldHVybiBBcnJheS5mcm9tKGNvbGwpO1xufVxuXG4vKipcbiAqIENoZWNrcyBpZiBhIExhenlTZXEgaGFzIGJlZW4gZnVsbHkgcmVhbGl6ZWRcbiAqXG4gKiBAcGFyYW0geyp9IGNvbGwgLSBDb2xsZWN0aW9uIHRvIGNoZWNrXG4gKiBAcmV0dXJucyB7Ym9vbGVhbn0gVHJ1ZSBpZiBmdWxseSByZWFsaXplZFxuICovXG5leHBvcnQgZnVuY3Rpb24gcmVhbGl6ZWQoY29sbCkge1xuICBpZiAoY29sbCA9PSBudWxsKSByZXR1cm4gdHJ1ZTtcbiAgaWYgKGNvbGwgaW5zdGFuY2VvZiBMYXp5U2VxKSB7XG4gICAgcmV0dXJuIGNvbGwuX2V4aGF1c3RlZDtcbiAgfVxuICByZXR1cm4gdHJ1ZTsgIC8vIE5vbi1sYXp5IGNvbGxlY3Rpb25zIGFyZSBhbHdheXMgcmVhbGl6ZWRcbn1cblxuLy8gXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXG4vLyBDT0xMRUNUSU9OIFBST1RPQ09MUyAoV2VlayAzKVxuLy8gXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXG5cbi8qKlxuICogQ29udmVydCBhbnkgY29sbGVjdGlvbiB0byBhIGxhenkgc2VxdWVuY2UsIG9yIHJldHVybiBudWxsIGZvciBlbXB0eS9uaWxcbiAqXG4gKiBDcml0aWNhbCBiZWhhdmlvcjogRW1wdHkgY29sbGVjdGlvbnMgcmV0dXJuIG51bGwgKG5vdCBlbXB0eSBMYXp5U2VxKS5cbiAqIFRoaXMgZW5hYmxlcyBpZGlvbWF0aWMgbmlsLXB1bm5pbmc6IGBpZiAoc2VxKGNvbGwpKSB7IC4uLiB9YFxuICpcbiAqIEBwYXJhbSB7Kn0gY29sbCAtIENvbGxlY3Rpb24gdG8gY29udmVydCB0byBzZXF1ZW5jZVxuICogQHJldHVybnMge0xhenlTZXF8bnVsbH0gTGF6eSBzZXF1ZW5jZSBvciBudWxsIGlmIGVtcHR5L25pbFxuICpcbiAqIEBleGFtcGxlXG4gKiBzZXEoWzEsIDIsIDNdKSAgICAgICAgICAgLy8gPT4gTGF6eVNlcShbMSwgMiwgM10pXG4gKiBzZXEoW10pICAgICAgICAgICAgICAgICAgLy8gPT4gbnVsbCAoZW1wdHkhKVxuICogc2VxKG51bGwpICAgICAgICAgICAgICAgIC8vID0+IG51bGxcbiAqIHNlcShcImFiY1wiKSAgICAgICAgICAgICAgIC8vID0+IExhenlTZXEoW1wiYVwiLCBcImJcIiwgXCJjXCJdKVxuICogc2VxKG5ldyBTZXQoWzEsMl0pKSAgICAgIC8vID0+IExhenlTZXEoWzEsIDJdKVxuICogc2VxKHthOiAxLCBiOiAyfSkgICAgICAgIC8vID0+IExhenlTZXEoW1tcImFcIiwgMV0sIFtcImJcIiwgMl1dKVxuICovXG5leHBvcnQgZnVuY3Rpb24gc2VxKGNvbGwpIHtcbiAgLy8gTmlsIGlucHV0IFx1MjE5MiBudWxsXG4gIGlmIChjb2xsID09IG51bGwpIHJldHVybiBudWxsO1xuXG4gIC8vIEVtcHR5IGFycmF5IFx1MjE5MiBudWxsXG4gIGlmIChBcnJheS5pc0FycmF5KGNvbGwpKSB7XG4gICAgcmV0dXJuIGNvbGwubGVuZ3RoID09PSAwID8gbnVsbCA6IGxhenlTZXEoZnVuY3Rpb24qICgpIHtcbiAgICAgIGZvciAoY29uc3QgaXRlbSBvZiBjb2xsKSB5aWVsZCBpdGVtO1xuICAgIH0pO1xuICB9XG5cbiAgLy8gRW1wdHkgc3RyaW5nIFx1MjE5MiBudWxsXG4gIGlmICh0eXBlb2YgY29sbCA9PT0gJ3N0cmluZycpIHtcbiAgICByZXR1cm4gY29sbC5sZW5ndGggPT09IDAgPyBudWxsIDogbGF6eVNlcShmdW5jdGlvbiogKCkge1xuICAgICAgZm9yIChjb25zdCBjaGFyIG9mIGNvbGwpIHlpZWxkIGNoYXI7XG4gICAgfSk7XG4gIH1cblxuICAvLyBMYXp5U2VxOiBwYXNzIHRocm91Z2ggZGlyZWN0bHkgKGRvbid0IGNoZWNrIGlzRW1wdHkgLSB0aGF0IHdvdWxkIHJlYWxpemUgaXQhKVxuICAvLyBFbXB0eSBMYXp5U2VxcyB3aWxsIGJlIGhhbmRsZWQgYnkgY29uc3VtZXJzXG4gIGlmIChjb2xsIGluc3RhbmNlb2YgTGF6eVNlcSkge1xuICAgIHJldHVybiBjb2xsO1xuICB9XG5cbiAgLy8gU2V0OiBjaGVjayBpZiBlbXB0eVxuICBpZiAoY29sbCBpbnN0YW5jZW9mIFNldCkge1xuICAgIHJldHVybiBjb2xsLnNpemUgPT09IDAgPyBudWxsIDogbGF6eVNlcShmdW5jdGlvbiogKCkge1xuICAgICAgZm9yIChjb25zdCBpdGVtIG9mIGNvbGwpIHlpZWxkIGl0ZW07XG4gICAgfSk7XG4gIH1cblxuICAvLyBNYXA6IGNoZWNrIGlmIGVtcHR5LCB5aWVsZCBlbnRyaWVzXG4gIGlmIChjb2xsIGluc3RhbmNlb2YgTWFwKSB7XG4gICAgcmV0dXJuIGNvbGwuc2l6ZSA9PT0gMCA/IG51bGwgOiBsYXp5U2VxKGZ1bmN0aW9uKiAoKSB7XG4gICAgICBmb3IgKGNvbnN0IGVudHJ5IG9mIGNvbGwpIHlpZWxkIGVudHJ5O1xuICAgIH0pO1xuICB9XG5cbiAgLy8gUGxhaW4gb2JqZWN0OiBjaGVjayBpZiBlbXB0eSwgeWllbGQgW2tleSwgdmFsdWVdIGVudHJpZXNcbiAgaWYgKHR5cGVvZiBjb2xsID09PSAnb2JqZWN0Jykge1xuICAgIGNvbnN0IGVudHJpZXMgPSBPYmplY3QuZW50cmllcyhjb2xsKTtcbiAgICByZXR1cm4gZW50cmllcy5sZW5ndGggPT09IDAgPyBudWxsIDogbGF6eVNlcShmdW5jdGlvbiogKCkge1xuICAgICAgZm9yIChjb25zdCBlbnRyeSBvZiBlbnRyaWVzKSB5aWVsZCBlbnRyeTtcbiAgICB9KTtcbiAgfVxuXG4gIHRocm93IG5ldyBUeXBlRXJyb3IoYHNlcTogQ2Fubm90IGNyZWF0ZSBzZXF1ZW5jZSBmcm9tICR7dHlwZW9mIGNvbGx9YCk7XG59XG5cbi8qKlxuICogUmV0dXJuIGFuIGVtcHR5IGNvbGxlY3Rpb24gb2YgdGhlIHNhbWUgdHlwZSBhcyBpbnB1dFxuICpcbiAqIFJldHVybnMgZnJlc2ggaW5zdGFuY2VzIChub24tZGVzdHJ1Y3RpdmUpLlxuICogUHJlc2VydmVzIGNvbGxlY3Rpb24gdHlwZTogYXJyYXkgXHUyMTkyIGFycmF5LCBTZXQgXHUyMTkyIFNldCwgZXRjLlxuICpcbiAqIEBwYXJhbSB7Kn0gY29sbCAtIENvbGxlY3Rpb24gdG8gZ2V0IGVtcHR5IGluc3RhbmNlIG9mXG4gKiBAcmV0dXJucyB7Kn0gRW1wdHkgY29sbGVjdGlvbiBvZiBzYW1lIHR5cGVcbiAqXG4gKiBAZXhhbXBsZVxuICogZW1wdHkoWzEsIDIsIDNdKSAgICAgICAgICAgLy8gPT4gW11cbiAqIGVtcHR5KFwiYWJjXCIpICAgICAgICAgICAgICAgLy8gPT4gXCJcIlxuICogZW1wdHkobmV3IFNldChbMSwgMl0pKSAgICAgLy8gPT4gbmV3IFNldCgpXG4gKiBlbXB0eShuZXcgTWFwKFtbMSwyXV0pKSAgICAvLyA9PiBuZXcgTWFwKClcbiAqIGVtcHR5KHthOiAxLCBiOiAyfSkgICAgICAgIC8vID0+IHt9XG4gKiBlbXB0eShudWxsKSAgICAgICAgICAgICAgICAvLyA9PiBudWxsXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBlbXB0eShjb2xsKSB7XG4gIC8vIE5pbCBcdTIxOTIgbnVsbFxuICBpZiAoY29sbCA9PSBudWxsKSByZXR1cm4gbnVsbDtcblxuICAvLyBBcnJheSBcdTIxOTIgZnJlc2ggZW1wdHkgYXJyYXlcbiAgaWYgKEFycmF5LmlzQXJyYXkoY29sbCkpIHJldHVybiBbXTtcblxuICAvLyBTdHJpbmcgXHUyMTkyIGVtcHR5IHN0cmluZ1xuICBpZiAodHlwZW9mIGNvbGwgPT09ICdzdHJpbmcnKSByZXR1cm4gJyc7XG5cbiAgLy8gTGF6eVNlcSBcdTIxOTIgZW1wdHkgTGF6eVNlcVxuICBpZiAoY29sbCBpbnN0YW5jZW9mIExhenlTZXEpIHJldHVybiBFTVBUWV9MQVpZX1NFUTtcblxuICAvLyBTZXQgXHUyMTkyIG5ldyBlbXB0eSBTZXRcbiAgaWYgKGNvbGwgaW5zdGFuY2VvZiBTZXQpIHJldHVybiBuZXcgU2V0KCk7XG5cbiAgLy8gTWFwIFx1MjE5MiBuZXcgZW1wdHkgTWFwXG4gIGlmIChjb2xsIGluc3RhbmNlb2YgTWFwKSByZXR1cm4gbmV3IE1hcCgpO1xuXG4gIC8vIFBsYWluIG9iamVjdCBcdTIxOTIgZnJlc2ggZW1wdHkgb2JqZWN0XG4gIGlmICh0eXBlb2YgY29sbCA9PT0gJ29iamVjdCcpIHJldHVybiB7fTtcblxuICB0aHJvdyBuZXcgVHlwZUVycm9yKGBDYW5ub3QgY3JlYXRlIGVtcHR5IGNvbGxlY3Rpb24gZnJvbSAke3R5cGVvZiBjb2xsfWApO1xufVxuXG4vKipcbiAqIEFkZCBvbmUgb3IgbW9yZSBpdGVtcyB0byBhIGNvbGxlY3Rpb24sIHByZXNlcnZpbmcgdHlwZVxuICpcbiAqIE5vbi1kZXN0cnVjdGl2ZTogcmV0dXJucyBORVcgY29sbGVjdGlvbiB3aXRoIGl0ZW1zIGFkZGVkLlxuICogQXJyYXlzIGFkZCB0byBlbmQuIExhenlTZXFzIHByZXBlbmQgdG8gZnJvbnQgKE8oMSkpLlxuICpcbiAqIEBwYXJhbSB7Kn0gY29sbCAtIENvbGxlY3Rpb24gdG8gYWRkIGl0ZW1zIHRvIChjYW4gYmUgbnVsbClcbiAqIEBwYXJhbSB7Li4uKn0gaXRlbXMgLSBJdGVtcyB0byBhZGRcbiAqIEByZXR1cm5zIHsqfSBOZXcgY29sbGVjdGlvbiB3aXRoIGl0ZW1zIGFkZGVkXG4gKlxuICogQGV4YW1wbGVcbiAqIGNvbmooWzEsIDJdLCAzKSAgICAgICAgICAgICAgICAgICAgLy8gPT4gWzEsIDIsIDNdXG4gKiBjb25qKFsxLCAyXSwgMywgNCkgICAgICAgICAgICAgICAgIC8vID0+IFsxLCAyLCAzLCA0XVxuICogY29uaihuZXcgU2V0KFsxLCAyXSksIDMpICAgICAgICAgICAvLyA9PiBTZXR7MSwgMiwgM31cbiAqIGNvbmoobmV3IE1hcChbWzEsMl1dKSwgWzMsIDRdKSAgICAvLyA9PiBNYXB7MT0+MiwgMz0+NH1cbiAqIGNvbmooe2E6IDF9LCBbXCJiXCIsIDJdKSAgICAgICAgICAgICAvLyA9PiB7YTogMSwgYjogMn1cbiAqIGNvbmooXCJhYlwiLCBcImNcIiwgXCJkXCIpICAgICAgICAgICAgICAgLy8gPT4gXCJhYmNkXCJcbiAqIGNvbmoobnVsbCwgMSkgICAgICAgICAgICAgICAgICAgICAgLy8gPT4gWzFdXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjb25qKGNvbGwsIC4uLml0ZW1zKSB7XG4gIC8vIE5vIGl0ZW1zIFx1MjE5MiByZXR1cm4gY29sbGVjdGlvbiB1bmNoYW5nZWRcbiAgaWYgKGl0ZW1zLmxlbmd0aCA9PT0gMCkge1xuICAgIHJldHVybiBjb2xsID09IG51bGwgPyBbXSA6IGNvbGw7XG4gIH1cblxuICAvLyBOaWwgXHUyMTkyIGNyZWF0ZSBhcnJheVxuICBpZiAoY29sbCA9PSBudWxsKSB7XG4gICAgcmV0dXJuIFsuLi5pdGVtc107XG4gIH1cblxuICAvLyBBcnJheSBcdTIxOTIgc3ByZWFkIGFuZCBhcHBlbmRcbiAgaWYgKEFycmF5LmlzQXJyYXkoY29sbCkpIHtcbiAgICByZXR1cm4gWy4uLmNvbGwsIC4uLml0ZW1zXTtcbiAgfVxuXG4gIC8vIFN0cmluZyBcdTIxOTIgY29uY2F0ZW5hdGVcbiAgaWYgKHR5cGVvZiBjb2xsID09PSAnc3RyaW5nJykge1xuICAgIHJldHVybiBjb2xsICsgaXRlbXMuam9pbignJyk7XG4gIH1cblxuICAvLyBMYXp5U2VxIFx1MjE5MiBwcmVwZW5kIGl0ZW1zIChjb25zIGVhY2ggaXRlbSB0byBmcm9udClcbiAgaWYgKGNvbGwgaW5zdGFuY2VvZiBMYXp5U2VxKSB7XG4gICAgLy8gUHJlcGVuZCBlYWNoIGl0ZW0gaW4gcmV2ZXJzZSBvcmRlciB0byBtYWludGFpbiBvcmRlclxuICAgIGxldCByZXN1bHQgPSBjb2xsO1xuICAgIGZvciAobGV0IGkgPSBpdGVtcy5sZW5ndGggLSAxOyBpID49IDA7IGktLSkge1xuICAgICAgcmVzdWx0ID0gY29ucyhpdGVtc1tpXSwgcmVzdWx0KTtcbiAgICB9XG4gICAgcmV0dXJuIHJlc3VsdDtcbiAgfVxuXG4gIC8vIFNldCBcdTIxOTIgYWRkIGl0ZW1zXG4gIGlmIChjb2xsIGluc3RhbmNlb2YgU2V0KSB7XG4gICAgY29uc3QgcmVzdWx0ID0gbmV3IFNldChjb2xsKTtcbiAgICBmb3IgKGNvbnN0IGl0ZW0gb2YgaXRlbXMpIHtcbiAgICAgIHJlc3VsdC5hZGQoaXRlbSk7XG4gICAgfVxuICAgIHJldHVybiByZXN1bHQ7XG4gIH1cblxuICAvLyBNYXAgXHUyMTkyIGFkZCBba2V5LCB2YWx1ZV0gcGFpcnNcbiAgaWYgKGNvbGwgaW5zdGFuY2VvZiBNYXApIHtcbiAgICBjb25zdCByZXN1bHQgPSBuZXcgTWFwKGNvbGwpO1xuICAgIGZvciAoY29uc3QgaXRlbSBvZiBpdGVtcykge1xuICAgICAgaWYgKCFBcnJheS5pc0FycmF5KGl0ZW0pIHx8IGl0ZW0ubGVuZ3RoICE9PSAyKSB7XG4gICAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoXG4gICAgICAgICAgYE1hcCBlbnRyaWVzIG11c3QgYmUgW2tleSwgdmFsdWVdIHBhaXJzLCBnb3QgJHt0eXBlb2YgaXRlbX1gXG4gICAgICAgICk7XG4gICAgICB9XG4gICAgICByZXN1bHQuc2V0KGl0ZW1bMF0sIGl0ZW1bMV0pO1xuICAgIH1cbiAgICByZXR1cm4gcmVzdWx0O1xuICB9XG5cbiAgLy8gUGxhaW4gb2JqZWN0IFx1MjE5MiBtZXJnZSBba2V5LCB2YWx1ZV0gcGFpcnNcbiAgaWYgKHR5cGVvZiBjb2xsID09PSAnb2JqZWN0Jykge1xuICAgIGNvbnN0IHJlc3VsdCA9IHsgLi4uY29sbCB9O1xuICAgIGZvciAoY29uc3QgaXRlbSBvZiBpdGVtcykge1xuICAgICAgaWYgKCFBcnJheS5pc0FycmF5KGl0ZW0pIHx8IGl0ZW0ubGVuZ3RoICE9PSAyKSB7XG4gICAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoXG4gICAgICAgICAgYE9iamVjdCBlbnRyaWVzIG11c3QgYmUgW2tleSwgdmFsdWVdIHBhaXJzLCBnb3QgJHt0eXBlb2YgaXRlbX1gXG4gICAgICAgICk7XG4gICAgICB9XG4gICAgICByZXN1bHRbaXRlbVswXV0gPSBpdGVtWzFdO1xuICAgIH1cbiAgICByZXR1cm4gcmVzdWx0O1xuICB9XG5cbiAgdGhyb3cgbmV3IFR5cGVFcnJvcihgQ2Fubm90IGNvbmogdG8gJHt0eXBlb2YgY29sbH1gKTtcbn1cblxuLyoqXG4gKiBQb3VyIGFsbCBpdGVtcyBmcm9tIGBmcm9tYCBjb2xsZWN0aW9uIGludG8gYHRvYCBjb2xsZWN0aW9uXG4gKlxuICogUHJlc2VydmVzIHR5cGUgb2YgYHRvYCBjb2xsZWN0aW9uLiBVc2VzIGBjb25qYCBpbnRlcm5hbGx5LlxuICogTm9uLWRlc3RydWN0aXZlOiByZXR1cm5zIE5FVyBjb2xsZWN0aW9uLlxuICpcbiAqIEBwYXJhbSB7Kn0gdG8gLSBUYXJnZXQgY29sbGVjdGlvbiAoY2FuIGJlIG51bGwpIChjYW4gYmUgbnVsbClcbiAqIEBwYXJhbSB7SXRlcmFibGV8bnVsbHx1bmRlZmluZWR9IGZyb20gLSBTb3VyY2UgY29sbGVjdGlvbiB0byBwb3VyIGZyb21cbiAqIEByZXR1cm5zIHsqfSBOZXcgY29sbGVjdGlvbiB3aXRoIGl0ZW1zIGZyb20gYGZyb21gIGFkZGVkIHRvIGB0b2BcbiAqXG4gKiBAZXhhbXBsZVxuICogaW50byhbXSwgWzEsIDIsIDNdKSAgICAgICAgICAgICAgICAgIC8vID0+IFsxLCAyLCAzXVxuICogaW50byhuZXcgU2V0KCksIFsxLCAyLCAyLCAzXSkgICAgICAgIC8vID0+IFNldHsxLCAyLCAzfVxuICogaW50byh7fSwgW1tcImFcIiwgMV0sIFtcImJcIiwgMl1dKSAgICAgICAvLyA9PiB7YTogMSwgYjogMn1cbiAqIGludG8oWzEsIDJdLCBbMywgNF0pICAgICAgICAgICAgICAgICAvLyA9PiBbMSwgMiwgMywgNF1cbiAqIGludG8obnVsbCwgWzEsIDJdKSAgICAgICAgICAgICAgICAgICAvLyA9PiBbMSwgMl1cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGludG8odG8sIGZyb20pIHtcbiAgLy8gTmlsIGZyb20gXHUyMTkyIHJldHVybiB0byB1bmNoYW5nZWRcbiAgaWYgKGZyb20gPT0gbnVsbCkge1xuICAgIHJldHVybiB0byA9PSBudWxsID8gW10gOiB0bztcbiAgfVxuXG4gIC8vIFVzZSByZWR1Y2UgdG8gY29uaiBlYWNoIGl0ZW0gZnJvbSBgZnJvbWAgaW50byBgdG9gXG4gIHJldHVybiByZWR1Y2UoKGFjYywgaXRlbSkgPT4gY29uaihhY2MsIGl0ZW0pLCB0bywgZnJvbSk7XG59XG5cbi8vIFx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVxuLy8gTEFaWSBDT05TVFJVQ1RPUlMgKFdlZWsgNClcbi8vIFx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVxuXG4vKipcbiAqIENyZWF0ZSBhbiBpbmZpbml0ZSBsYXp5IHNlcXVlbmNlIG9mIHJlcGVhdGVkIHZhbHVlXG4gKlxuICogUmV0dXJucyB0aGUgU0FNRSByZWZlcmVuY2UgZXZlcnkgdGltZSAobm90IGNvcHlpbmcpLlxuICogVXNlIHdpdGggYHRha2UoKWAgdG8gcmVhbGl6ZSBmaW5pdGUgcG9ydGlvbnMuXG4gKlxuICogQHBhcmFtIHsqfSB4IC0gVmFsdWUgdG8gcmVwZWF0IGluZmluaXRlbHlcbiAqIEByZXR1cm5zIHtMYXp5U2VxfSBJbmZpbml0ZSBzZXF1ZW5jZSBvZiB4XG4gKlxuICogQGV4YW1wbGVcbiAqIGRvYWxsKHRha2UoMywgcmVwZWF0KDUpKSkgICAgICAgICAgIC8vID0+IFs1LCA1LCA1XVxuICogZG9hbGwodGFrZSgzLCByZXBlYXQoe2E6IDF9KSkpICAgICAgLy8gPT4gW3thOjF9LCB7YToxfSwge2E6MX1dIChzYW1lIHJlZiEpXG4gKiBkb2FsbCh0YWtlKDMsIHJlcGVhdChudWxsKSkpICAgICAgICAvLyA9PiBbbnVsbCwgbnVsbCwgbnVsbF1cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHJlcGVhdCh4KSB7XG4gIHJldHVybiBsYXp5U2VxKGZ1bmN0aW9uKiAoKSB7XG4gICAgd2hpbGUgKHRydWUpIHtcbiAgICAgIHlpZWxkIHg7XG4gICAgfVxuICB9KTtcbn1cblxuLyoqXG4gKiBDcmVhdGUgYW4gaW5maW5pdGUgbGF6eSBzZXF1ZW5jZSBieSBjYWxsaW5nIGZ1bmN0aW9uIGYgcmVwZWF0ZWRseVxuICpcbiAqIEZ1bmN0aW9uIGlzIGNhbGxlZCBFQUNIIFRJTUUgYSB2YWx1ZSBpcyByZWFsaXplZCAobm90IGNhY2hlZCkuXG4gKiBFbmFibGVzIHNpZGUgZWZmZWN0cyBhbmQgZnJlc2ggb2JqZWN0IGdlbmVyYXRpb24uXG4gKlxuICogQHBhcmFtIHtGdW5jdGlvbn0gZiAtIFplcm8tYXJpdHkgZnVuY3Rpb24gdG8gY2FsbCByZXBlYXRlZGx5XG4gKiBAcmV0dXJucyB7TGF6eVNlcX0gSW5maW5pdGUgc2VxdWVuY2Ugb2YgZigpIHJlc3VsdHNcbiAqXG4gKiBAZXhhbXBsZVxuICogbGV0IGNvdW50ZXIgPSAwO1xuICogZG9hbGwodGFrZSgzLCByZXBlYXRlZGx5KCgpID0+IGNvdW50ZXIrKykpKSAgLy8gPT4gWzAsIDEsIDJdXG4gKlxuICogZG9hbGwodGFrZSgzLCByZXBlYXRlZGx5KCgpID0+ICh7aWQ6IDF9KSkpKVxuICogLy8gPT4gW3tpZDoxfSwge2lkOjF9LCB7aWQ6MX1dIChmcmVzaCBvYmplY3RzISlcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHJlcGVhdGVkbHkoZikge1xuICB2YWxpZGF0ZUZ1bmN0aW9uKGYsICdyZXBlYXRlZGx5JywgJ2dlbmVyYXRvciBmdW5jdGlvbicpO1xuXG4gIHJldHVybiBsYXp5U2VxKGZ1bmN0aW9uKiAoKSB7XG4gICAgd2hpbGUgKHRydWUpIHtcbiAgICAgIHlpZWxkIGYoKTtcbiAgICB9XG4gIH0pO1xufVxuXG4vKipcbiAqIENyZWF0ZSBhbiBpbmZpbml0ZSBsYXp5IHNlcXVlbmNlIGJ5IGN5Y2xpbmcgdGhyb3VnaCBhIGNvbGxlY3Rpb25cbiAqXG4gKiBFbXB0eSBvciBuaWwgY29sbGVjdGlvbnMgcmV0dXJuIEVNUFRZX0xBWllfU0VRIChub3QgaW5maW5pdGUpLlxuICogQ29sbGVjdGlvbiBpcyBlYWdlcmx5IGNvbnZlcnRlZCB0byBhcnJheSwgdGhlbiBjeWNsZWQgaW5maW5pdGVseS5cbiAqXG4gKiBAcGFyYW0ge0l0ZXJhYmxlfG51bGx8dW5kZWZpbmVkfSBjb2xsIC0gQ29sbGVjdGlvbiB0byBjeWNsZSB0aHJvdWdoXG4gKiBAcmV0dXJucyB7TGF6eVNlcX0gSW5maW5pdGUgY3ljbGUgdGhyb3VnaCBjb2xsZWN0aW9uXG4gKlxuICogQGV4YW1wbGVcbiAqIGRvYWxsKHRha2UoNywgY3ljbGUoWzEsIDIsIDNdKSkpICAgICAvLyA9PiBbMSwgMiwgMywgMSwgMiwgMywgMV1cbiAqIGRvYWxsKHRha2UoNCwgY3ljbGUoXCJhYlwiKSkpICAgICAgICAgIC8vID0+IFtcImFcIiwgXCJiXCIsIFwiYVwiLCBcImJcIl1cbiAqIGN5Y2xlKFtdKSAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyA9PiBFTVBUWV9MQVpZX1NFUVxuICogY3ljbGUobnVsbCkgICAgICAgICAgICAgICAgICAgICAgICAgIC8vID0+IEVNUFRZX0xBWllfU0VRXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjeWNsZShjb2xsKSB7XG4gIC8vIEVtcHR5L25pbCBjb2xsZWN0aW9uIFx1MjE5MiBlbXB0eSBzZXF1ZW5jZSAoTk9UIGluZmluaXRlKVxuICBpZiAoY29sbCA9PSBudWxsKSByZXR1cm4gRU1QVFlfTEFaWV9TRVE7XG5cbiAgLy8gQ29udmVydCB0byBhcnJheSBmb3IgY3ljbGluZyAoZWFnZXIgcmVhbGl6YXRpb24gcmVxdWlyZWQpXG4gIC8vIE5vdGU6IE11c3QgcmVhbGl6ZSBoZXJlIHRvIGNhY2hlIGZvciBpbmZpbml0ZSBjeWNsaW5nXG4gIGNvbnN0IGl0ZW1zID0gQXJyYXkuZnJvbShjb2xsKTtcbiAgaWYgKGl0ZW1zLmxlbmd0aCA9PT0gMCkgcmV0dXJuIEVNUFRZX0xBWllfU0VRO1xuXG4gIHJldHVybiBsYXp5U2VxKGZ1bmN0aW9uKiAoKSB7XG4gICAgd2hpbGUgKHRydWUpIHtcbiAgICAgIGZvciAoY29uc3QgaXRlbSBvZiBpdGVtcykge1xuICAgICAgICB5aWVsZCBpdGVtO1xuICAgICAgfVxuICAgIH1cbiAgfSk7XG59XG5cbi8vIFx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVxuLy8gU0VRVUVOQ0UgUFJFRElDQVRFUyAoV2VlayA1KVxuLy8gXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXG5cbi8qKlxuICogUmV0dXJucyB0cnVlIGlmIHByZWRpY2F0ZSByZXR1cm5zIGxvZ2ljYWwgdHJ1ZSBmb3IgYWxsIGl0ZW1zIGluIGNvbGxlY3Rpb25cbiAqXG4gKiBVc2VzIHNob3J0LWNpcmN1aXQgZXZhbHVhdGlvbiAtIHN0b3BzIGF0IGZpcnN0IGZhbHN5IHJlc3VsdC5cbiAqIEVtcHR5IGNvbGxlY3Rpb25zIHJldHVybiB0cnVlICh2YWN1b3VzIHRydXRoKS5cbiAqXG4gKiBAcGFyYW0ge0Z1bmN0aW9ufSBwcmVkIC0gUHJlZGljYXRlIGZ1bmN0aW9uIHRvIHRlc3QgZWFjaCBpdGVtXG4gKiBAcGFyYW0ge0l0ZXJhYmxlfG51bGx8dW5kZWZpbmVkfSBjb2xsIC0gQ29sbGVjdGlvbiB0byB0ZXN0XG4gKiBAcmV0dXJucyB7Ym9vbGVhbn0gVHJ1ZSBpZiBhbGwgaXRlbXMgbWF0Y2ggcHJlZGljYXRlXG4gKlxuICogQGV4YW1wbGVcbiAqIC8vIEFsbCBtYXRjaFxuICogZXZlcnkoeCA9PiB4ICUgMiA9PT0gMCwgWzIsIDQsIDZdKSAgICAgICAgLy8gPT4gdHJ1ZVxuICpcbiAqIEBleGFtcGxlXG4gKiAvLyBTb21lIGRvbid0IG1hdGNoXG4gKiBldmVyeSh4ID0+IHggJSAyID09PSAwLCBbMiwgMywgNl0pICAgICAgICAvLyA9PiBmYWxzZVxuICpcbiAqIEBleGFtcGxlXG4gKiAvLyBFbXB0eSBjb2xsZWN0aW9uICh2YWN1b3VzIHRydXRoKVxuICogZXZlcnkoeCA9PiB4ID4gMTAwMCwgW10pICAgICAgICAgICAgICAgICAgIC8vID0+IHRydWVcbiAqXG4gKiBAZXhhbXBsZVxuICogLy8gU3RvcHMgZWFybHkgb24gZmlyc3QgZmFsc3lcbiAqIGxldCBjb3VudCA9IDA7XG4gKiBldmVyeSh4ID0+IHsgY291bnQrKzsgcmV0dXJuIHggPCA1OyB9LCBbMSwgMiwgMywgMTAsIDRdKVxuICogLy8gY291bnQgPT09IDQgKHN0b3BzIGF0IDEwKVxuICovXG5leHBvcnQgZnVuY3Rpb24gZXZlcnkocHJlZCwgY29sbCkge1xuICB2YWxpZGF0ZUZ1bmN0aW9uKHByZWQsICdldmVyeScsICdwcmVkaWNhdGUnKTtcblxuICBpZiAoY29sbCA9PSBudWxsKSByZXR1cm4gdHJ1ZTsgIC8vIFZhY3VvdXMgdHJ1dGggZm9yIG5pbFxuXG4gIC8vIEFycmF5IGZhc3QgcGF0aDogaW5kZXhlZCBpdGVyYXRpb24gKDItM3ggZmFzdGVyKVxuICBpZiAoQXJyYXkuaXNBcnJheShjb2xsKSkge1xuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgY29sbC5sZW5ndGg7IGkrKykge1xuICAgICAgaWYgKCFwcmVkKGNvbGxbaV0pKSB7ICAvLyBGaXJzdCBmYWxzeSByZXN1bHRcbiAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4gdHJ1ZTsgIC8vIEFsbCBwYXNzZWRcbiAgfVxuXG4gIC8vIEdlbmVyaWMgcGF0aCBmb3Igb3RoZXIgaXRlcmFibGVzXG4gIGZvciAoY29uc3QgaXRlbSBvZiBjb2xsKSB7XG4gICAgaWYgKCFwcmVkKGl0ZW0pKSB7ICAvLyBGaXJzdCBmYWxzeSByZXN1bHRcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIHRydWU7ICAvLyBBbGwgcGFzc2VkXG59XG5cbi8qKlxuICogUmV0dXJucyB0cnVlIGlmIHByZWRpY2F0ZSByZXR1cm5zIGxvZ2ljYWwgZmFsc2UgZm9yIGFsbCBpdGVtc1xuICpcbiAqIEVxdWl2YWxlbnQgdG8gKG5vdCAoc29tZSBwcmVkIGNvbGwpKS5cbiAqIFVzZXMgc2hvcnQtY2lyY3VpdCBldmFsdWF0aW9uIC0gc3RvcHMgYXQgZmlyc3QgdHJ1dGh5IHJlc3VsdC5cbiAqXG4gKiBAcGFyYW0ge0Z1bmN0aW9ufSBwcmVkIC0gUHJlZGljYXRlIGZ1bmN0aW9uIHRvIHRlc3QgZWFjaCBpdGVtXG4gKiBAcGFyYW0ge0l0ZXJhYmxlfG51bGx8dW5kZWZpbmVkfSBjb2xsIC0gQ29sbGVjdGlvbiB0byB0ZXN0XG4gKiBAcmV0dXJucyB7Ym9vbGVhbn0gVHJ1ZSBpZiBubyBpdGVtcyBtYXRjaCBwcmVkaWNhdGVcbiAqXG4gKiBAZXhhbXBsZVxuICogLy8gTm8gaXRlbXMgbWF0Y2hcbiAqIG5vdEFueSh4ID0+IHggJSAyID09PSAwLCBbMSwgMywgNV0pICAgICAgIC8vID0+IHRydWVcbiAqXG4gKiBAZXhhbXBsZVxuICogLy8gU29tZSBpdGVtcyBtYXRjaFxuICogbm90QW55KHggPT4geCAlIDIgPT09IDAsIFsxLCAyLCA1XSkgICAgICAgLy8gPT4gZmFsc2VcbiAqXG4gKiBAZXhhbXBsZVxuICogLy8gRW1wdHkgY29sbGVjdGlvblxuICogbm90QW55KHggPT4geCA+IDAsIFtdKSAgICAgICAgICAgICAgICAgICAgIC8vID0+IHRydWVcbiAqXG4gKiBAZXhhbXBsZVxuICogLy8gU3RvcHMgZWFybHkgb24gZmlyc3QgdHJ1dGh5XG4gKiBsZXQgY291bnQgPSAwO1xuICogbm90QW55KHggPT4geyBjb3VudCsrOyByZXR1cm4geCA+IDU7IH0sIFsxLCAyLCAzLCAxMCwgNF0pXG4gKiAvLyBjb3VudCA9PT0gNCAoc3RvcHMgYXQgMTApXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBub3RBbnkocHJlZCwgY29sbCkge1xuICB2YWxpZGF0ZUZ1bmN0aW9uKHByZWQsICdub3RBbnknLCAncHJlZGljYXRlJyk7XG5cbiAgaWYgKGNvbGwgPT0gbnVsbCkgcmV0dXJuIHRydWU7XG5cbiAgLy8gQXJyYXkgZmFzdCBwYXRoOiBpbmRleGVkIGl0ZXJhdGlvbiAoMi0zeCBmYXN0ZXIpXG4gIGlmIChBcnJheS5pc0FycmF5KGNvbGwpKSB7XG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCBjb2xsLmxlbmd0aDsgaSsrKSB7XG4gICAgICBpZiAocHJlZChjb2xsW2ldKSkgeyAgLy8gRmlyc3QgdHJ1dGh5IHJlc3VsdFxuICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICB9XG4gICAgfVxuICAgIHJldHVybiB0cnVlOyAgLy8gTm9uZSBwYXNzZWRcbiAgfVxuXG4gIC8vIEdlbmVyaWMgcGF0aCBmb3Igb3RoZXIgaXRlcmFibGVzXG4gIGZvciAoY29uc3QgaXRlbSBvZiBjb2xsKSB7XG4gICAgaWYgKHByZWQoaXRlbSkpIHsgIC8vIEZpcnN0IHRydXRoeSByZXN1bHRcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIHRydWU7ICAvLyBOb25lIHBhc3NlZFxufVxuXG4vKipcbiAqIFJldHVybnMgdHJ1ZSBpZiBwcmVkaWNhdGUgcmV0dXJucyBsb2dpY2FsIGZhbHNlIGZvciBhdCBsZWFzdCBvbmUgaXRlbVxuICpcbiAqIEVxdWl2YWxlbnQgdG8gKG5vdCAoZXZlcnk/IHByZWQgY29sbCkpLlxuICogVXNlcyBzaG9ydC1jaXJjdWl0IGV2YWx1YXRpb24gLSBzdG9wcyBhdCBmaXJzdCBmYWxzeSByZXN1bHQuXG4gKlxuICogQHBhcmFtIHtGdW5jdGlvbn0gcHJlZCAtIFByZWRpY2F0ZSBmdW5jdGlvbiB0byB0ZXN0IGVhY2ggaXRlbVxuICogQHBhcmFtIHtJdGVyYWJsZXxudWxsfHVuZGVmaW5lZH0gY29sbCAtIENvbGxlY3Rpb24gdG8gdGVzdFxuICogQHJldHVybnMge2Jvb2xlYW59IFRydWUgaWYgYXQgbGVhc3Qgb25lIGl0ZW0gZG9lc24ndCBtYXRjaCBwcmVkaWNhdGVcbiAqXG4gKiBAZXhhbXBsZVxuICogLy8gQWxsIG1hdGNoIChyZXR1cm5zIGZhbHNlKVxuICogbm90RXZlcnkoeCA9PiB4ICUgMiA9PT0gMCwgWzIsIDQsIDZdKSAgICAgLy8gPT4gZmFsc2VcbiAqXG4gKiBAZXhhbXBsZVxuICogLy8gU29tZSBkb24ndCBtYXRjaCAocmV0dXJucyB0cnVlKVxuICogbm90RXZlcnkoeCA9PiB4ICUgMiA9PT0gMCwgWzIsIDMsIDZdKSAgICAgLy8gPT4gdHJ1ZVxuICpcbiAqIEBleGFtcGxlXG4gKiAvLyBFbXB0eSBjb2xsZWN0aW9uIChub3QgdmFjdW91cyB0cnV0aClcbiAqIG5vdEV2ZXJ5KHggPT4geCA+IDEwMDAsIFtdKSAgICAgICAgICAgICAgICAvLyA9PiBmYWxzZVxuICpcbiAqIEBleGFtcGxlXG4gKiAvLyBTdG9wcyBlYXJseSBvbiBmaXJzdCBmYWxzeVxuICogbGV0IGNvdW50ID0gMDtcbiAqIG5vdEV2ZXJ5KHggPT4geyBjb3VudCsrOyByZXR1cm4geCA8IDU7IH0sIFsxLCAyLCAzLCAxMCwgNF0pXG4gKiAvLyBjb3VudCA9PT0gNCAoc3RvcHMgYXQgMTApXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBub3RFdmVyeShwcmVkLCBjb2xsKSB7XG4gIHZhbGlkYXRlRnVuY3Rpb24ocHJlZCwgJ25vdEV2ZXJ5JywgJ3ByZWRpY2F0ZScpO1xuXG4gIGlmIChjb2xsID09IG51bGwpIHJldHVybiBmYWxzZTsgIC8vIG5vdChldmVyeShwcmVkLCBudWxsKSkgPSBub3QodHJ1ZSkgPSBmYWxzZVxuXG4gIC8vIEFycmF5IGZhc3QgcGF0aDogaW5kZXhlZCBpdGVyYXRpb24gKDItM3ggZmFzdGVyKVxuICBpZiAoQXJyYXkuaXNBcnJheShjb2xsKSkge1xuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgY29sbC5sZW5ndGg7IGkrKykge1xuICAgICAgaWYgKCFwcmVkKGNvbGxbaV0pKSB7ICAvLyBGaXJzdCBmYWxzeSByZXN1bHRcbiAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICB9XG4gICAgfVxuICAgIHJldHVybiBmYWxzZTsgIC8vIEFsbCBwYXNzZWQsIHNvIE5PVCBldmVyeSBpcyBmYWxzZVxuICB9XG5cbiAgLy8gR2VuZXJpYyBwYXRoIGZvciBvdGhlciBpdGVyYWJsZXNcbiAgZm9yIChjb25zdCBpdGVtIG9mIGNvbGwpIHtcbiAgICBpZiAoIXByZWQoaXRlbSkpIHsgIC8vIEZpcnN0IGZhbHN5IHJlc3VsdFxuICAgICAgcmV0dXJuIHRydWU7XG4gICAgfVxuICB9XG4gIHJldHVybiBmYWxzZTsgIC8vIEFsbCBwYXNzZWQsIHNvIE5PVCBldmVyeSBpcyBmYWxzZVxufVxuXG4vKipcbiAqIFJldHVybnMgdHJ1ZSBpZiB2YWx1ZSBpcyBub3QgbnVsbCBvciB1bmRlZmluZWRcbiAqXG4gKiBOb3RlOiBUaGlzIG9ubHkgY2hlY2tzIGZvciBuaWwgKG51bGwvdW5kZWZpbmVkKSwgbm90IGZhbHNpbmVzcy5cbiAqIFZhbHVlcyBsaWtlIDAsIGZhbHNlLCBhbmQgXCJcIiByZXR1cm4gdHJ1ZS5cbiAqXG4gKiBAcGFyYW0geyp9IHggLSBWYWx1ZSB0byBjaGVja1xuICogQHJldHVybnMge2Jvb2xlYW59IFRydWUgaWYgdmFsdWUgaXMgbm90IG51bGwgb3IgdW5kZWZpbmVkXG4gKlxuICogQGV4YW1wbGVcbiAqIC8vIE5pbCB2YWx1ZXNcbiAqIGlzU29tZShudWxsKSAgICAgICAgICAgLy8gPT4gZmFsc2VcbiAqIGlzU29tZSh1bmRlZmluZWQpICAgICAgLy8gPT4gZmFsc2VcbiAqXG4gKiBAZXhhbXBsZVxuICogLy8gRmFsc3kgYnV0IG5vdCBuaWxcbiAqIGlzU29tZSgwKSAgICAgICAgICAgICAgLy8gPT4gdHJ1ZVxuICogaXNTb21lKGZhbHNlKSAgICAgICAgICAvLyA9PiB0cnVlXG4gKiBpc1NvbWUoXCJcIikgICAgICAgICAgICAgLy8gPT4gdHJ1ZVxuICpcbiAqIEBleGFtcGxlXG4gKiAvLyBUcnV0aHkgdmFsdWVzXG4gKiBpc1NvbWUoW10pICAgICAgICAgICAgIC8vID0+IHRydWVcbiAqIGlzU29tZSh7fSkgICAgICAgICAgICAgLy8gPT4gdHJ1ZVxuICogaXNTb21lKFwiaGVsbG9cIikgICAgICAgIC8vID0+IHRydWVcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGlzU29tZSh4KSB7XG4gIHJldHVybiB4ICE9IG51bGw7ICAvLyBDaGVja3MgYm90aCBudWxsIGFuZCB1bmRlZmluZWRcbn1cblxuLy8gXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXG4vLyBXRUVLIDY6IE1BUC9PQkpFQ1QgT1BFUkFUSU9OUyAmIFRZUEUgQ09OVkVSU0lPTlNcbi8vIFx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVxuXG4vKipcbiAqIFJldHVybnMgdmFsdWUgYXQga2V5IGluIG1hcCwgb3Igbm90Rm91bmQgaWYgbm90IHByZXNlbnQuXG4gKiBXb3JrcyB3aXRoIGJvdGggTWFwIGFuZCBPYmplY3QuIE5pbC1zYWZlLlxuICpcbiAqIEBwYXJhbSB7T2JqZWN0fE1hcHxudWxsfHVuZGVmaW5lZH0gbWFwIC0gTWFwIG9yIG9iamVjdCB0byBhY2Nlc3NcbiAqIEBwYXJhbSB7Kn0ga2V5IC0gS2V5IHRvIGxvb2sgdXBcbiAqIEBwYXJhbSB7Kn0gW25vdEZvdW5kPXVuZGVmaW5lZF0gLSBEZWZhdWx0IHZhbHVlIGlmIGtleSBub3QgZm91bmRcbiAqIEByZXR1cm5zIHsqfSBWYWx1ZSBhdCBrZXksIG9yIG5vdEZvdW5kXG4gKlxuICogQGV4YW1wbGVcbiAqIGdldCh7YTogMSwgYjogMn0sICdhJykgICAgICAgICAgIC8vID0+IDFcbiAqIGdldCh7YTogMX0sICdiJywgJ2RlZmF1bHQnKSAgICAgICAvLyA9PiAnZGVmYXVsdCdcbiAqIGdldChuZXcgTWFwKFtbJ3gnLCAxMF1dKSwgJ3gnKSAgIC8vID0+IDEwXG4gKiBnZXQobnVsbCwgJ2tleScsICdOL0EnKSAgICAgICAgICAvLyA9PiAnTi9BJ1xuICpcbiAqIEBleGFtcGxlXG4gKiAvLyBIYW5kbGVzIGZhbHN5IHZhbHVlc1xuICogZ2V0KHthOiAwfSwgJ2EnKSAgICAgICAgICAgICAgICAgLy8gPT4gMFxuICogZ2V0KHthOiBmYWxzZX0sICdhJykgICAgICAgICAgICAgLy8gPT4gZmFsc2VcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGdldChtYXAsIGtleSwgbm90Rm91bmQgPSB1bmRlZmluZWQpIHtcbiAgaWYgKG1hcCA9PSBudWxsKSByZXR1cm4gbm90Rm91bmQ7XG5cbiAgaWYgKG1hcCBpbnN0YW5jZW9mIE1hcCkge1xuICAgIHJldHVybiBtYXAuaGFzKGtleSkgPyBtYXAuZ2V0KGtleSkgOiBub3RGb3VuZDtcbiAgfVxuXG4gIC8vIFdvcmtzIGZvciBib3RoIG9iamVjdHMgYW5kIGFycmF5cyAobnVtZXJpYyBrZXlzKVxuICByZXR1cm4gKGtleSBpbiBtYXApID8gbWFwW2tleV0gOiBub3RGb3VuZDtcbn1cblxuLyoqXG4gKiBSZXR1cm5zIHZhbHVlIGF0IG5lc3RlZCBwYXRoIGluIG1hcCwgb3Igbm90Rm91bmQgaWYgbm90IHByZXNlbnQuXG4gKiBTaG9ydC1jaXJjdWl0cyBvbiBmaXJzdCBudWxsL3VuZGVmaW5lZCBpbiBwYXRoLlxuICpcbiAqIEBwYXJhbSB7T2JqZWN0fE1hcHxudWxsfHVuZGVmaW5lZH0gbWFwIC0gTmVzdGVkIHN0cnVjdHVyZSB0byBhY2Nlc3NcbiAqIEBwYXJhbSB7QXJyYXl9IHBhdGggLSBBcnJheSBvZiBrZXlzIHJlcHJlc2VudGluZyBwYXRoXG4gKiBAcGFyYW0geyp9IFtub3RGb3VuZD11bmRlZmluZWRdIC0gRGVmYXVsdCB2YWx1ZSBpZiBwYXRoIG5vdCBmb3VuZFxuICogQHJldHVybnMgeyp9IFZhbHVlIGF0IHBhdGgsIG9yIG5vdEZvdW5kXG4gKlxuICogQGV4YW1wbGVcbiAqIGdldEluKHt1c2VyOiB7bmFtZTogJ0FsaWNlJ319LCBbJ3VzZXInLCAnbmFtZSddKSAgLy8gPT4gJ0FsaWNlJ1xuICogZ2V0SW4oe2E6IHtiOiB7YzogM319fSwgWydhJywgJ2InLCAnYyddKSAgICAgICAgICAvLyA9PiAzXG4gKiBnZXRJbih7dXNlcjogbnVsbH0sIFsndXNlcicsICduYW1lJ10sICdOL0EnKSAgICAgIC8vID0+ICdOL0EnXG4gKlxuICogQGV4YW1wbGVcbiAqIC8vIFdvcmtzIHdpdGggYXJyYXlzXG4gKiBnZXRJbih7aXRlbXM6IFsnYScsICdiJywgJ2MnXX0sIFsnaXRlbXMnLCAxXSkgICAgIC8vID0+ICdiJ1xuICovXG5leHBvcnQgZnVuY3Rpb24gZ2V0SW4obWFwLCBwYXRoLCBub3RGb3VuZCA9IHVuZGVmaW5lZCkge1xuICBpZiAocGF0aC5sZW5ndGggPT09IDApIHJldHVybiBtYXA7XG5cbiAgbGV0IGN1cnJlbnQgPSBtYXA7XG4gIGZvciAoY29uc3Qga2V5IG9mIHBhdGgpIHtcbiAgICBjdXJyZW50ID0gZ2V0KGN1cnJlbnQsIGtleSwgbnVsbCk7XG4gICAgaWYgKGN1cnJlbnQgPT0gbnVsbCkgcmV0dXJuIG5vdEZvdW5kO1xuICB9XG4gIHJldHVybiBjdXJyZW50O1xufVxuXG4vKipcbiAqIFJldHVybnMgbmV3IG1hcCB3aXRoIGtleSBtYXBwZWQgdG8gdmFsdWUuIE9yaWdpbmFsIHVuY2hhbmdlZC5cbiAqIFdvcmtzIHdpdGggYm90aCBNYXAgYW5kIE9iamVjdC4gTyhuKSBzaGFsbG93IGNvcHkuXG4gKlxuICogQHBhcmFtIHtPYmplY3R8TWFwfG51bGx8dW5kZWZpbmVkfSBtYXAgLSBNYXAgb3Igb2JqZWN0IHRvIHVwZGF0ZVxuICogQHBhcmFtIHsqfSBrZXkgLSBLZXkgdG8gc2V0XG4gKiBAcGFyYW0geyp9IHZhbHVlIC0gVmFsdWUgdG8gYXNzb2NpYXRlIHdpdGgga2V5XG4gKiBAcmV0dXJucyB7Kn0gTmV3IG1hcCB3aXRoIGtleSBzZXQgdG8gdmFsdWVcbiAqXG4gKiBAZXhhbXBsZVxuICogYXNzb2Moe2E6IDF9LCAnYicsIDIpICAgICAgICAgICAgICAgICAgICAvLyA9PiB7YTogMSwgYjogMn1cbiAqIGFzc29jKHthOiAxfSwgJ2EnLCAxMCkgICAgICAgICAgICAgICAgICAgLy8gPT4ge2E6IDEwfVxuICogYXNzb2MobmV3IE1hcChbWyd4JywgMV1dKSwgJ3knLCAyKSAgICAgICAvLyA9PiBNYXB7eDogMSwgeTogMn1cbiAqXG4gKiBAZXhhbXBsZVxuICogLy8gSW1tdXRhYmlsaXR5IGd1YXJhbnRlZWRcbiAqIGNvbnN0IG9yaWcgPSB7YTogMX07XG4gKiBjb25zdCByZXN1bHQgPSBhc3NvYyhvcmlnLCAnYicsIDIpO1xuICogLy8gb3JpZyBzdGlsbCB7YTogMX0sIHJlc3VsdCBpcyB7YTogMSwgYjogMn1cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGFzc29jKG1hcCwga2V5LCB2YWx1ZSkge1xuICBpZiAobWFwID09IG51bGwpIHtcbiAgICAvLyBJZiBrZXkgaXMgbnVtZXJpYywgY3JlYXRlIGFycmF5OyBvdGhlcndpc2Ugb2JqZWN0XG4gICAgaWYgKHR5cGVvZiBrZXkgPT09ICdudW1iZXInKSB7XG4gICAgICBjb25zdCBhcnIgPSBbXTtcbiAgICAgIGFycltrZXldID0gdmFsdWU7XG4gICAgICByZXR1cm4gYXJyO1xuICAgIH1cbiAgICByZXR1cm4ge1trZXldOiB2YWx1ZX07XG4gIH1cblxuICBpZiAobWFwIGluc3RhbmNlb2YgTWFwKSB7XG4gICAgY29uc3QgcmVzdWx0ID0gbmV3IE1hcChtYXApO1xuICAgIHJlc3VsdC5zZXQoa2V5LCB2YWx1ZSk7XG4gICAgcmV0dXJuIHJlc3VsdDtcbiAgfVxuXG4gIC8vIEhhbmRsZSBhcnJheXNcbiAgaWYgKEFycmF5LmlzQXJyYXkobWFwKSkge1xuICAgIGNvbnN0IHJlc3VsdCA9IFsuLi5tYXBdO1xuICAgIHJlc3VsdFtrZXldID0gdmFsdWU7XG4gICAgcmV0dXJuIHJlc3VsdDtcbiAgfVxuXG4gIHJldHVybiB7Li4ubWFwLCBba2V5XTogdmFsdWV9O1xufVxuXG4vKipcbiAqIFJldHVybnMgbmV3IG1hcCB3aXRoIG5lc3RlZCBwYXRoIHNldCB0byB2YWx1ZS4gQ3JlYXRlcyBpbnRlcm1lZGlhdGUgb2JqZWN0cy5cbiAqIEluZmVycyBzdHJ1Y3R1cmU6IG51bWVyaWMga2V5IFx1MjE5MiBhcnJheSwgc3RyaW5nIGtleSBcdTIxOTIgb2JqZWN0LlxuICpcbiAqIEBwYXJhbSB7T2JqZWN0fE1hcHxudWxsfHVuZGVmaW5lZH0gbWFwIC0gTmVzdGVkIHN0cnVjdHVyZSB0byB1cGRhdGVcbiAqIEBwYXJhbSB7QXJyYXl9IHBhdGggLSBBcnJheSBvZiBrZXlzIHJlcHJlc2VudGluZyBwYXRoXG4gKiBAcGFyYW0geyp9IHZhbHVlIC0gVmFsdWUgdG8gc2V0IGF0IHBhdGhcbiAqIEByZXR1cm5zIHsqfSBOZXcgc3RydWN0dXJlIHdpdGggcGF0aCB1cGRhdGVkXG4gKlxuICogQGV4YW1wbGVcbiAqIGFzc29jSW4oe3VzZXI6IHthZ2U6IDMwfX0sIFsndXNlcicsICdhZ2UnXSwgMzEpXG4gKiAvLyA9PiB7dXNlcjoge2FnZTogMzF9fVxuICpcbiAqIEBleGFtcGxlXG4gKiAvLyBDcmVhdGVzIG1pc3NpbmcgcGF0aHNcbiAqIGFzc29jSW4oe30sIFsndXNlcicsICduYW1lJ10sICdBbGljZScpXG4gKiAvLyA9PiB7dXNlcjoge25hbWU6ICdBbGljZSd9fVxuICpcbiAqIEBleGFtcGxlXG4gKiAvLyBTbWFydCBpbmZlcmVuY2U6IG51bWVyaWMga2V5IGNyZWF0ZXMgYXJyYXlcbiAqIGFzc29jSW4oe30sIFsnaXRlbXMnLCAwXSwgJ2ZpcnN0JylcbiAqIC8vID0+IHtpdGVtczogWydmaXJzdCddfVxuICovXG5leHBvcnQgZnVuY3Rpb24gYXNzb2NJbihtYXAsIHBhdGgsIHZhbHVlKSB7XG4gIGlmIChwYXRoLmxlbmd0aCA9PT0gMCkgcmV0dXJuIHZhbHVlO1xuICBpZiAocGF0aC5sZW5ndGggPT09IDEpIHJldHVybiBhc3NvYyhtYXAsIHBhdGhbMF0sIHZhbHVlKTtcblxuICBjb25zdCBba2V5LCAuLi5yZXN0UGF0aF0gPSBwYXRoO1xuICBjb25zdCBleGlzdGluZyA9IGdldChtYXAgPT0gbnVsbCA/IHt9IDogbWFwLCBrZXkpO1xuXG4gIGxldCBuZXN0ZWQ7XG4gIGlmIChleGlzdGluZyAhPSBudWxsICYmICh0eXBlb2YgZXhpc3RpbmcgPT09ICdvYmplY3QnKSkge1xuICAgIC8vIFVzZSBleGlzdGluZyBvYmplY3QvYXJyYXkgaWYgaXQncyBhbHJlYWR5IGFuIG9iamVjdFxuICAgIG5lc3RlZCA9IGV4aXN0aW5nO1xuICB9IGVsc2Uge1xuICAgIC8vIENyZWF0ZSBuZXcgc3RydWN0dXJlIG9yIHJlcGxhY2UgcHJpbWl0aXZlIHZhbHVlc1xuICAgIGNvbnN0IG5leHRLZXkgPSByZXN0UGF0aFswXTtcbiAgICBuZXN0ZWQgPSAodHlwZW9mIG5leHRLZXkgPT09ICdudW1iZXInKSA/IFtdIDoge307XG4gIH1cblxuICByZXR1cm4gYXNzb2MobWFwID09IG51bGwgPyB7fSA6IG1hcCwga2V5LCBhc3NvY0luKG5lc3RlZCwgcmVzdFBhdGgsIHZhbHVlKSk7XG59XG5cbi8qKlxuICogUmV0dXJucyBuZXcgbWFwIHdpdGhvdXQgc3BlY2lmaWVkIGtleXMuIE9yaWdpbmFsIHVuY2hhbmdlZC5cbiAqIFdvcmtzIHdpdGggYm90aCBNYXAgYW5kIE9iamVjdC5cbiAqXG4gKiBAcGFyYW0ge09iamVjdHxNYXB8bnVsbHx1bmRlZmluZWR9IG1hcCAtIE1hcCBvciBvYmplY3QgdG8gdXBkYXRlXG4gKiBAcGFyYW0gey4uLip9IGtleXMgLSBLZXlzIHRvIHJlbW92ZVxuICogQHJldHVybnMgeyp9IE5ldyBtYXAgd2l0aG91dCBrZXlzXG4gKlxuICogQGV4YW1wbGVcbiAqIGRpc3NvYyh7YTogMSwgYjogMiwgYzogM30sICdiJykgICAgICAgICAgLy8gPT4ge2E6IDEsIGM6IDN9XG4gKiBkaXNzb2Moe2E6IDEsIGI6IDIsIGM6IDN9LCAnYScsICdjJykgICAgIC8vID0+IHtiOiAyfVxuICpcbiAqIEBleGFtcGxlXG4gKiBjb25zdCBtID0gbmV3IE1hcChbWyd4JywgMV0sIFsneScsIDJdXSk7XG4gKiBkaXNzb2MobSwgJ3gnKSAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vID0+IE1hcHt5OiAyfVxuICovXG5leHBvcnQgZnVuY3Rpb24gZGlzc29jKG1hcCwgLi4ua2V5cykge1xuICBpZiAobWFwID09IG51bGwpIHJldHVybiB7fTtcblxuICBpZiAobWFwIGluc3RhbmNlb2YgTWFwKSB7XG4gICAgY29uc3QgcmVzdWx0ID0gbmV3IE1hcChtYXApO1xuICAgIGZvciAoY29uc3Qga2V5IG9mIGtleXMpIHtcbiAgICAgIHJlc3VsdC5kZWxldGUoa2V5KTtcbiAgICB9XG4gICAgcmV0dXJuIHJlc3VsdDtcbiAgfVxuXG4gIC8vIEhhbmRsZSBhcnJheXNcbiAgaWYgKEFycmF5LmlzQXJyYXkobWFwKSkge1xuICAgIGNvbnN0IHJlc3VsdCA9IFsuLi5tYXBdO1xuICAgIGZvciAoY29uc3Qga2V5IG9mIGtleXMpIHtcbiAgICAgIGRlbGV0ZSByZXN1bHRba2V5XTtcbiAgICB9XG4gICAgcmV0dXJuIHJlc3VsdDtcbiAgfVxuXG4gIGNvbnN0IHJlc3VsdCA9IHsuLi5tYXB9O1xuICBmb3IgKGNvbnN0IGtleSBvZiBrZXlzKSB7XG4gICAgZGVsZXRlIHJlc3VsdFtrZXldO1xuICB9XG4gIHJldHVybiByZXN1bHQ7XG59XG5cbi8qKlxuICogUmV0dXJucyBuZXcgbWFwIHdpdGggdmFsdWUgYXQga2V5IHRyYW5zZm9ybWVkIGJ5IGZ1bmN0aW9uLlxuICogRXF1aXZhbGVudCB0bzogYXNzb2MobWFwLCBrZXksIGZuKGdldChtYXAsIGtleSkpKVxuICpcbiAqIEBwYXJhbSB7T2JqZWN0fE1hcHxudWxsfHVuZGVmaW5lZH0gbWFwIC0gTWFwIG9yIG9iamVjdCB0byB1cGRhdGVcbiAqIEBwYXJhbSB7Kn0ga2V5IC0gS2V5IHRvIHVwZGF0ZVxuICogQHBhcmFtIHtGdW5jdGlvbn0gZm4gLSBGdW5jdGlvbiB0byB0cmFuc2Zvcm0gdmFsdWVcbiAqIEByZXR1cm5zIHsqfSBOZXcgbWFwIHdpdGggdHJhbnNmb3JtZWQgdmFsdWVcbiAqXG4gKiBAZXhhbXBsZVxuICogdXBkYXRlKHtjb3VudDogNX0sICdjb3VudCcsIHggPT4geCArIDEpXG4gKiAvLyA9PiB7Y291bnQ6IDZ9XG4gKlxuICogQGV4YW1wbGVcbiAqIHVwZGF0ZSh7bmFtZTogJ2FsaWNlJ30sICduYW1lJywgcyA9PiBzLnRvVXBwZXJDYXNlKCkpXG4gKiAvLyA9PiB7bmFtZTogJ0FMSUNFJ31cbiAqXG4gKiBAZXhhbXBsZVxuICogLy8gRnVuY3Rpb24gcmVjZWl2ZXMgdW5kZWZpbmVkIGZvciBtaXNzaW5nIGtleVxuICogdXBkYXRlKHthOiAxfSwgJ2InLCB4ID0+ICh4IHx8IDApICsgMTApXG4gKiAvLyA9PiB7YTogMSwgYjogMTB9XG4gKi9cbmV4cG9ydCBmdW5jdGlvbiB1cGRhdGUobWFwLCBrZXksIGZuKSB7XG4gIHZhbGlkYXRlRnVuY3Rpb24oZm4sICd1cGRhdGUnLCAndHJhbnNmb3JtIGZ1bmN0aW9uJyk7XG4gIGNvbnN0IGN1cnJlbnRWYWx1ZSA9IGdldChtYXAsIGtleSk7XG4gIHJldHVybiBhc3NvYyhtYXAsIGtleSwgZm4oY3VycmVudFZhbHVlKSk7XG59XG5cbi8qKlxuICogUmV0dXJucyBuZXcgbWFwIHdpdGggdmFsdWUgYXQgbmVzdGVkIHBhdGggdHJhbnNmb3JtZWQgYnkgZnVuY3Rpb24uXG4gKiBFcXVpdmFsZW50IHRvOiBhc3NvY0luKG1hcCwgcGF0aCwgZm4oZ2V0SW4obWFwLCBwYXRoKSkpXG4gKlxuICogQHBhcmFtIHtPYmplY3R8TWFwfG51bGx8dW5kZWZpbmVkfSBtYXAgLSBOZXN0ZWQgc3RydWN0dXJlIHRvIHVwZGF0ZVxuICogQHBhcmFtIHtBcnJheX0gcGF0aCAtIEFycmF5IG9mIGtleXMgcmVwcmVzZW50aW5nIHBhdGhcbiAqIEBwYXJhbSB7RnVuY3Rpb259IGZuIC0gRnVuY3Rpb24gdG8gdHJhbnNmb3JtIHZhbHVlXG4gKiBAcmV0dXJucyB7Kn0gTmV3IHN0cnVjdHVyZSB3aXRoIHRyYW5zZm9ybWVkIHZhbHVlXG4gKlxuICogQGV4YW1wbGVcbiAqIHVwZGF0ZUluKHt1c2VyOiB7YWdlOiAzMH19LCBbJ3VzZXInLCAnYWdlJ10sIHggPT4geCArIDEpXG4gKiAvLyA9PiB7dXNlcjoge2FnZTogMzF9fVxuICpcbiAqIEBleGFtcGxlXG4gKiBjb25zdCBkYXRhID0ge2l0ZW1zOiBbMTAsIDIwLCAzMF19O1xuICogdXBkYXRlSW4oZGF0YSwgWydpdGVtcycsIDFdLCB4ID0+IHggKiAyKVxuICogLy8gPT4ge2l0ZW1zOiBbMTAsIDQwLCAzMF19XG4gKi9cbmV4cG9ydCBmdW5jdGlvbiB1cGRhdGVJbihtYXAsIHBhdGgsIGZuKSB7XG4gIHZhbGlkYXRlRnVuY3Rpb24oZm4sICd1cGRhdGVJbicsICd0cmFuc2Zvcm0gZnVuY3Rpb24nKTtcbiAgaWYgKHBhdGgubGVuZ3RoID09PSAwKSByZXR1cm4gZm4obWFwKTtcblxuICBjb25zdCBjdXJyZW50VmFsdWUgPSBnZXRJbihtYXAsIHBhdGgpO1xuICByZXR1cm4gYXNzb2NJbihtYXAsIHBhdGgsIGZuKGN1cnJlbnRWYWx1ZSkpO1xufVxuXG4vKipcbiAqIFJldHVybnMgbmV3IG1hcCB3aXRoIGFsbCBrZXlzL3ZhbHVlcyBmcm9tIGFsbCBtYXBzLiBMYXRlciB2YWx1ZXMgd2luLlxuICogU2hhbGxvdyBtZXJnZS4gV29ya3Mgd2l0aCBib3RoIE1hcCBhbmQgT2JqZWN0LlxuICpcbiAqIEBwYXJhbSB7Li4uT2JqZWN0fE1hcHxudWxsfHVuZGVmaW5lZH0gbWFwcyAtIE1hcHMgdG8gbWVyZ2UgKGxlZnQgdG8gcmlnaHQpXG4gKiBAcmV0dXJucyB7Kn0gTmV3IG1lcmdlZCBtYXBcbiAqXG4gKiBAZXhhbXBsZVxuICogbWVyZ2Uoe2E6IDF9LCB7YjogMn0sIHtjOiAzfSlcbiAqIC8vID0+IHthOiAxLCBiOiAyLCBjOiAzfVxuICpcbiAqIEBleGFtcGxlXG4gKiAvLyBMYXRlciB2YWx1ZXMgd2luXG4gKiBtZXJnZSh7YTogMSwgYjogMn0sIHtiOiAzLCBjOiA0fSlcbiAqIC8vID0+IHthOiAxLCBiOiAzLCBjOiA0fVxuICpcbiAqIEBleGFtcGxlXG4gKiAvLyBOaWwgbWFwcyBpZ25vcmVkXG4gKiBtZXJnZSh7YTogMX0sIG51bGwsIHtiOiAyfSlcbiAqIC8vID0+IHthOiAxLCBiOiAyfVxuICovXG5leHBvcnQgZnVuY3Rpb24gbWVyZ2UoLi4ubWFwcykge1xuICBjb25zdCBub25OaWxNYXBzID0gbWFwcy5maWx0ZXIobSA9PiBtICE9IG51bGwpO1xuICBpZiAobm9uTmlsTWFwcy5sZW5ndGggPT09IDApIHJldHVybiB7fTtcblxuICBjb25zdCBmaXJzdE1hcCA9IG5vbk5pbE1hcHNbMF07XG4gIGlmIChmaXJzdE1hcCBpbnN0YW5jZW9mIE1hcCkge1xuICAgIGNvbnN0IHJlc3VsdCA9IG5ldyBNYXAoKTtcbiAgICBmb3IgKGNvbnN0IG0gb2Ygbm9uTmlsTWFwcykge1xuICAgICAgaWYgKG0gaW5zdGFuY2VvZiBNYXApIHtcbiAgICAgICAgZm9yIChjb25zdCBbaywgdl0gb2YgbSkge1xuICAgICAgICAgIHJlc3VsdC5zZXQoaywgdik7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIHJlc3VsdDtcbiAgfVxuXG4gIHJldHVybiBPYmplY3QuYXNzaWduKHt9LCAuLi5ub25OaWxNYXBzKTtcbn1cblxuLyoqXG4gKiBDb252ZXJ0cyBhbnkgaXRlcmFibGUgdG8gQXJyYXkuIEFMV0FZUyByZXR1cm5zIG5ldyBhcnJheSAoZXZlbiBpZiBpbnB1dCBpcyBhcnJheSkuXG4gKiBJbW11dGFiaWxpdHkgZ3VhcmFudGVlOiB2ZWMoYXJyKSAhPT0gYXJyXG4gKlxuICogQHBhcmFtIHtJdGVyYWJsZXxudWxsfHVuZGVmaW5lZH0gY29sbCAtIENvbGxlY3Rpb24gdG8gY29udmVydFxuICogQHJldHVybnMge0FycmF5fSBOZXcgYXJyYXkgd2l0aCBhbGwgZWxlbWVudHNcbiAqXG4gKiBAZXhhbXBsZVxuICogdmVjKFsxLCAyLCAzXSkgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyA9PiBbMSwgMiwgM10gKE5FVyBhcnJheSlcbiAqIHZlYyhuZXcgU2V0KFsxLCAyLCAzXSkpICAgICAgICAgICAgICAgICAgLy8gPT4gWzEsIDIsIDNdXG4gKiB2ZWMoXCJoZWxsb1wiKSAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gPT4gWydoJywgJ2UnLCAnbCcsICdsJywgJ28nXVxuICpcbiAqIEBleGFtcGxlXG4gKiAvLyBJbW11dGFiaWxpdHkgc2FmZXR5XG4gKiBjb25zdCBvcmlnID0gWzEsIDIsIDNdO1xuICogY29uc3QgY29weSA9IHZlYyhvcmlnKTtcbiAqIGNvcHkgIT09IG9yaWcgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gPT4gdHJ1ZVxuICovXG5leHBvcnQgZnVuY3Rpb24gdmVjKGNvbGwpIHtcbiAgaWYgKGNvbGwgPT0gbnVsbCkgcmV0dXJuIFtdO1xuICByZXR1cm4gQXJyYXkuZnJvbShjb2xsKTsgIC8vIFdvcmtzIGZvciBhcnJheXMgdG9vLCBjcmVhdGVzIG5ldyBjb3B5XG59XG5cbi8qKlxuICogQ29udmVydHMgYW55IGl0ZXJhYmxlIHRvIFNldC4gQUxXQVlTIHJldHVybnMgbmV3IFNldCAoZXZlbiBpZiBpbnB1dCBpcyBTZXQpLlxuICogUmVtb3ZlcyBkdXBsaWNhdGVzLiBJbW11dGFiaWxpdHkgZ3VhcmFudGVlOiBzZXQocykgIT09IHNcbiAqXG4gKiBAcGFyYW0ge0l0ZXJhYmxlfG51bGx8dW5kZWZpbmVkfSBjb2xsIC0gQ29sbGVjdGlvbiB0byBjb252ZXJ0XG4gKiBAcmV0dXJucyB7U2V0fSBOZXcgU2V0IHdpdGggYWxsIHVuaXF1ZSBlbGVtZW50c1xuICpcbiAqIEBleGFtcGxlXG4gKiBzZXQoWzEsIDIsIDIsIDNdKSAgICAgICAgICAgICAgICAgICAgICAgIC8vID0+IFNldHsxLCAyLCAzfVxuICogc2V0KG5ldyBTZXQoWzEsIDIsIDNdKSkgICAgICAgICAgICAgICAgICAvLyA9PiBTZXR7MSwgMiwgM30gKE5FVyBTZXQpXG4gKiBzZXQoXCJoZWxsb1wiKSAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gPT4gU2V0eydoJywgJ2UnLCAnbCcsICdvJ31cbiAqXG4gKiBAZXhhbXBsZVxuICogLy8gSW1tdXRhYmlsaXR5IHNhZmV0eVxuICogY29uc3Qgb3JpZyA9IG5ldyBTZXQoWzEsIDIsIDNdKTtcbiAqIGNvbnN0IGNvcHkgPSBzZXQob3JpZyk7XG4gKiBjb3B5ICE9PSBvcmlnICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vID0+IHRydWVcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHNldChjb2xsKSB7XG4gIGlmIChjb2xsID09IG51bGwpIHJldHVybiBuZXcgU2V0KCk7XG4gIHJldHVybiBuZXcgU2V0KGNvbGwpOyAgLy8gV29ya3MgZm9yIFNldHMgdG9vLCBjcmVhdGVzIG5ldyBjb3B5XG59XG5cbi8vIEV4cG9ydCBsYXp5U2VxIGZvciBjcmVhdGluZyBjdXN0b20gbGF6eSBzZXF1ZW5jZXNcbmV4cG9ydCB7IGxhenlTZXEgfTtcbiIsICIvLyBpbmRleC5qcyAtIFB1YmxpYyBBUEkgZXhwb3J0cyBmb3IgSFFMIHN0ZGxpYlxuLy8gQXV0by1pbmplY3RlZCBpbnRvIEhRTCBydW50aW1lXG5cbi8vIEltcG9ydCBhbGwgY29yZSBmdW5jdGlvbnNcbmltcG9ydCB7XG4gIC8vIFNlcXVlbmNlIHByaW1pdGl2ZXMgKExpc3AgdHJpbml0eSlcbiAgZmlyc3QsXG4gIHJlc3QsXG4gIGNvbnMsXG5cbiAgLy8gSW5kZXhlZCBhY2Nlc3MgJiBjb3VudGluZyAoV2VlayAxKVxuICBudGgsXG4gIGNvdW50LFxuICBzZWNvbmQsXG4gIGxhc3QsXG5cbiAgLy8gU2VxdWVuY2UgcHJlZGljYXRlc1xuICBpc0VtcHR5LFxuICBzb21lLFxuXG4gIC8vIFNlcXVlbmNlIG9wZXJhdGlvbnNcbiAgdGFrZSxcbiAgZHJvcCxcbiAgbWFwLFxuICBmaWx0ZXIsXG4gIHJlZHVjZSxcbiAgY29uY2F0LFxuICBmbGF0dGVuLFxuICBkaXN0aW5jdCxcblxuICAvLyBNYXAgb3BlcmF0aW9ucyAoV2VlayAyKVxuICBtYXBJbmRleGVkLFxuICBrZWVwSW5kZXhlZCxcbiAgbWFwY2F0LFxuICBrZWVwLFxuXG4gIC8vIENvbGxlY3Rpb24gcHJvdG9jb2xzIChXZWVrIDMpXG4gIHNlcSxcbiAgZW1wdHksXG4gIGNvbmosXG4gIGludG8sXG5cbiAgLy8gTGF6eSBjb25zdHJ1Y3RvcnMgKFdlZWsgNClcbiAgcmVwZWF0LFxuICByZXBlYXRlZGx5LFxuICBjeWNsZSxcblxuICAvLyBTZXF1ZW5jZSBwcmVkaWNhdGVzIChXZWVrIDUpXG4gIGV2ZXJ5LFxuICBub3RBbnksXG4gIG5vdEV2ZXJ5LFxuICBpc1NvbWUsXG5cbiAgLy8gTWFwL09iamVjdCBvcGVyYXRpb25zIChXZWVrIDYpXG4gIGdldCxcbiAgZ2V0SW4sXG4gIGFzc29jLFxuICBhc3NvY0luLFxuICBkaXNzb2MsXG4gIHVwZGF0ZSxcbiAgdXBkYXRlSW4sXG4gIG1lcmdlLFxuXG4gIC8vIFR5cGUgY29udmVyc2lvbnMgKFdlZWsgNilcbiAgdmVjLFxuICBzZXQsXG5cbiAgLy8gU2VxdWVuY2UgZ2VuZXJhdG9yc1xuICByYW5nZSxcbiAgaXRlcmF0ZSxcblxuICAvLyBGdW5jdGlvbiBvcGVyYXRpb25zXG4gIGNvbXAsXG4gIHBhcnRpYWwsXG4gIGFwcGx5LFxuXG4gIC8vIFV0aWxpdGllc1xuICBncm91cEJ5LFxuICBrZXlzLFxuICBkb2FsbCxcbiAgcmVhbGl6ZWQsXG4gIGxhenlTZXEsXG59IGZyb20gJy4vY29yZS5qcyc7XG5cbi8vIEV4cG9ydCBMYXp5U2VxIGNsYXNzIGZvciBhZHZhbmNlZCB1c2VycyAoaW5zdGFuY2VvZiBjaGVja3MpXG5leHBvcnQgeyBMYXp5U2VxIH0gZnJvbSAnLi9pbnRlcm5hbC9sYXp5LXNlcS5qcyc7XG5cbi8vIFx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVxuLy8gUFVCTElDIEFQSSAtIEF1dG8taW5qZWN0ZWQgaW50byBIUUwgcnVudGltZVxuLy8gXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXHUyNTAxXG4vL1xuLy8gQWxsIGZ1bmN0aW9ucyBpbiB0aGlzIG9iamVjdCBhcmUgYXV0b21hdGljYWxseSBhdmFpbGFibGUgaW4gSFFMIHdpdGhvdXQgaW1wb3J0cy5cbi8vIFRvIGFkZCBhIG5ldyBzdGRsaWIgZnVuY3Rpb246XG4vLyAxLiBEZWZpbmUgYW5kIGV4cG9ydCBpdCBpbiBjb3JlLmpzIChvciBjcmVhdGUgYSBuZXcgbW9kdWxlKVxuLy8gMi4gSW1wb3J0IGl0IGFib3ZlXG4vLyAzLiBBZGQgaXQgdG8gdGhpcyBTVERMSUJfUFVCTElDX0FQSSBvYmplY3Rcbi8vIDQuIFRoYXQncyBpdCEgQXV0by1pbmplY3RlZCBldmVyeXdoZXJlIFx1MjcyOFxuLy9cbi8vIFx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVx1MjUwMVxuXG5leHBvcnQgY29uc3QgU1RETElCX1BVQkxJQ19BUEkgPSB7XG4gIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgLy8gU0VRVUVOQ0UgUFJJTUlUSVZFUyAoTGlzcCBUcmluaXR5KVxuICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gIGZpcnN0LFxuICByZXN0LFxuICBjb25zLFxuXG4gIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgLy8gSU5ERVhFRCBBQ0NFU1MgJiBDT1VOVElORyAoV2VlayAxKVxuICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gIG50aCxcbiAgY291bnQsXG4gIHNlY29uZCxcbiAgbGFzdCxcblxuICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gIC8vIFNFUVVFTkNFIFBSRURJQ0FURVNcbiAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICBpc0VtcHR5LFxuICBzb21lLFxuXG4gIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgLy8gU0VRVUVOQ0UgT1BFUkFUSU9OU1xuICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gIHRha2UsXG4gIGRyb3AsXG4gIG1hcCxcbiAgZmlsdGVyLFxuICByZWR1Y2UsXG4gIGNvbmNhdCxcbiAgZmxhdHRlbixcbiAgZGlzdGluY3QsXG5cbiAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAvLyBNQVAgT1BFUkFUSU9OUyAoV2VlayAyKVxuICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gIG1hcEluZGV4ZWQsXG4gIGtlZXBJbmRleGVkLFxuICBtYXBjYXQsXG4gIGtlZXAsXG5cbiAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAvLyBDT0xMRUNUSU9OIFBST1RPQ09MUyAoV2VlayAzKVxuICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gIHNlcSxcbiAgZW1wdHksXG4gIGNvbmosXG4gIGludG8sXG5cbiAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAvLyBMQVpZIENPTlNUUlVDVE9SUyAoV2VlayA0KVxuICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gIHJlcGVhdCxcbiAgcmVwZWF0ZWRseSxcbiAgY3ljbGUsXG5cbiAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAvLyBTRVFVRU5DRSBQUkVESUNBVEVTIChXZWVrIDUpXG4gIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgZXZlcnksXG4gIG5vdEFueSxcbiAgbm90RXZlcnksXG4gIGlzU29tZSxcblxuICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gIC8vIE1BUC9PQkpFQ1QgT1BFUkFUSU9OUyAoV2VlayA2KVxuICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gIGdldCxcbiAgZ2V0SW4sXG4gIGFzc29jLFxuICBhc3NvY0luLFxuICBkaXNzb2MsXG4gIHVwZGF0ZSxcbiAgdXBkYXRlSW4sXG4gIG1lcmdlLFxuXG4gIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgLy8gVFlQRSBDT05WRVJTSU9OUyAoV2VlayA2KVxuICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gIHZlYyxcbiAgc2V0LFxuXG4gIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgLy8gU0VRVUVOQ0UgR0VORVJBVE9SU1xuICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gIHJhbmdlLFxuICByYW5nZUdlbmVyYXRvcjogcmFuZ2UsICAvLyBBbGlhcyBmb3IgYmFja3dhcmRzIGNvbXBhdGliaWxpdHlcbiAgaXRlcmF0ZSxcblxuICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gIC8vIEZVTkNUSU9OIE9QRVJBVElPTlNcbiAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICBjb21wLFxuICBwYXJ0aWFsLFxuICBhcHBseSxcblxuICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gIC8vIFVUSUxJVElFU1xuICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gIGdyb3VwQnksXG4gIGtleXMsXG4gIGRvYWxsLFxuICByZWFsaXplZCxcbiAgbGF6eVNlcSxcbn07XG5cbi8vIEFsc28gZXhwb3J0IGluZGl2aWR1YWwgZnVuY3Rpb25zIGZvciBkaXJlY3QgaW1wb3J0XG5leHBvcnQge1xuICAvLyBTZXF1ZW5jZSBwcmltaXRpdmVzXG4gIGZpcnN0LFxuICByZXN0LFxuICBjb25zLFxuXG4gIC8vIEluZGV4ZWQgYWNjZXNzICYgY291bnRpbmcgKFdlZWsgMSlcbiAgbnRoLFxuICBjb3VudCxcbiAgc2Vjb25kLFxuICBsYXN0LFxuXG4gIC8vIFNlcXVlbmNlIHByZWRpY2F0ZXNcbiAgaXNFbXB0eSxcbiAgc29tZSxcblxuICAvLyBTZXF1ZW5jZSBvcGVyYXRpb25zXG4gIHRha2UsXG4gIGRyb3AsXG4gIG1hcCxcbiAgZmlsdGVyLFxuICByZWR1Y2UsXG4gIGNvbmNhdCxcbiAgZmxhdHRlbixcbiAgZGlzdGluY3QsXG5cbiAgLy8gTWFwIG9wZXJhdGlvbnMgKFdlZWsgMilcbiAgbWFwSW5kZXhlZCxcbiAga2VlcEluZGV4ZWQsXG4gIG1hcGNhdCxcbiAga2VlcCxcblxuICAvLyBDb2xsZWN0aW9uIHByb3RvY29scyAoV2VlayAzKVxuICBzZXEsXG4gIGVtcHR5LFxuICBjb25qLFxuICBpbnRvLFxuXG4gIC8vIExhenkgY29uc3RydWN0b3JzIChXZWVrIDQpXG4gIHJlcGVhdCxcbiAgcmVwZWF0ZWRseSxcbiAgY3ljbGUsXG5cbiAgLy8gU2VxdWVuY2UgcHJlZGljYXRlcyAoV2VlayA1KVxuICBldmVyeSxcbiAgbm90QW55LFxuICBub3RFdmVyeSxcbiAgaXNTb21lLFxuXG4gIC8vIE1hcC9PYmplY3Qgb3BlcmF0aW9ucyAoV2VlayA2KVxuICBnZXQsXG4gIGdldEluLFxuICBhc3NvYyxcbiAgYXNzb2NJbixcbiAgZGlzc29jLFxuICB1cGRhdGUsXG4gIHVwZGF0ZUluLFxuICBtZXJnZSxcblxuICAvLyBUeXBlIGNvbnZlcnNpb25zIChXZWVrIDYpXG4gIHZlYyxcbiAgc2V0LFxuXG4gIC8vIFNlcXVlbmNlIGdlbmVyYXRvcnNcbiAgcmFuZ2UsXG4gIGl0ZXJhdGUsXG5cbiAgLy8gRnVuY3Rpb24gb3BlcmF0aW9uc1xuICBjb21wLFxuICBwYXJ0aWFsLFxuICBhcHBseSxcblxuICAvLyBVdGlsaXRpZXNcbiAgZ3JvdXBCeSxcbiAga2V5cyxcbiAgZG9hbGwsXG4gIHJlYWxpemVkLFxuICBsYXp5U2VxLFxufTtcblxuLy8gQmFja3dhcmRzIGNvbXBhdGliaWxpdHkgYWxpYXNcbmV4cG9ydCBjb25zdCByYW5nZUdlbmVyYXRvciA9IHJhbmdlO1xuIiwgIlwidXNlIHN0cmljdFwiO1xuaW1wb3J0IHsgY291bnQsIGxhc3QsIGlzRW1wdHksIHNvbWUsIHRha2UsIG1hcCwgZmlsdGVyLCByZWR1Y2UsIGRyb3AsIGNvbmNhdCwgZmxhdHRlbiwgZGlzdGluY3QsIG1hcEluZGV4ZWQsIGtlZXBJbmRleGVkLCBtYXBjYXQsIGtlZXAsIGVtcHR5LCBjb25qLCBpbnRvLCByZXBlYXRlZGx5LCBjeWNsZSwgZXZlcnksIG5vdEFueSwgbm90RXZlcnksIGlzU29tZSwgZ2V0LCBnZXRJbiwgYXNzb2MsIGFzc29jSW4sIGRpc3NvYywgdXBkYXRlLCB1cGRhdGVJbiwgbWVyZ2UsIHZlYywgcmFuZ2VHZW5lcmF0b3IsIGl0ZXJhdGUsIGNvbXAsIHBhcnRpYWwsIGFwcGx5LCBncm91cEJ5LCBrZXlzLCBkb2FsbCwgcmVhbGl6ZWQsIGxhenlTZXEgfSBmcm9tIFwiL1VzZXJzL3Nlb2tzb29uamFuZy9EZXNrdG9wL2hsdm0vc3JjL2hxbC8uaHFsLWNhY2hlLzEvY29yZS9saWIvc3RkbGliL2pzL3N0ZGxpYi5qc1wiO1xuY29uc3QgcmFuZ2UgPSB0eXBlb2YgX19ocWxfY2FsbEZuID09PSBcImZ1bmN0aW9uXCIgPyBfX2hxbF9jYWxsRm4uY2FsbCh0aGlzLCBfX2hxbF9kZWVwRnJlZXplLCB1bmRlZmluZWQsIHJhbmdlR2VuZXJhdG9yKSA6IF9faHFsX2RlZXBGcmVlemUocmFuZ2VHZW5lcmF0b3IpO1xuZXhwb3J0IHsgY291bnQsIGxhc3QsIGlzRW1wdHksIHNvbWUsIHRha2UsIG1hcCwgZmlsdGVyLCByZWR1Y2UsIGRyb3AsIGNvbmNhdCwgZmxhdHRlbiwgZGlzdGluY3QsIG1hcEluZGV4ZWQsIGtlZXBJbmRleGVkLCBtYXBjYXQsIGtlZXAsIGVtcHR5LCBjb25qLCBpbnRvLCByZXBlYXRlZGx5LCBjeWNsZSwgZXZlcnksIG5vdEFueSwgbm90RXZlcnksIGlzU29tZSwgZ2V0LCBnZXRJbiwgYXNzb2MsIGFzc29jSW4sIGRpc3NvYywgdXBkYXRlLCB1cGRhdGVJbiwgbWVyZ2UsIHZlYywgcmFuZ2UsIHJhbmdlR2VuZXJhdG9yLCBpdGVyYXRlLCBjb21wLCBwYXJ0aWFsLCBhcHBseSwgZ3JvdXBCeSwga2V5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QUNBLFdBQU9BO0FBQUEsRUFDVDtBQUdBLE1BQUksTUFBTSxRQUFRRixJQUFHLEdBQUc7QUFDdEIsVUFBTUUsVUFBUyxDQUFDLEdBQUdGLElBQUc7QUFDdEIsZUFBVyxPQUFPQyxPQUFNO0FBQ3RCLGFBQU9DLFFBQU8sR0FBRztBQUFBLElBQ25CO0FBQ0EsV0FBT0E7QUFBQSxFQUNUO0FBRUEsUUFBTSxTQUFTLEVBQUMsR0FBR0YsS0FBRztBQUN0QixhQUFXLE9BQU9DLE9BQU07QUFDdEIsV0FBTyxPQUFPLEdBQUc7QUFBQSxFQUNuQjtBQUNBLFNBQU87QUFDVDtBQXdCTyxTQUFTLE9BQU9ELE1BQUssS0FBSyxJQUFJO0FBQ25DLG1CQUFpQixJQUFJLFVBQVUsb0JBQW9CO0FBQ25ELFFBQU0sZUFBZSxJQUFJQSxNQUFLLEdBQUc7QUFDakMsU0FBTyxNQUFNQSxNQUFLLEtBQUssR0FBRyxZQUFZLENBQUM7QUFDekM7QUFvQk8sU0FBUyxTQUFTQSxNQUFLLE1BQU0sSUFBSTtBQUN0QyxtQkFBaUIsSUFBSSxZQUFZLG9CQUFvQjtBQUNyRCxNQUFJLEtBQUssV0FBVztBQUFHLFdBQU8sR0FBR0EsSUFBRztBQUVwQyxRQUFNLGVBQWUsTUFBTUEsTUFBSyxJQUFJO0FBQ3BDLFNBQU8sUUFBUUEsTUFBSyxNQUFNLEdBQUcsWUFBWSxDQUFDO0FBQzVDO0FBdUJPLFNBQVMsU0FBUyxNQUFNO0FBQzdCLFFBQU0sYUFBYSxLQUFLLE9BQU8sT0FBSyxLQUFLLElBQUk7QUFDN0MsTUFBSSxXQUFXLFdBQVc7QUFBRyxXQUFPLENBQUM7QUFFckMsUUFBTSxXQUFXLFdBQVcsQ0FBQztBQUM3QixNQUFJLG9CQUFvQixLQUFLO0FBQzNCLFVBQU0sU0FBUyxvQkFBSSxJQUFJO0FBQ3ZCLGVBQVcsS0FBSyxZQUFZO0FBQzFCLFVBQUksYUFBYSxLQUFLO0FBQ3BCLG1CQUFXLENBQUMsR0FBRyxDQUFDLEtBQUssR0FBRztBQUN0QixpQkFBTyxJQUFJLEdBQUcsQ0FBQztBQUFBLFFBQ2pCO0FBQUEsTUFDRjtBQUFBLElBQ0Y7QUFDQSxXQUFPO0FBQUEsRUFDVDtBQUVBLFNBQU8sT0FBTyxPQUFPLENBQUMsR0FBRyxHQUFHLFVBQVU7QUFDeEM7QUFvQk8sU0FBUyxJQUFJLE1BQU07QUFDeEIsTUFBSSxRQUFRO0FBQU0sV0FBTyxDQUFDO0FBQzFCLFNBQU8sTUFBTSxLQUFLLElBQUk7QUFDeEI7OztBQ3JtRE8sSUFBTSxpQkFBaUI7OztBQy9SOUIsSUFBTUcsU0FBUSxPQUFPLGlCQUFpQixhQUFhLGFBQWEsS0FBSyxRQUFNLGtCQUFrQixRQUFXLGNBQWMsSUFBSSxpQkFBaUIsY0FBYzsiLAogICJuYW1lcyI6IFsiY291bnQiLCAiZW1wdHkiLCAiY291bnQiLCAiYWNjIiwgIm1hcCIsICJrZXlzIiwgInJlc3VsdCIsICJyYW5nZSJdCn0K
