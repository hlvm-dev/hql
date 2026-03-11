import { assertEquals } from "jsr:@std/assert";
import { run } from "../../../helpers.ts";

async function runLoose(code: string): Promise<unknown> {
  return await run(code, { typeCheck: false });
}

Deno.test("class: constructors initialize instances and properties", async () => {
  const result = await runLoose(`
    (class Person
      (constructor (name age)
        (do
          (= this.name name)
          (= this.age age))))

    (var person (new Person "Alice" 30))
    [person.name person.age]
  `);

  assertEquals(result, ["Alice", 30]);
});

Deno.test("class: methods read and update instance state", async () => {
  const result = await runLoose(`
    (class Counter
      (constructor ()
        (= this.count 0))

      (fn increment []
        (= this.count (+ this.count 1))
        this.count)

      (fn greet []
        (+ "count=" this.count)))

    (var counter (new Counter))
    [(counter.increment) (counter.increment) (counter.greet)]
  `);

  assertEquals(result, [1, 2, "count=2"]);
});

Deno.test("class: fields support var, let, const, and runtime mutation", async () => {
  const result = await runLoose(`
    (class Account
      (const bankName "MyBank")
      (let defaultTier "basic")
      (var balance 0)

      (constructor (number initialBalance)
        (do
          (= this.number number)
          (= this.balance initialBalance))))

    (var account (new Account "ACC-1" 100))
    (= account.balance (+ account.balance 50))
    (= account.nickname "primary")
    [account.bankName account.defaultTier account.balance account.nickname]
  `);

  assertEquals(result, ["MyBank", "basic", 150, "primary"]);
});

Deno.test("class: instances are independent and methods can call other methods", async () => {
  const result = await runLoose(`
    (class Person
      (constructor (name)
        (= this.name name))

      (fn getName []
        this.name)

      (fn rename [next]
        (= this.name next)
        this)

      (fn greet []
        (+ "Hello, " (this.getName))))

    (var alice (new Person "Alice"))
    (var bob (new Person "Bob"))
    (alice.rename "Alicia")
    [(alice.greet) (bob.greet)]
  `);

  assertEquals(result, ["Hello, Alicia", "Hello, Bob"]);
});

Deno.test("class: methods support computed expressions and object returns", async () => {
  const result = await runLoose(`
    (class Rectangle
      (constructor (width height)
        (do
          (= this.width width)
          (= this.height height)))

      (fn scale [factor]
        (* (+ this.width this.height) factor))

      (fn describe []
        {"area": (* this.width this.height), "perimeter": (* (+ this.width this.height) 2)}))

    (var rect (new Rectangle 10 5))
    [(rect.scale 2) (rect.scale 3) (rect.describe)]
  `);

  assertEquals(result, [30, 45, { area: 50, perimeter: 30 }]);
});

Deno.test("class: constructors can compute derived properties", async () => {
  const result = await runLoose(`
    (class Point
      (constructor (x y)
        (do
          (= this.x x)
          (= this.y y)
          (= this.sum (+ x y))))

      (fn magnitudeHint []
        (+ this.sum this.x)))

    (var point (new Point 10 20))
    [point.sum (point.magnitudeHint)]
  `);

  assertEquals(result, [30, 40]);
});

Deno.test("class: inheritance preserves parent fields, methods, and instanceof", async () => {
  const result = await runLoose(`
    (class Animal
      (constructor [name]
        (= this.name name))

      (fn describe []
        (+ "Animal:" this.name)))

    (class Dog extends Animal
      (constructor [name breed]
        (super name)
        (= this.breed breed))

      (fn speak []
        (+ this.name " barks")))

    (var dog (new Dog "Rex" "Collie"))
    [(dog.describe) (dog.speak) (instanceof dog Dog) (instanceof dog Animal) dog.breed]
  `);

  assertEquals(result, ["Animal:Rex", "Rex barks", true, true, "Collie"]);
});

Deno.test("class: super passes parent constructor arguments", async () => {
  const result = await runLoose(`
    (class Vehicle
      (constructor [speed]
        (= this.speed speed)))

    (class Car extends Vehicle
      (constructor [speed brand]
        (super speed)
        (= this.brand brand)))

    (var car (new Car 120 "Toyota"))
    [car.speed car.brand]
  `);

  assertEquals(result, [120, "Toyota"]);
});
