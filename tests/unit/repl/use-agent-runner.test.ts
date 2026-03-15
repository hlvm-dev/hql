import { assertEquals } from "jsr:@std/assert";
import { getConversationToolDenylist } from "../../../src/hlvm/cli/repl-ink/hooks/useAgentRunner.ts";

Deno.test("getConversationToolDenylist keeps ask_user available while disabling delegation in non-plan modes", () => {
  assertEquals(getConversationToolDenylist("default"), [
    "complete_task",
    "delegate_agent",
    "batch_delegate",
    "wait_agent",
    "list_agents",
    "close_agent",
    "apply_agent_changes",
    "discard_agent_changes",
    "send_input",
    "interrupt_agent",
    "resume_agent",
  ]);
  assertEquals(getConversationToolDenylist("auto-edit"), [
    "complete_task",
    "delegate_agent",
    "batch_delegate",
    "wait_agent",
    "list_agents",
    "close_agent",
    "apply_agent_changes",
    "discard_agent_changes",
    "send_input",
    "interrupt_agent",
    "resume_agent",
  ]);
  assertEquals(getConversationToolDenylist("yolo"), [
    "complete_task",
    "delegate_agent",
    "batch_delegate",
    "wait_agent",
    "list_agents",
    "close_agent",
    "apply_agent_changes",
    "discard_agent_changes",
    "send_input",
    "interrupt_agent",
    "resume_agent",
  ]);
  assertEquals(getConversationToolDenylist("plan"), ["complete_task"]);
});
