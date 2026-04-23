import {
  buildTelegramManagedBotCreateUrl,
} from "./provisioning-bridge.ts";
import { ValidationError } from "../../../common/error.ts";
import { getPlatform } from "../../../platform/platform.ts";
import type { PlatformKv, PlatformKvKey } from "../../../platform/types.ts";
import { log } from "../../api/log.ts";
import { logTelegramE2ETrace } from "./e2e-trace.ts";
import type {
  TelegramProvisioningBridgeClaimRequest,
  TelegramProvisioningBridgeClaimResult,
  TelegramProvisioningBridgeCompletionInput,
  TelegramProvisioningBridgeRegistration,
  TelegramProvisioningBridgeSessionSnapshot,
} from "./provisioning-bridge-protocol.ts";

type BridgeSessionState = "pending" | "completed" | "claimed";
const UNCLAIMED_MANAGED_BOT_TTL_MS = 30 * 60 * 1000;
const UNCLAIMED_MANAGED_BOT_SKEW_MS = 60 * 1000;

interface TelegramProvisioningBridgeSessionInternal {
  sessionId: string;
  claimToken: string;
  deviceId?: string;
  managerBotUsername: string;
  botName: string;
  botUsername: string;
  createUrl: string;
  createdAtMs: number;
  expiresAtMs: number;
  state: BridgeSessionState;
  token?: string;
  username?: string;
  ownerUserId?: number;
  completedAtMs?: number;
}

interface TelegramProvisioningBridgeUnclaimedBot {
  managerBotUsername: string;
  botUsername: string;
  token: string;
  ownerUserId?: number;
  createdAtMs: number;
  expiresAtMs: number;
}

interface TelegramProvisioningBridgeServiceDeps {
  now?: () => number;
  store?: TelegramProvisioningBridgeStore;
}

export interface TelegramProvisioningBridgeService {
  registerSession(
    input: TelegramProvisioningBridgeRegistration,
  ): Promise<TelegramProvisioningBridgeSessionSnapshot>;
  getSession(sessionId: string): Promise<TelegramProvisioningBridgeSessionSnapshot | null>;
  getStartRedirect(sessionId: string): Promise<string | null>;
  completeSession(
    input: TelegramProvisioningBridgeCompletionInput,
  ): Promise<TelegramProvisioningBridgeSessionSnapshot | null>;
  completeSessionForBotUsername(
    input: { botUsername: string; token: string; username?: string; ownerUserId?: number },
  ): Promise<TelegramProvisioningBridgeSessionSnapshot | null>;
  storeUnclaimedManagedBot(
    input: {
      managerBotUsername: string;
      botUsername: string;
      token: string;
      ownerUserId?: number;
    },
  ): Promise<void>;
  claimSession(
    input: TelegramProvisioningBridgeClaimRequest,
  ): Promise<TelegramProvisioningBridgeClaimResult>;
}

interface TelegramProvisioningBridgeStoreEntry {
  session: TelegramProvisioningBridgeSessionInternal;
  version: string | null;
}

interface TelegramProvisioningBridgeStore {
  getSession(sessionId: string): Promise<TelegramProvisioningBridgeStoreEntry | null>;
  getSessionByBotUsername(
    botUsername: string,
  ): Promise<TelegramProvisioningBridgeStoreEntry | null>;
  getPendingSessionByDeviceId(
    deviceId: string,
  ): Promise<TelegramProvisioningBridgeStoreEntry | null>;
  listUnclaimedManagedBots(
    managerBotUsername: string,
  ): Promise<TelegramProvisioningBridgeUnclaimedBot[]>;
  setSession(session: TelegramProvisioningBridgeSessionInternal): Promise<void>;
  deleteSession(session: TelegramProvisioningBridgeSessionInternal): Promise<void>;
  setUnclaimedManagedBot(bot: TelegramProvisioningBridgeUnclaimedBot): Promise<void>;
  deleteUnclaimedManagedBot(bot: TelegramProvisioningBridgeUnclaimedBot): Promise<void>;
  waitForChange(sessionId: string, version: string | null, waitMs: number): Promise<void>;
}

function logTelegramProvisioningBridge(event: string, data: Record<string, unknown>): void {
  logTelegramE2ETrace("bridge", event, data);
  log.raw.log(`[telegram-provisioning-bridge] ${event} ${JSON.stringify(data)}`);
}

function parseIsoTimestamp(
  value: string | undefined,
  fallbackMs: number,
): number {
  if (!value) return fallbackMs;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : fallbackMs;
}

function toSnapshot(
  session: TelegramProvisioningBridgeSessionInternal,
): TelegramProvisioningBridgeSessionSnapshot {
  return {
    sessionId: session.sessionId,
    state: session.state,
    managerBotUsername: session.managerBotUsername,
    botName: session.botName,
    botUsername: session.botUsername,
    createUrl: session.createUrl,
    createdAt: new Date(session.createdAtMs).toISOString(),
    expiresAt: new Date(session.expiresAtMs).toISOString(),
    ...(session.completedAtMs
      ? { completedAt: new Date(session.completedAtMs).toISOString() }
      : {}),
  };
}

function trimNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeTelegramUsername(value: string): string {
  return value.trim().replace(/^@+/, "").toLowerCase();
}

function sessionKey(sessionId: string): PlatformKvKey {
  return ["hlvm", "telegram_provisioning_bridge", "session", sessionId];
}

function botUsernameKey(botUsername: string): PlatformKvKey {
  return ["hlvm", "telegram_provisioning_bridge", "bot", normalizeTelegramUsername(botUsername)];
}

function deviceIdKey(deviceId: string): PlatformKvKey {
  return ["hlvm", "telegram_provisioning_bridge", "device", deviceId.trim()];
}

function unclaimedManagerPrefix(managerBotUsername: string): PlatformKvKey {
  return [
    "hlvm",
    "telegram_provisioning_bridge",
    "unclaimed",
    normalizeTelegramUsername(managerBotUsername),
  ];
}

function unclaimedManagedBotKey(
  managerBotUsername: string,
  botUsername: string,
): PlatformKvKey {
  return [...unclaimedManagerPrefix(managerBotUsername), normalizeTelegramUsername(botUsername)];
}

function createMemoryTelegramProvisioningBridgeStore(): TelegramProvisioningBridgeStore {
  const sessions = new Map<
    string,
    { session: TelegramProvisioningBridgeSessionInternal; version: number }
  >();
  const botUsernames = new Map<string, string>();
  const pendingDeviceIds = new Map<string, string>();
  const unclaimedManagedBots = new Map<string, TelegramProvisioningBridgeUnclaimedBot>();
  const waiters = new Map<string, Set<() => void>>();
  let nextVersion = 1;

  function notifyWaiters(sessionId: string): void {
    const callbacks = waiters.get(sessionId);
    if (!callbacks) return;
    waiters.delete(sessionId);
    for (const callback of callbacks) callback();
  }

  return {
    async getSession(sessionId) {
      const entry = sessions.get(sessionId);
      if (!entry) return null;
      return { session: entry.session, version: String(entry.version) };
    },

    async getSessionByBotUsername(botUsername) {
      const sessionId = botUsernames.get(normalizeTelegramUsername(botUsername));
      if (!sessionId) return null;
      return await this.getSession(sessionId);
    },

    async getPendingSessionByDeviceId(deviceId) {
      const sessionId = pendingDeviceIds.get(deviceId.trim());
      if (!sessionId) return null;
      return await this.getSession(sessionId);
    },

    async listUnclaimedManagedBots(managerBotUsername) {
      const prefix = `${normalizeTelegramUsername(managerBotUsername)}:`;
      return [...unclaimedManagedBots.entries()]
        .filter(([key]) => key.startsWith(prefix))
        .map(([, value]) => value);
    },

    async setSession(session) {
      sessions.set(session.sessionId, { session, version: nextVersion++ });
      botUsernames.set(normalizeTelegramUsername(session.botUsername), session.sessionId);
      const trimmedDeviceId = session.deviceId?.trim();
      if (trimmedDeviceId) {
        if (session.state === "pending") {
          pendingDeviceIds.set(trimmedDeviceId, session.sessionId);
        } else if (pendingDeviceIds.get(trimmedDeviceId) === session.sessionId) {
          pendingDeviceIds.delete(trimmedDeviceId);
        }
      }
      notifyWaiters(session.sessionId);
    },

    async deleteSession(session) {
      sessions.delete(session.sessionId);
      const normalizedBotUsername = normalizeTelegramUsername(session.botUsername);
      if (botUsernames.get(normalizedBotUsername) === session.sessionId) {
        botUsernames.delete(normalizedBotUsername);
      }
      const trimmedDeviceId = session.deviceId?.trim();
      if (trimmedDeviceId && pendingDeviceIds.get(trimmedDeviceId) === session.sessionId) {
        pendingDeviceIds.delete(trimmedDeviceId);
      }
      notifyWaiters(session.sessionId);
    },

    async setUnclaimedManagedBot(bot) {
      const key = `${normalizeTelegramUsername(bot.managerBotUsername)}:${
        normalizeTelegramUsername(bot.botUsername)
      }`;
      unclaimedManagedBots.set(key, bot);
    },

    async deleteUnclaimedManagedBot(bot) {
      const key = `${normalizeTelegramUsername(bot.managerBotUsername)}:${
        normalizeTelegramUsername(bot.botUsername)
      }`;
      unclaimedManagedBots.delete(key);
    },

    async waitForChange(sessionId, version, waitMs) {
      if (waitMs <= 0) return;
      const currentVersion = sessions.get(sessionId)?.version;
      if ((currentVersion ? String(currentVersion) : null) !== version) return;
      await new Promise<void>((resolve) => {
        const callbacks = waiters.get(sessionId) ?? new Set<() => void>();
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          clearTimeout(timeoutId);
          callbacks.delete(finish);
          if (callbacks.size === 0) {
            waiters.delete(sessionId);
          }
          resolve();
        };
        callbacks.add(finish);
        waiters.set(sessionId, callbacks);
        const timeoutId = setTimeout(finish, waitMs);
      });
    },
  };
}

export function createKvTelegramProvisioningBridgeStore(
  kv: PlatformKv,
): TelegramProvisioningBridgeStore {
  return {
    async getSession(sessionId) {
      const entry = await kv.get<TelegramProvisioningBridgeSessionInternal>(sessionKey(sessionId));
      if (!entry.value) return null;
      return { session: entry.value, version: entry.versionstamp ?? null };
    },

    async getSessionByBotUsername(botUsername) {
      const botEntry = await kv.get<string>(botUsernameKey(botUsername));
      const sessionId = typeof botEntry.value === "string" ? botEntry.value : null;
      if (!sessionId) return null;
      return await this.getSession(sessionId);
    },

    async getPendingSessionByDeviceId(deviceId) {
      const deviceEntry = await kv.get<string>(deviceIdKey(deviceId));
      const sessionId = typeof deviceEntry.value === "string" ? deviceEntry.value : null;
      if (!sessionId) return null;
      return await this.getSession(sessionId);
    },

    async listUnclaimedManagedBots(managerBotUsername) {
      const results: TelegramProvisioningBridgeUnclaimedBot[] = [];
      for await (
        const entry of kv.list<TelegramProvisioningBridgeUnclaimedBot>({
          prefix: unclaimedManagerPrefix(managerBotUsername),
        })
      ) {
        if (entry.value) results.push(entry.value);
      }
      return results;
    },

    async setSession(session) {
      const op = kv.atomic()
        .set(sessionKey(session.sessionId), session)
        .set(botUsernameKey(session.botUsername), session.sessionId);
      const trimmedDeviceId = session.deviceId?.trim();
      if (trimmedDeviceId) {
        if (session.state === "pending") {
          op.set(deviceIdKey(trimmedDeviceId), session.sessionId);
        } else {
          op.delete(deviceIdKey(trimmedDeviceId));
        }
      }
      await op.commit();
    },

    async deleteSession(session) {
      const op = kv.atomic()
        .delete(sessionKey(session.sessionId))
        .delete(botUsernameKey(session.botUsername));
      const trimmedDeviceId = session.deviceId?.trim();
      if (trimmedDeviceId) {
        op.delete(deviceIdKey(trimmedDeviceId));
      }
      await op.commit();
    },

    async setUnclaimedManagedBot(bot) {
      await kv.set(unclaimedManagedBotKey(bot.managerBotUsername, bot.botUsername), bot);
    },

    async deleteUnclaimedManagedBot(bot) {
      await kv.delete(unclaimedManagedBotKey(bot.managerBotUsername, bot.botUsername));
    },

    async waitForChange(sessionId, version, waitMs) {
      if (waitMs <= 0) return;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), waitMs);
      try {
        while (true) {
          const entry = await kv.get<TelegramProvisioningBridgeSessionInternal>(sessionKey(sessionId));
          const nextVersion = entry.versionstamp ?? null;
          if (nextVersion !== version) return;
          await kv.waitForChange(sessionKey(sessionId), controller.signal);
          if (controller.signal.aborted) return;
        }
      } catch {
        // Ignore timeout / abort.
      } finally {
        clearTimeout(timeoutId);
      }
    },
  };
}

async function openDefaultTelegramProvisioningBridgeStore(): Promise<TelegramProvisioningBridgeStore> {
  const kv = await getPlatform().openKv?.().catch(() => undefined);
  if (kv) {
    return createKvTelegramProvisioningBridgeStore(kv);
  }
  return createMemoryTelegramProvisioningBridgeStore();
}

function json(
  body: unknown,
  status = 200,
): Response {
  return Response.json(body, { status });
}

async function parseJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return null;
  }
}

export function createTelegramProvisioningBridgeService(
  deps: TelegramProvisioningBridgeServiceDeps = {},
): TelegramProvisioningBridgeService {
  const now = deps.now ?? Date.now;
  const store = deps.store ?? createMemoryTelegramProvisioningBridgeStore();

  async function getActiveSession(
    sessionId: string,
  ): Promise<TelegramProvisioningBridgeStoreEntry | null> {
    const entry = await store.getSession(sessionId);
    if (!entry) return null;
    if (entry.session.expiresAtMs > now()) return entry;
    await store.deleteSession(entry.session);
    return null;
  }

  async function listActiveUnclaimedManagedBots(
    managerBotUsername: string,
  ): Promise<TelegramProvisioningBridgeUnclaimedBot[]> {
    const bots = await store.listUnclaimedManagedBots(managerBotUsername);
    const active: TelegramProvisioningBridgeUnclaimedBot[] = [];
    for (const bot of bots) {
      if (bot.expiresAtMs > now()) {
        active.push(bot);
        continue;
      }
      await store.deleteUnclaimedManagedBot(bot);
      logTelegramProvisioningBridge("unclaimed-expired", {
        managerBotUsername: bot.managerBotUsername,
        botUsername: bot.botUsername,
      });
    }
    return active;
  }

  async function tryAutoAdoptUnclaimedManagedBot(
    session: TelegramProvisioningBridgeSessionInternal,
  ): Promise<TelegramProvisioningBridgeSessionSnapshot | null> {
    const candidates = (await listActiveUnclaimedManagedBots(session.managerBotUsername))
      .filter((candidate) =>
        candidate.createdAtMs >= session.createdAtMs - UNCLAIMED_MANAGED_BOT_SKEW_MS &&
        candidate.createdAtMs <= session.expiresAtMs + UNCLAIMED_MANAGED_BOT_SKEW_MS
      );
    if (candidates.length !== 1) {
      logTelegramProvisioningBridge("auto-adopt-skip", {
        sessionId: session.sessionId,
        managerBotUsername: session.managerBotUsername,
        candidateCount: candidates.length,
      });
      return null;
    }
    const candidate = candidates[0];
    const completed = await completeBySessionId({
      sessionId: session.sessionId,
      token: candidate.token,
      username: candidate.botUsername,
      ...(Number.isInteger(candidate.ownerUserId) ? { ownerUserId: candidate.ownerUserId } : {}),
    });
    if (completed) {
      await store.deleteUnclaimedManagedBot(candidate);
      logTelegramProvisioningBridge("auto-adopt-success", {
        sessionId: session.sessionId,
        managerBotUsername: session.managerBotUsername,
        botUsername: candidate.botUsername,
      });
    }
    return completed;
  }

  async function completeBySessionId(
    input: TelegramProvisioningBridgeCompletionInput,
  ): Promise<TelegramProvisioningBridgeSessionSnapshot | null> {
    const entry = await getActiveSession(input.sessionId);
    const session = entry?.session;
    logTelegramProvisioningBridge("complete-start", {
      sessionId: input.sessionId,
      found: !!session,
      tokenLength: input.token.trim().length,
      username: trimNonEmptyString(input.username) ?? null,
      ownerUserId: Number.isInteger(input.ownerUserId) ? input.ownerUserId : null,
    });
    if (!session) return null;
    if (session.state !== "pending") {
      logTelegramProvisioningBridge("complete-noop", {
        sessionId: input.sessionId,
        state: session.state,
      });
      return toSnapshot(session);
    }
    const token = input.token.trim();
    if (!token) {
      throw new ValidationError(
        "Telegram provisioning bridge requires a non-empty token.",
        "telegram_provisioning_bridge",
      );
    }
    const username = trimNonEmptyString(input.username) ?? session.botUsername;
    const completedAtMs = now();
    const completed: TelegramProvisioningBridgeSessionInternal = {
      ...session,
      state: "completed",
      token,
      username,
      ...(Number.isInteger(input.ownerUserId) ? { ownerUserId: input.ownerUserId } : {}),
      completedAtMs,
    };
    await store.setSession(completed);
    logTelegramProvisioningBridge("complete-success", {
      sessionId: input.sessionId,
      botUsername: completed.botUsername,
      username,
      ownerUserId: Number.isInteger(completed.ownerUserId) ? completed.ownerUserId : null,
    });
    return toSnapshot(completed);
  }

  return {
    async registerSession(input) {
      const createdAtMs = parseIsoTimestamp(input.createdAt, now());
      const expiresAtMs = parseIsoTimestamp(input.expiresAt, createdAtMs);
      const session: TelegramProvisioningBridgeSessionInternal = {
        sessionId: input.sessionId,
        claimToken: input.claimToken,
        ...(trimNonEmptyString(input.deviceId) ? { deviceId: trimNonEmptyString(input.deviceId)! } : {}),
        managerBotUsername: input.managerBotUsername,
        botName: input.botName,
        botUsername: input.botUsername,
        createUrl: buildTelegramManagedBotCreateUrl(
          input.managerBotUsername,
          input.botUsername,
          input.botName,
        ),
        createdAtMs,
        expiresAtMs,
        state: "pending",
      };
      if (session.deviceId) {
        const previousEntry = await store.getPendingSessionByDeviceId(session.deviceId);
        const previous = previousEntry?.session;
        if (previous && previous.sessionId !== session.sessionId && previous.state === "pending") {
          await store.deleteSession(previous);
          logTelegramProvisioningBridge("register-supersede-pending", {
            sessionId: session.sessionId,
            deviceId: session.deviceId,
            previousSessionId: previous.sessionId,
          });
        }
      }
      await store.setSession(session);
      logTelegramProvisioningBridge("register", {
        sessionId: session.sessionId,
        deviceId: session.deviceId ?? null,
        managerBotUsername: session.managerBotUsername,
        botUsername: session.botUsername,
      });
      return toSnapshot(session);
    },

    async getSession(sessionId) {
      const session = (await getActiveSession(sessionId))?.session;
      return session ? toSnapshot(session) : null;
    },

    async getStartRedirect(sessionId) {
      const session = (await getActiveSession(sessionId))?.session ?? null;
      logTelegramProvisioningBridge("start-redirect", {
        sessionId,
        found: !!session,
        state: session?.state ?? null,
      });
      return session?.createUrl ?? null;
    },

    async completeSession(input) {
      return await completeBySessionId(input);
    },

    async completeSessionForBotUsername(input) {
      const targetUsername = normalizeTelegramUsername(input.botUsername);
      const entry = await store.getSessionByBotUsername(targetUsername);
      const session = entry?.session;
      logTelegramProvisioningBridge("complete-for-bot-lookup", {
        botUsername: targetUsername,
        found: !!session,
        sessionId: session?.sessionId ?? null,
      });
      if (!session) return null;
      if (session.expiresAtMs <= now()) {
        await store.deleteSession(session);
        logTelegramProvisioningBridge("complete-for-bot-expired", {
          botUsername: targetUsername,
          sessionId: session.sessionId,
        });
        return null;
      }
      return await completeBySessionId({
        sessionId: session.sessionId,
        token: input.token,
        ...(input.username ? { username: input.username } : {}),
        ...(Number.isInteger(input.ownerUserId) ? { ownerUserId: input.ownerUserId } : {}),
      });
    },

    async storeUnclaimedManagedBot(input) {
      const managerBotUsername = trimNonEmptyString(input.managerBotUsername);
      const botUsername = trimNonEmptyString(input.botUsername);
      const token = trimNonEmptyString(input.token);
      if (!managerBotUsername || !botUsername || !token) {
        throw new ValidationError(
          "Telegram provisioning bridge requires managerBotUsername, botUsername, and token to store an unclaimed managed bot.",
          "telegram_provisioning_bridge",
        );
      }
      const unclaimed: TelegramProvisioningBridgeUnclaimedBot = {
        managerBotUsername,
        botUsername,
        token,
        ...(Number.isInteger(input.ownerUserId) ? { ownerUserId: input.ownerUserId } : {}),
        createdAtMs: now(),
        expiresAtMs: now() + UNCLAIMED_MANAGED_BOT_TTL_MS,
      };
      await store.setUnclaimedManagedBot(unclaimed);
      logTelegramProvisioningBridge("unclaimed-store", {
        managerBotUsername,
        botUsername,
        ownerUserId: Number.isInteger(input.ownerUserId) ? input.ownerUserId : null,
        tokenLength: token.length,
      });
    },

    async claimSession(input) {
      let entry = await getActiveSession(input.sessionId);
      let session = entry?.session;
      logTelegramProvisioningBridge("claim-start", {
        sessionId: input.sessionId,
        waitMs: input.waitMs ?? 0,
        found: !!session,
        state: session?.state ?? null,
      });
      if (!session) return { ok: false, reason: "missing" };
      if (session.claimToken !== input.claimToken) {
        logTelegramProvisioningBridge("claim-forbidden", {
          sessionId: input.sessionId,
        });
        return { ok: false, reason: "forbidden" };
      }
      if (session.state === "pending" && (input.waitMs ?? 0) > 0) {
        await store.waitForChange(input.sessionId, entry?.version ?? null, input.waitMs ?? 0);
        entry = await getActiveSession(input.sessionId);
        session = entry?.session;
        logTelegramProvisioningBridge("claim-after-wait", {
          sessionId: input.sessionId,
          found: !!session,
          state: session?.state ?? null,
        });
        if (!session) return { ok: false, reason: "missing" };
      }
      if (session.state === "pending") {
        const adopted = await tryAutoAdoptUnclaimedManagedBot(session);
        if (adopted) {
          entry = await getActiveSession(input.sessionId);
          session = entry?.session;
          logTelegramProvisioningBridge("claim-after-auto-adopt", {
            sessionId: input.sessionId,
            found: !!session,
            state: session?.state ?? null,
          });
          if (!session) return { ok: false, reason: "missing" };
        }
      }
      if (session.state === "pending") {
        logTelegramProvisioningBridge("claim-pending", {
          sessionId: input.sessionId,
        });
        return { ok: false, reason: "pending" };
      }
      if (session.state === "claimed") {
        logTelegramProvisioningBridge("claim-claimed", {
          sessionId: input.sessionId,
        });
        return { ok: false, reason: "claimed" };
      }
      if (session.claimToken !== input.claimToken) {
        logTelegramProvisioningBridge("claim-forbidden-after-wait", {
          sessionId: input.sessionId,
        });
        return { ok: false, reason: "forbidden" };
      }
      const claimed: TelegramProvisioningBridgeSessionInternal = {
        ...session,
        state: "claimed",
      };
      await store.setSession(claimed);
      logTelegramProvisioningBridge("claim-success", {
        sessionId: input.sessionId,
        username: session.username ?? session.botUsername,
        tokenLength: session.token?.length ?? 0,
        ownerUserId: Number.isInteger(session.ownerUserId) ? session.ownerUserId : null,
      });
      return {
        ok: true,
        session: toSnapshot(claimed),
        token: session.token ?? "",
        username: session.username ?? session.botUsername,
        ...(Number.isInteger(session.ownerUserId) ? { ownerUserId: session.ownerUserId } : {}),
      };
    },
  };
}

export const telegramProvisioningBridgeService =
  createTelegramProvisioningBridgeService();

let defaultTelegramProvisioningBridgeServicePromise:
  Promise<TelegramProvisioningBridgeService> | null = null;

export async function getDefaultTelegramProvisioningBridgeService():
  Promise<TelegramProvisioningBridgeService> {
  if (!defaultTelegramProvisioningBridgeServicePromise) {
    defaultTelegramProvisioningBridgeServicePromise = openDefaultTelegramProvisioningBridgeStore()
      .then((store) => createTelegramProvisioningBridgeService({ store }));
  }
  return await defaultTelegramProvisioningBridgeServicePromise;
}

interface TelegramProvisioningBridgeServiceDepsWrapper {
  service?: TelegramProvisioningBridgeService;
}

async function getService(
  deps: TelegramProvisioningBridgeServiceDepsWrapper,
): Promise<TelegramProvisioningBridgeService> {
  return deps.service ?? await getDefaultTelegramProvisioningBridgeService();
}

export async function handleTelegramProvisioningBridgeRegister(
  req: Request,
  deps: TelegramProvisioningBridgeServiceDepsWrapper = {},
): Promise<Response> {
  logTelegramProvisioningBridge("route-register-request", {
    method: req.method,
  });
  const body = await parseJson(req) as Record<string, unknown> | null;
  const sessionId = trimNonEmptyString(body?.sessionId);
  const claimToken = trimNonEmptyString(body?.claimToken);
  const deviceId = trimNonEmptyString(body?.deviceId) ?? undefined;
  const managerBotUsername = trimNonEmptyString(body?.managerBotUsername);
  const botName = trimNonEmptyString(body?.botName);
  const botUsername = trimNonEmptyString(body?.botUsername);
  const expiresAt = trimNonEmptyString(body?.expiresAt);

  if (!sessionId || !claimToken || !managerBotUsername || !botName || !botUsername || !expiresAt) {
    return json({
      error:
        "Body must include sessionId, claimToken, managerBotUsername, botName, botUsername, and expiresAt.",
    }, 400);
  }

  const createdAt = trimNonEmptyString(body?.createdAt) ?? undefined;
  const session = await (await getService(deps)).registerSession({
    sessionId,
    claimToken,
    ...(deviceId ? { deviceId } : {}),
    managerBotUsername,
    botName,
    botUsername,
    expiresAt,
    ...(createdAt ? { createdAt } : {}),
  });
  return json(session, 201);
}

export function handleTelegramProvisioningBridgeStart(
  req: Request,
  deps: TelegramProvisioningBridgeServiceDepsWrapper = {},
): Promise<Response> {
  logTelegramProvisioningBridge("route-start-request", {
    method: req.method,
  });
  const sessionId = new URL(req.url).searchParams.get("session")?.trim() ?? "";
  if (!sessionId) {
    return Promise.resolve(json({ error: "session query parameter is required" }, 400));
  }
  return getService(deps).then(async (service) => {
    const redirectUrl = await service.getStartRedirect(sessionId);
    if (!redirectUrl) {
      return json({ error: "Telegram provisioning session not found" }, 404);
    }
    return Response.redirect(redirectUrl, 302);
  });
}

export async function handleTelegramProvisioningBridgeComplete(
  req: Request,
  deps: TelegramProvisioningBridgeServiceDepsWrapper = {},
): Promise<Response> {
  logTelegramProvisioningBridge("route-complete-request", {
    method: req.method,
    authorized: true,
  });
  const body = await parseJson(req) as Record<string, unknown> | null;
  const sessionId = trimNonEmptyString(body?.sessionId);
  const token = trimNonEmptyString(body?.token);
  const username = trimNonEmptyString(body?.username) ?? undefined;
  const ownerUserId = typeof body?.ownerUserId === "number" && Number.isInteger(body.ownerUserId)
    ? body.ownerUserId
    : undefined;

  if (!sessionId || !token) {
    return json({ error: "Body must include sessionId and token." }, 400);
  }

  try {
    const session = await (await getService(deps)).completeSession({
      sessionId,
      token,
      ...(username ? { username } : {}),
      ...(ownerUserId !== undefined ? { ownerUserId } : {}),
    });
    if (!session) {
      return json({ error: "Telegram provisioning session not found" }, 404);
    }
    return json(session, 200);
  } catch (error) {
    return json(
      { error: error instanceof Error ? error.message : String(error) },
      400,
    );
  }
}

export async function handleTelegramProvisioningBridgeClaim(
  req: Request,
  deps: TelegramProvisioningBridgeServiceDepsWrapper = {},
): Promise<Response> {
  logTelegramProvisioningBridge("route-claim-request", {
    method: req.method,
  });
  const body = await parseJson(req) as Record<string, unknown> | null;
  const sessionId = trimNonEmptyString(body?.sessionId);
  const claimToken = trimNonEmptyString(body?.claimToken);
  const waitMs = typeof body?.waitMs === "number" && Number.isFinite(body.waitMs)
    ? Math.max(0, Math.trunc(body.waitMs))
    : 0;

  if (!sessionId || !claimToken) {
    return json({ error: "Body must include sessionId and claimToken." }, 400);
  }

  const result = await (await getService(deps)).claimSession({
    sessionId,
    claimToken,
    ...(waitMs > 0 ? { waitMs } : {}),
  });
  if (result.ok) {
    return json(result, 200);
  }

  switch (result.reason) {
    case "forbidden":
      return json({ error: "Invalid claim token.", reason: result.reason }, 403);
    case "pending":
      return json(
        { error: "Telegram provisioning session is not completed yet.", reason: result.reason },
        409,
      );
    case "claimed":
      return json(
        { error: "Telegram provisioning session already claimed.", reason: result.reason },
        409,
      );
    case "missing":
    default:
      return json({ error: "Telegram provisioning session not found.", reason: result.reason }, 404);
  }
}
