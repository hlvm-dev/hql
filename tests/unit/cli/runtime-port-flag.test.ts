import { assertEquals, assertThrows } from "jsr:@std/assert";
import {
  extractLeadingRuntimePortFlag,
  extractRuntimePortFlag,
} from "../../../src/hlvm/cli/utils/runtime-port-flag.ts";
import { ValidationError } from "../../../src/common/error.ts";

Deno.test("runtime port flag extracts command-local --port", () => {
  assertEquals(
    extractRuntimePortFlag(["--verbose", "--port", "18442", "hello"]),
    {
      args: ["--verbose", "hello"],
      port: "18442",
    },
  );
});

Deno.test("runtime port flag extracts --port=value", () => {
  assertEquals(
    extractRuntimePortFlag(["--port=18442", "hello"]),
    {
      args: ["hello"],
      port: "18442",
    },
  );
});

Deno.test("runtime port flag only treats leading --port as global", () => {
  assertEquals(
    extractLeadingRuntimePortFlag(["run", "file.hql", "--port", "18442"]),
    { args: ["run", "file.hql", "--port", "18442"] },
  );
  assertEquals(
    extractLeadingRuntimePortFlag(["--port", "18442", "ask", "hello"]),
    {
      args: ["ask", "hello"],
      port: "18442",
    },
  );
});

Deno.test("runtime port flag validates range", () => {
  assertThrows(
    () => extractRuntimePortFlag(["--port", "70000"]),
    ValidationError,
  );
  assertThrows(
    () => extractRuntimePortFlag(["--port", "abc"]),
    ValidationError,
  );
  assertThrows(
    () => extractRuntimePortFlag(["--port"]),
    ValidationError,
  );
});
