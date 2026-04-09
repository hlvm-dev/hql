import { assertEquals } from "jsr:@std/assert";
import {
  formatRuntimeMessage,
  runtimeDirective,
  runtimeNotice,
  runtimeUpdate,
} from "../../../src/hlvm/agent/runtime-messages.ts";

Deno.test("runtime-messages: formats runtime directives, notices, and updates exactly", () => {
  assertEquals(
    formatRuntimeMessage("directive", "follow the plan"),
    "[Runtime Directive]\nfollow the plan",
  );
  assertEquals(
    formatRuntimeMessage("notice", "tool context narrowed"),
    "[Runtime Notice]\ntool context narrowed",
  );
  assertEquals(
    formatRuntimeMessage("update", "worker finished"),
    "[Runtime Update]\nworker finished",
  );
  assertEquals(
    runtimeDirective("continue"),
    "[Runtime Directive]\ncontinue",
  );
  assertEquals(
    runtimeNotice("watch for reset"),
    "[Runtime Notice]\nwatch for reset",
  );
  assertEquals(
    runtimeUpdate("delegate completed"),
    "[Runtime Update]\ndelegate completed",
  );
});
