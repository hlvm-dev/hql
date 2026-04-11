import { assertEquals } from "jsr:@std/assert";
import {
  responseAsksQuestion,
  shouldSuppressFinalResponse,
} from "../../../src/hlvm/agent/model-compat.ts";

Deno.test("model compat: responseAsksQuestion uses deterministic response analysis", () => {
  assertEquals(
    responseAsksQuestion(
      "I can implement that feature. Do you want me to start with the backend or frontend?",
    ),
    true,
  );
  assertEquals(
    responseAsksQuestion(
      "Done. The function now handles edge cases correctly.",
    ),
    false,
  );
});

Deno.test("model compat: shouldSuppressFinalResponse only suppresses structural output", () => {
  assertEquals(shouldSuppressFinalResponse(""), true);
  assertEquals(
    shouldSuppressFinalResponse('search_web({"query":"latest Deno blog"})'),
    true,
  );
  assertEquals(
    shouldSuppressFinalResponse(`<function_calls>
<invoke name="web_fetch">
<parameter name="url">https://deno.com</parameter>
</invoke>
</function_calls>`),
    true,
  );
  assertEquals(
    shouldSuppressFinalResponse("Use the search_web tool to look this up."),
    false,
  );
});
