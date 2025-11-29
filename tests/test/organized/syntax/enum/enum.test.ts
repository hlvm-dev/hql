// test/syntax-enum.test.ts
// Comprehensive tests for enum definitions
// Based on hql_enum.md spec and doc/examples/enum.hql

import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { run } from "../../../helpers.ts";

// ============================================================================
// SECTION 1: SIMPLE ENUMS (Object-based Implementation)
// ============================================================================

Deno.test("Enum: define simple enum", async () => {
  const code = `
(enum Direction
  (case north)
  (case south)
  (case east)
  (case west))

Direction
`;
  const result = await run(code);
  assertEquals(typeof result, "object");
  assertEquals(Object.isFrozen(result), true);
});

Deno.test("Enum: access simple enum value", async () => {
  const code = `
(enum Direction
  (case north)
  (case south)
  (case east)
  (case west))

Direction.north
`;
  const result = await run(code);
  assertEquals(result, "north");
});

Deno.test("Enum: compare enum values with equality", async () => {
  const code = `
(enum Direction
  (case north)
  (case south))

(var heading Direction.north)
(=== heading Direction.north)
`;
  const result = await run(code);
  assertEquals(result, true);
});

Deno.test("Enum: use enum in conditional (cond)", async () => {
  const code = `
(enum Direction
  (case north)
  (case south)
  (case east)
  (case west))

(var heading Direction.east)

(cond
  ((=== heading Direction.north) "going-north")
  ((=== heading Direction.south) "going-south")
  ((=== heading Direction.east) "going-east")
  ((=== heading Direction.west) "going-west")
  (else "unknown"))
`;
  const result = await run(code);
  assertEquals(result, "going-east");
});

// ============================================================================
// SECTION 2: ENUMS WITH RAW VALUES
// ============================================================================

Deno.test("Enum: define enum with raw values", async () => {
  const code = `
(enum HttpStatus
  (case ok 200)
  (case notFound 404)
  (case serverError 500))

HttpStatus
`;
  const result = await run(code);
  assertEquals(typeof result, "object");
  assertEquals(Object.isFrozen(result), true);
});

Deno.test("Enum: access raw value", async () => {
  const code = `
(enum HttpStatus
  (case ok 200)
  (case notFound 404))

HttpStatus.notFound
`;
  const result = await run(code);
  assertEquals(result, 404);
});

Deno.test("Enum: compare raw values numerically", async () => {
  const code = `
(enum HttpStatus
  (case ok 200)
  (case badRequest 400)
  (case notFound 404)
  (case serverError 500))

(var status HttpStatus.notFound)
(>= status 400)
`;
  const result = await run(code);
  assertEquals(result, true);
});

// ============================================================================
// SECTION 3: ENUMS WITH ASSOCIATED VALUES (Class-based Implementation)
// ============================================================================

Deno.test("Enum: define enum with associated values", async () => {
  const code = `
(enum Payment
  (case cash amount)
  (case creditCard number))

Payment
`;
  const result = await run(code);
  assertEquals(typeof result, "function");
});

Deno.test("Enum: create instance with associated values", async () => {
  const code = `
(enum Payment
  (case cash amount)
  (case creditCard number expiry))

(var payment (Payment.cash 100))
payment
`;
  const result = await run(code);
  assertEquals(typeof result, "object");
  assertEquals(result.type, "cash");
});

Deno.test("Enum: use is() method to check enum case type", async () => {
  const code = `
(enum Payment
  (case cash amount)
  (case creditCard number))

(var payment (Payment.cash 100))
(payment.is "cash")
`;
  const result = await run(code);
  assertEquals(result, true);
});

Deno.test("Enum: access associated values from enum instance", async () => {
  const code = `
(enum Payment
  (case cash amount))

(var payment (Payment.cash 150))
(get payment.values "amount")
`;
  const result = await run(code);
  assertEquals(result, 150);
});

// ============================================================================
// SECTION 4: TYPE INFERENCE WITH DOT NOTATION
// ============================================================================

// TODO: Dot notation type inference not yet implemented
// Should allow (install .macOS) instead of (install OS.macOS)
Deno.test("Enum: dot notation in function parameters", async () => {
  const code = `
(enum OS
  (case macOS)
  (case iOS)
  (case linux))

(fn install [os]
  (cond
    ((=== os OS.macOS) "Installing on macOS")
    ((=== os OS.iOS) "Installing on iOS")
    ((=== os OS.linux) "Installing on Linux")
    (else "Unsupported OS")))

(install OS.macOS)
`;
  const result = await run(code);
  assertEquals(result, "Installing on macOS");
});

// TODO: Dot notation type inference not yet implemented
// Should allow (checkStatus .ok) instead of (checkStatus StatusCode.ok)
Deno.test("Enum: dot notation in equality", async () => {
  const code = `
(enum StatusCode
  (case ok 200)
  (case notFound 404)
  (case serverError 500))

(fn checkStatus [code]
  (if (=== code StatusCode.ok)
    "Everything is ok!"
    "Not ok!"))

(checkStatus StatusCode.ok)
`;
  const result = await run(code);
  assertEquals(result, "Everything is ok!");
});
