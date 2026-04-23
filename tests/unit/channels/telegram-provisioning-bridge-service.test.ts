import { assertEquals } from "jsr:@std/assert";
import {
  createTelegramProvisioningBridgeService,
  handleTelegramProvisioningBridgeClaim,
  handleTelegramProvisioningBridgeComplete,
  handleTelegramProvisioningBridgeRegister,
  handleTelegramProvisioningBridgeStart,
} from "../../../src/hlvm/channels/telegram/provisioning-bridge-service.ts";

function jsonRequest(url: string, body: unknown): Request {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

Deno.test("telegram provisioning bridge: register -> start redirect -> complete -> claim", async () => {
  const service = createTelegramProvisioningBridgeService({
    now: () => Date.parse("2026-04-21T00:00:00.000Z"),
  });

  const register = await handleTelegramProvisioningBridgeRegister(
    jsonRequest("https://provision.hlvm.dev/api/telegram/provisioning/session", {
      sessionId: "session-1",
      claimToken: "claim-1",
      managerBotUsername: "hlvm_manager_bot",
      botName: "HLVM",
      botUsername: "hlvm_test_bot",
      expiresAt: "2026-04-21T00:10:00.000Z",
    }),
    { service },
  );
  const registered = await register.json();
  assertEquals(register.status, 201);
  assertEquals(registered.createUrl, "https://t.me/newbot/hlvm_manager_bot/hlvm_test_bot?name=HLVM");

  const redirect = await handleTelegramProvisioningBridgeStart(
    new Request("https://provision.hlvm.dev/telegram/start?session=session-1"),
    { service },
  );
  assertEquals(redirect.status, 302);
  assertEquals(redirect.headers.get("location"), registered.createUrl);

  const complete = await handleTelegramProvisioningBridgeComplete(
    jsonRequest("https://provision.hlvm.dev/api/telegram/provisioning/session/complete", {
      sessionId: "session-1",
      token: "123:abc",
    }),
    { service },
  );
  const completed = await complete.json();
  assertEquals(complete.status, 200);
  assertEquals(completed.state, "completed");

  const claim = await handleTelegramProvisioningBridgeClaim(
    jsonRequest("https://provision.hlvm.dev/api/telegram/provisioning/session/claim", {
      sessionId: "session-1",
      claimToken: "claim-1",
    }),
    { service },
  );
  const claimed = await claim.json();
  assertEquals(claim.status, 200);
  assertEquals(claimed.token, "123:abc");
  assertEquals(claimed.session.state, "claimed");
});

Deno.test("telegram provisioning bridge: claim is blocked when pending or token is wrong", async () => {
  const service = createTelegramProvisioningBridgeService({
    now: () => Date.parse("2026-04-21T00:00:00.000Z"),
  });

  await service.registerSession({
    sessionId: "session-1",
    claimToken: "claim-1",
    managerBotUsername: "hlvm_manager_bot",
    botName: "HLVM",
    botUsername: "hlvm_test_bot",
    expiresAt: "2026-04-21T00:10:00.000Z",
  });

  const pendingClaim = await handleTelegramProvisioningBridgeClaim(
    jsonRequest("https://provision.hlvm.dev/api/telegram/provisioning/session/claim", {
      sessionId: "session-1",
      claimToken: "claim-1",
    }),
    { service },
  );
  assertEquals(pendingClaim.status, 409);

  await handleTelegramProvisioningBridgeComplete(
    jsonRequest("https://provision.hlvm.dev/api/telegram/provisioning/session/complete", {
      sessionId: "session-1",
      token: "123:abc",
    }),
    { service },
  );

  const forbiddenClaim = await handleTelegramProvisioningBridgeClaim(
    jsonRequest("https://provision.hlvm.dev/api/telegram/provisioning/session/claim", {
      sessionId: "session-1",
      claimToken: "wrong",
    }),
    { service },
  );
  assertEquals(forbiddenClaim.status, 403);
});

Deno.test("telegram provisioning bridge: complete is idempotent after claim", async () => {
  const service = createTelegramProvisioningBridgeService({
    now: () => Date.parse("2026-04-21T00:00:00.000Z"),
  });

  await handleTelegramProvisioningBridgeRegister(
    jsonRequest("https://provision.hlvm.dev/api/telegram/provisioning/session", {
      sessionId: "session-1",
      claimToken: "claim-1",
      managerBotUsername: "hlvm_manager_bot",
      botName: "HLVM",
      botUsername: "hlvm_test_bot",
      expiresAt: "2026-04-21T00:10:00.000Z",
    }),
    { service },
  );
  await handleTelegramProvisioningBridgeComplete(
    jsonRequest("https://provision.hlvm.dev/api/telegram/provisioning/session/complete", {
      sessionId: "session-1",
      token: "123:abc",
    }),
    { service },
  );
  await handleTelegramProvisioningBridgeClaim(
    jsonRequest("https://provision.hlvm.dev/api/telegram/provisioning/session/claim", {
      sessionId: "session-1",
      claimToken: "claim-1",
    }),
    { service },
  );

  const repeatedComplete = await handleTelegramProvisioningBridgeComplete(
    jsonRequest("https://provision.hlvm.dev/api/telegram/provisioning/session/complete", {
      sessionId: "session-1",
      token: "456:def",
    }),
    { service },
  );
  const repeatedBody = await repeatedComplete.json();

  assertEquals(repeatedComplete.status, 200);
  assertEquals(repeatedBody.state, "claimed");
});

Deno.test("telegram provisioning bridge: claim waits for completion when requested", async () => {
  const service = createTelegramProvisioningBridgeService({
    now: () => Date.parse("2026-04-21T00:00:00.000Z"),
  });

  await handleTelegramProvisioningBridgeRegister(
    jsonRequest("https://provision.hlvm.dev/api/telegram/provisioning/session", {
      sessionId: "session-1",
      claimToken: "claim-1",
      managerBotUsername: "hlvm_manager_bot",
      botName: "HLVM",
      botUsername: "hlvm_test_bot",
      expiresAt: "2026-04-21T00:10:00.000Z",
    }),
    { service },
  );

  const claimPromise = handleTelegramProvisioningBridgeClaim(
    jsonRequest("https://provision.hlvm.dev/api/telegram/provisioning/session/claim", {
      sessionId: "session-1",
      claimToken: "claim-1",
      waitMs: 250,
    }),
    { service },
  );

  setTimeout(() => {
    void handleTelegramProvisioningBridgeComplete(
      jsonRequest("https://provision.hlvm.dev/api/telegram/provisioning/session/complete", {
        sessionId: "session-1",
        token: "123:abc",
      }),
      { service },
    );
  }, 0);

  const claim = await claimPromise;
  const claimed = await claim.json();
  assertEquals(claim.status, 200);
  assertEquals(claimed.token, "123:abc");
});

Deno.test("telegram provisioning bridge: manager completion matches by created bot username", async () => {
  const service = createTelegramProvisioningBridgeService({
    now: () => Date.parse("2026-04-21T00:00:00.000Z"),
  });

  await service.registerSession({
    sessionId: "session-1",
    claimToken: "claim-1",
    managerBotUsername: "hlvm_manager_bot",
    botName: "HLVM",
    botUsername: "TestHLVMBot",
    expiresAt: "2026-04-21T00:10:00.000Z",
  });

  const completed = await service.completeSessionForBotUsername({
    botUsername: "@testhlvmbot",
    token: "123:abc",
    username: "TestHLVMBot",
    ownerUserId: 777,
  });
  assertEquals(completed?.state, "completed");

  const claim = await handleTelegramProvisioningBridgeClaim(
    jsonRequest("https://provision.hlvm.dev/api/telegram/provisioning/session/claim", {
      sessionId: "session-1",
      claimToken: "claim-1",
    }),
    { service },
  );
  const claimed = await claim.json();
  assertEquals(claim.status, 200);
  assertEquals(claimed.token, "123:abc");
  assertEquals(claimed.ownerUserId, 777);
});

Deno.test("telegram provisioning bridge: auto-adopts a sole unmatched managed bot for the waiting session", async () => {
  const nowMs = Date.parse("2026-04-21T00:00:00.000Z");
  const service = createTelegramProvisioningBridgeService({
    now: () => nowMs,
  });

  await service.registerSession({
    sessionId: "session-1",
    claimToken: "claim-1",
    managerBotUsername: "hlvm_setup_helper_2_bot",
    botName: "HLVM",
    botUsername: "hlvm_prefilled_bot",
    expiresAt: "2026-04-21T00:10:00.000Z",
  });

  await service.storeUnclaimedManagedBot({
    managerBotUsername: "hlvm_setup_helper_2_bot",
    botUsername: "hlvm_jssbot",
    token: "123:abc",
    ownerUserId: 42,
  });

  const claim = await handleTelegramProvisioningBridgeClaim(
    jsonRequest("https://provision.hlvm.dev/api/telegram/provisioning/session/claim", {
      sessionId: "session-1",
      claimToken: "claim-1",
    }),
    { service },
  );
  const claimed = await claim.json();
  assertEquals(claim.status, 200);
  assertEquals(claimed.token, "123:abc");
  assertEquals(claimed.username, "hlvm_jssbot");
  assertEquals(claimed.session.state, "claimed");
});

Deno.test("telegram provisioning bridge: owner-bound pending session completes when created username changed", async () => {
  const service = createTelegramProvisioningBridgeService({
    now: () => Date.parse("2026-04-21T00:00:00.000Z"),
  });

  await service.registerSession({
    sessionId: "session-1",
    claimToken: "claim-1",
    deviceId: "device-1",
    ownerUserId: 42,
    managerBotUsername: "hlvm_setup_helper_2_bot",
    botName: "HLVM",
    botUsername: "hlvm_prefilled_bot",
    expiresAt: "2026-04-21T00:10:00.000Z",
  });

  const completed = await service.completeSessionForBotUsername({
    botUsername: "hlvm_jssbot",
    managerBotUsername: "hlvm_setup_helper_2_bot",
    token: "123:abc",
    username: "hlvm_jssbot",
    ownerUserId: 42,
  });
  assertEquals(completed?.state, "completed");

  const claim = await handleTelegramProvisioningBridgeClaim(
    jsonRequest("https://provision.hlvm.dev/api/telegram/provisioning/session/claim", {
      sessionId: "session-1",
      claimToken: "claim-1",
    }),
    { service },
  );
  const claimed = await claim.json();
  assertEquals(claim.status, 200);
  assertEquals(claimed.username, "hlvm_jssbot");
  assertEquals(claimed.ownerUserId, 42);
});

Deno.test("telegram provisioning bridge: a new device session supersedes the older pending session", async () => {
  const service = createTelegramProvisioningBridgeService({
    now: () => Date.parse("2026-04-21T00:00:00.000Z"),
  });

  await service.registerSession({
    sessionId: "session-1",
    claimToken: "claim-1",
    deviceId: "device-1",
    managerBotUsername: "hlvm_manager_bot",
    botName: "HLVM",
    botUsername: "hlvm_old_bot",
    expiresAt: "2026-04-21T00:10:00.000Z",
  });

  await service.registerSession({
    sessionId: "session-2",
    claimToken: "claim-2",
    deviceId: "device-1",
    managerBotUsername: "hlvm_manager_bot",
    botName: "HLVM",
    botUsername: "hlvm_new_bot",
    expiresAt: "2026-04-21T00:10:00.000Z",
  });

  assertEquals(await service.getSession("session-1"), null);
  assertEquals((await service.getSession("session-2"))?.state, "pending");

  const oldClaim = await handleTelegramProvisioningBridgeClaim(
    jsonRequest("https://provision.hlvm.dev/api/telegram/provisioning/session/claim", {
      sessionId: "session-1",
      claimToken: "claim-1",
    }),
    { service },
  );
  assertEquals(oldClaim.status, 404);

  const redirect = await handleTelegramProvisioningBridgeStart(
    new Request("https://provision.hlvm.dev/telegram/start?session=session-2"),
    { service },
  );
  assertEquals(redirect.status, 302);
  assertEquals(
    redirect.headers.get("location"),
    "https://t.me/newbot/hlvm_manager_bot/hlvm_new_bot?name=HLVM",
  );
});

Deno.test("telegram provisioning bridge: expired sessions disappear", async () => {
  let nowMs = Date.parse("2026-04-21T00:00:00.000Z");
  const service = createTelegramProvisioningBridgeService({
    now: () => nowMs,
  });

  await service.registerSession({
    sessionId: "session-1",
    claimToken: "claim-1",
    managerBotUsername: "hlvm_manager_bot",
    botName: "HLVM",
    botUsername: "hlvm_test_bot",
    expiresAt: "2026-04-21T00:00:01.000Z",
  });
  assertEquals((await service.getSession("session-1"))?.state, "pending");

  nowMs = Date.parse("2026-04-21T00:00:02.000Z");

  assertEquals(await service.getSession("session-1"), null);
  assertEquals(await service.getStartRedirect("session-1"), null);
});

Deno.test("telegram provisioning bridge: reset clears pending session, owner record, and unclaimed bot", async () => {
  const service = createTelegramProvisioningBridgeService({
    now: () => Date.parse("2026-04-21T00:00:00.000Z"),
  });

  await service.registerSession({
    sessionId: "session-1",
    claimToken: "claim-1",
    deviceId: "device-1",
    ownerUserId: 42,
    managerBotUsername: "hlvm_setup_helper_2_bot",
    botName: "HLVM",
    botUsername: "hlvm_prefilled_bot",
    expiresAt: "2026-04-21T00:10:00.000Z",
  });
  await service.completeSessionForBotUsername({
    botUsername: "hlvm_prefilled_bot",
    managerBotUsername: "hlvm_setup_helper_2_bot",
    token: "123:abc",
    username: "hlvm_prefilled_bot",
    ownerUserId: 42,
  });
  await service.storeUnclaimedManagedBot({
    managerBotUsername: "hlvm_setup_helper_2_bot",
    botUsername: "hlvm_orphan_bot",
    token: "123:xyz",
    ownerUserId: 42,
  });

  const reset = await service.resetState({
    deviceId: "device-1",
    managerBotUsername: "hlvm_setup_helper_2_bot",
    ownerUserId: 42,
  });
  assertEquals(reset, {
    clearedPendingSessions: 0,
    clearedUnclaimedBots: 1,
    clearedOwnerBot: true,
  });
});
