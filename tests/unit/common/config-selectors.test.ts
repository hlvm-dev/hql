import { assertEquals } from "jsr:@std/assert";
import {
  getApprovedProviders,
  getConfiguredModel,
  getContextWindow,
  getPermissionMode,
  getTheme,
} from "../../../src/common/config/selectors.ts";
import { DEFAULT_CONFIG, DEFAULT_MODEL_ID } from "../../../src/common/config/types.ts";

Deno.test("config selectors: configured model falls back to default model id", () => {
  assertEquals(getConfiguredModel({ model: "openai/gpt-4o" }), "openai/gpt-4o");
  assertEquals(getConfiguredModel({}), DEFAULT_MODEL_ID);
});

Deno.test("config selectors: context window only accepts positive integers", () => {
  assertEquals(getContextWindow({ contextWindow: 131072 }), 131072);
  assertEquals(getContextWindow({ contextWindow: 0 }), undefined);
  assertEquals(getContextWindow({ contextWindow: 4096.5 }), undefined);
});

Deno.test("config selectors: permission mode is normalized through one helper", () => {
  assertEquals(getPermissionMode({ permissionMode: "auto-edit" }), "auto-edit");
  assertEquals(getPermissionMode({ permissionMode: "yolo" }), "yolo");
  assertEquals(getPermissionMode({ permissionMode: "invalid" }), undefined);
});

Deno.test("config selectors: approved providers and theme have safe defaults", () => {
  assertEquals(getApprovedProviders({ approvedProviders: ["openai", 123] }), [
    "openai",
  ]);
  assertEquals(getApprovedProviders({}), []);
  assertEquals(getTheme({ theme: "nord" }), "nord");
  assertEquals(getTheme({}), DEFAULT_CONFIG.theme);
});
