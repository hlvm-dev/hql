// Tests for getters and setters
import { assertStringIncludes } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { transpile } from "../../src/transpiler/index.ts";

Deno.test("Getter: basic getter", async () => {
  const result = await transpile(`
    (class Circle
      (var _radius 0)
      (getter radius []
        this._radius))
  `);
  assertStringIncludes(result.code, "get radius()");
});

Deno.test("Setter: basic setter", async () => {
  const result = await transpile(`
    (class Circle
      (var _radius 0)
      (setter radius [value]
        (= this._radius value)))
  `);
  assertStringIncludes(result.code, "set radius(value)");
});

Deno.test("Getter and Setter: matching pair", async () => {
  const result = await transpile(`
    (class Rectangle
      (var _width 0)
      (var _height 0)
      (getter width []
        this._width)
      (setter width [value]
        (= this._width value))
      (getter height []
        this._height)
      (setter height [value]
        (= this._height value)))
  `);
  assertStringIncludes(result.code, "get width()");
  assertStringIncludes(result.code, "set width(value)");
  assertStringIncludes(result.code, "get height()");
  assertStringIncludes(result.code, "set height(value)");
});

Deno.test("Getter: computed property", async () => {
  const result = await transpile(`
    (class Circle
      (var _radius 5)
      (getter area []
        (* Math.PI this._radius this._radius)))
  `);
  assertStringIncludes(result.code, "get area()");
});

Deno.test("Setter: with validation", async () => {
  const result = await transpile(`
    (class Circle
      (var _radius 0)
      (setter radius [value]
        (when (> value 0)
          (= this._radius value))))
  `);
  assertStringIncludes(result.code, "set radius(value)");
});
