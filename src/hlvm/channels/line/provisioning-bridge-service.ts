import type { PlatformKv, PlatformKvKey } from "../../../platform/types.ts";
import { getPlatform } from "../../../platform/platform.ts";
import { RuntimeError, ValidationError } from "../../../common/error.ts";
import { http } from "../../../common/http-client.ts";
import { jsonError } from "../../cli/repl/http-utils.ts";
import { traceChannelDiagnostic } from "../core/trace.ts";
import { buildLineOfficialAccountMessageUrl } from "./protocol.ts";
import type {
  LineBridgeMessageEvent,
  LineBridgeSendMessageRequest,
  LineBridgeSendMessageResult,
  LineProvisioningBridgeRegistration,
  LineProvisioningBridgeSessionSnapshot,
} from "./provisioning-bridge-protocol.ts";

const LINE_API_BASE_URL = "https://api.line.me";
const LINE_REQUEST_TIMEOUT_MS = 30_000;
const EVENT_STREAM_RETRY_MS = 2_000;
const SESSION_TTL_FALLBACK_MS = 10 * 60 * 1000;

interface LineBridgeSessionInternal {
  sessionId: string;
  deviceId: string;
  clientToken: string;
  pairCode: string;
  officialAccountId: string;
  state: "pending" | "completed";
  createdAtMs: number;
  expiresAtMs: number;
  completedAtMs?: number;
}

interface LineBridgeOwnerBinding {
  userId: string;
  deviceId: string;
}

interface LineBridgeDeviceAuth {
  deviceId: string;
  clientToken: string;
}

interface LineBridgeStoreEntry<T> {
  value: T | null;
  version: string | null;
}

interface LineBridgeQueuedEvent {
  cursor: string;
  event: LineBridgeMessageEvent;
}

interface LineBridgeStore {
  getSession(sessionId: string): Promise<LineBridgeSessionInternal | null>;
  getSessionByPairCode(
    pairCode: string,
  ): Promise<LineBridgeSessionInternal | null>;
  setSession(session: LineBridgeSessionInternal): Promise<void>;
  getOwnerBinding(userId: string): Promise<LineBridgeOwnerBinding | null>;
  setOwnerBinding(binding: LineBridgeOwnerBinding): Promise<void>;
  getDeviceAuth(deviceId: string): Promise<LineBridgeDeviceAuth | null>;
  setDeviceAuth(auth: LineBridgeDeviceAuth): Promise<void>;
  getDeviceEvents(
    deviceId: string,
    afterCursor: string | null,
  ): Promise<LineBridgeStoreEntry<LineBridgeQueuedEvent[]>>;
  setDeviceEvent(
    deviceId: string,
    event: LineBridgeMessageEvent,
  ): Promise<void>;
  deleteDeviceEventsThrough(deviceId: string, cursor: string): Promise<void>;
  waitForDeviceEvent(
    deviceId: string,
    version: string | null,
    signal: AbortSignal,
  ): Promise<void>;
}

interface LineBridgeServiceDeps {
  store?: LineBridgeStore;
  officialAccountId?: string;
  channelAccessToken?: string;
  now?: () => number;
  randomId?: () => string;
  fetchRaw?: typeof http.fetchRaw;
}

export interface LineProvisioningBridgeService {
  registerSession(
    input: LineProvisioningBridgeRegistration,
  ): Promise<LineProvisioningBridgeSessionSnapshot>;
  createEventStream(input: {
    deviceId: string;
    clientToken: string;
    signal: AbortSignal;
  }): Promise<Response>;
  sendMessage(
    input: LineBridgeSendMessageRequest,
  ): Promise<LineBridgeSendMessageResult>;
  ingestWebhook(
    payload: unknown,
  ): Promise<{ accepted: number; delivered: number }>;
}

function sessionKey(sessionId: string): PlatformKvKey {
  return ["line", "session", sessionId];
}

function pairCodeKey(pairCode: string): PlatformKvKey {
  return ["line", "pair", pairCode];
}

function ownerKey(userId: string): PlatformKvKey {
  return ["line", "owner", userId];
}

function deviceAuthKey(deviceId: string): PlatformKvKey {
  return ["line", "device-auth", deviceId];
}

function deviceEventPrefix(deviceId: string): PlatformKvKey {
  return ["line", "device-event", deviceId];
}

function deviceEventKey(deviceId: string, cursor: string): PlatformKvKey {
  return [...deviceEventPrefix(deviceId), cursor];
}

function deviceEventSignalKey(deviceId: string): PlatformKvKey {
  return ["line", "device-event-signal", deviceId];
}

function lineLog(event: string, data: Record<string, unknown>): void {
  traceChannelDiagnostic("line", "bridge", event, data);
}

function trimString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function parseDateMs(value: string, fallbackMs: number): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : fallbackMs;
}

function normalizePairCode(value: string): string {
  return value.trim().replace(/^HLVM-/i, "");
}

function extractPairCode(text: string): string | null {
  const match = /^\s*HLVM-([A-Za-z0-9-]+)\b/i.exec(text);
  return match?.[1] ? normalizePairCode(match[1]) : null;
}

function toSnapshot(
  session: LineBridgeSessionInternal,
): LineProvisioningBridgeSessionSnapshot {
  const pairText = `HLVM-${session.pairCode}`;
  return {
    sessionId: session.sessionId,
    state: session.state,
    pairCode: session.pairCode,
    officialAccountId: session.officialAccountId,
    setupUrl: buildLineOfficialAccountMessageUrl(
      session.officialAccountId,
      pairText,
    ),
    createdAt: new Date(session.createdAtMs).toISOString(),
    expiresAt: new Date(session.expiresAtMs).toISOString(),
    ...(session.completedAtMs !== undefined
      ? { completedAt: new Date(session.completedAtMs).toISOString() }
      : {}),
  };
}

function eventCursor(event: LineBridgeMessageEvent): string {
  return `${String(event.timestamp).padStart(16, "0")}:${event.id}`;
}

function createMemoryLineBridgeStore(): LineBridgeStore {
  const sessions = new Map<string, LineBridgeSessionInternal>();
  const pairCodes = new Map<string, string>();
  const ownerBindings = new Map<string, LineBridgeOwnerBinding>();
  const deviceAuth = new Map<string, LineBridgeDeviceAuth>();
  const deviceEvents = new Map<string, LineBridgeQueuedEvent[]>();
  const deviceEventVersions = new Map<string, string>();
  const waiters = new Map<string, Set<() => void>>();
  let versionCounter = 0;

  function notify(deviceId: string): void {
    const callbacks = waiters.get(deviceId);
    if (!callbacks) return;
    waiters.delete(deviceId);
    for (const callback of callbacks) callback();
  }

  return {
    async getSession(sessionId) {
      return sessions.get(sessionId) ?? null;
    },
    async getSessionByPairCode(pairCode) {
      const sessionId = pairCodes.get(pairCode);
      return sessionId ? sessions.get(sessionId) ?? null : null;
    },
    async setSession(session) {
      sessions.set(session.sessionId, session);
      if (session.state === "pending") {
        pairCodes.set(session.pairCode, session.sessionId);
      } else {
        pairCodes.delete(session.pairCode);
      }
    },
    async getOwnerBinding(userId) {
      return ownerBindings.get(userId) ?? null;
    },
    async setOwnerBinding(binding) {
      ownerBindings.set(binding.userId, binding);
    },
    async getDeviceAuth(deviceId) {
      return deviceAuth.get(deviceId) ?? null;
    },
    async setDeviceAuth(auth) {
      deviceAuth.set(auth.deviceId, auth);
    },
    async getDeviceEvents(deviceId, afterCursor) {
      const events = deviceEvents.get(deviceId) ?? [];
      const filtered = afterCursor
        ? events.filter((entry) => entry.cursor > afterCursor)
        : events;
      return {
        value: [...filtered].sort((left, right) =>
          left.cursor.localeCompare(right.cursor)
        ),
        version: deviceEventVersions.get(deviceId) ?? null,
      };
    },
    async setDeviceEvent(deviceId, event) {
      const cursor = eventCursor(event);
      const events = deviceEvents.get(deviceId) ?? [];
      const withoutDuplicate = events.filter((entry) =>
        entry.cursor !== cursor
      );
      withoutDuplicate.push({ cursor, event });
      withoutDuplicate.sort((left, right) =>
        left.cursor.localeCompare(right.cursor)
      );
      const version = String(++versionCounter);
      deviceEvents.set(deviceId, withoutDuplicate);
      deviceEventVersions.set(deviceId, version);
      notify(deviceId);
    },
    async deleteDeviceEventsThrough(deviceId, cursor) {
      const events = deviceEvents.get(deviceId) ?? [];
      deviceEvents.set(
        deviceId,
        events.filter((entry) => entry.cursor > cursor),
      );
    },
    async waitForDeviceEvent(deviceId, version, signal) {
      const current = deviceEventVersions.get(deviceId) ?? null;
      if (current !== version) return;
      await new Promise<void>((resolve) => {
        if (signal.aborted) {
          resolve();
          return;
        }
        const callbacks = waiters.get(deviceId) ?? new Set<() => void>();
        const finish = () => {
          signal.removeEventListener("abort", finish);
          callbacks.delete(finish);
          resolve();
        };
        callbacks.add(finish);
        waiters.set(deviceId, callbacks);
        signal.addEventListener("abort", finish, { once: true });
      });
    },
  };
}

export function createKvLineBridgeStore(kv: PlatformKv): LineBridgeStore {
  return {
    async getSession(sessionId) {
      const entry = await kv.get<LineBridgeSessionInternal>(
        sessionKey(sessionId),
      );
      return entry.value ?? null;
    },
    async getSessionByPairCode(pairCode) {
      const entry = await kv.get<string>(pairCodeKey(pairCode));
      if (typeof entry.value !== "string") return null;
      const sessionEntry = await kv.get<LineBridgeSessionInternal>(
        sessionKey(entry.value),
      );
      return sessionEntry.value ?? null;
    },
    async setSession(session) {
      const op = kv.atomic()
        .set(sessionKey(session.sessionId), session);
      if (session.state === "pending") {
        op.set(pairCodeKey(session.pairCode), session.sessionId);
      } else {
        op.delete(pairCodeKey(session.pairCode));
      }
      await op.commit();
    },
    async getOwnerBinding(userId) {
      const entry = await kv.get<LineBridgeOwnerBinding>(ownerKey(userId));
      return entry.value ?? null;
    },
    async setOwnerBinding(binding) {
      await kv.set(ownerKey(binding.userId), binding);
    },
    async getDeviceAuth(deviceId) {
      const entry = await kv.get<LineBridgeDeviceAuth>(deviceAuthKey(deviceId));
      return entry.value ?? null;
    },
    async setDeviceAuth(auth) {
      await kv.set(deviceAuthKey(auth.deviceId), auth);
    },
    async getDeviceEvents(deviceId, afterCursor) {
      const events: LineBridgeQueuedEvent[] = [];
      for await (
        const entry of kv.list<LineBridgeQueuedEvent>({
          prefix: deviceEventPrefix(deviceId),
        })
      ) {
        if (!afterCursor || entry.value.cursor > afterCursor) {
          events.push(entry.value);
        }
      }
      events.sort((left, right) => left.cursor.localeCompare(right.cursor));
      const signal = await kv.get<{ updatedAt: number }>(
        deviceEventSignalKey(deviceId),
      );
      return { value: events, version: signal.versionstamp ?? null };
    },
    async setDeviceEvent(deviceId, event) {
      const cursor = eventCursor(event);
      await kv.atomic()
        .set(deviceEventKey(deviceId, cursor), { cursor, event })
        .set(deviceEventSignalKey(deviceId), { updatedAt: Date.now() })
        .commit();
    },
    async deleteDeviceEventsThrough(deviceId, cursor) {
      const op = kv.atomic();
      for await (
        const entry of kv.list<LineBridgeQueuedEvent>({
          prefix: deviceEventPrefix(deviceId),
        })
      ) {
        if (entry.value.cursor <= cursor) {
          op.delete(deviceEventKey(deviceId, entry.value.cursor));
        }
      }
      await op.commit();
    },
    async waitForDeviceEvent(deviceId, version, signal) {
      while (!signal.aborted) {
        const entry = await kv.get<{ updatedAt: number }>(
          deviceEventSignalKey(deviceId),
        );
        if ((entry.versionstamp ?? null) !== version) return;
        await kv.waitForChange(deviceEventSignalKey(deviceId), signal);
      }
    },
  };
}

async function openDefaultLineBridgeStore(): Promise<LineBridgeStore> {
  const kv = await getPlatform().openKv?.().catch(() => undefined);
  return kv ? createKvLineBridgeStore(kv) : createMemoryLineBridgeStore();
}

function extractWebhookTextEvents(payload: unknown): Array<{
  eventId?: string;
  userId: string;
  text: string;
  timestamp: number;
  raw: unknown;
}> {
  if (!payload || typeof payload !== "object") return [];
  const events = (payload as { events?: unknown }).events;
  if (!Array.isArray(events)) return [];

  const result: Array<
    { userId: string; text: string; timestamp: number; raw: unknown }
  > = [];
  for (const event of events) {
    if (!event || typeof event !== "object") continue;
    const record = event as {
      type?: unknown;
      webhookEventId?: unknown;
      timestamp?: unknown;
      source?: { userId?: unknown };
      message?: { type?: unknown; text?: unknown };
    };
    if (record.type !== "message") continue;
    if (record.message?.type !== "text") continue;
    const userId = trimString(record.source?.userId);
    const text = trimString(record.message?.text);
    if (!userId || !text) continue;
    const eventId = trimString(record.webhookEventId);
    result.push({
      ...(eventId ? { eventId } : {}),
      userId,
      text,
      timestamp: typeof record.timestamp === "number"
        ? record.timestamp
        : Date.now(),
      raw: event,
    });
  }
  return result;
}

async function sendLinePushMessage(
  channelAccessToken: string,
  to: string,
  text: string,
  fetchRaw: typeof http.fetchRaw,
): Promise<void> {
  const response = await fetchRaw(`${LINE_API_BASE_URL}/v2/bot/message/push`, {
    method: "POST",
    timeout: LINE_REQUEST_TIMEOUT_MS,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${channelAccessToken}`,
    },
    body: JSON.stringify({
      to,
      messages: [{ type: "text", text }],
    }),
  });
  if (!response.ok) {
    let detail = `${response.status} ${response.statusText}`;
    try {
      const body = await response.json() as { message?: string };
      if (body.message) detail = body.message;
    } catch {
      // Keep HTTP status detail.
    }
    throw new RuntimeError(`LINE push message failed: ${detail}`);
  }
  await response.body?.cancel();
}

async function requireAuthorizedDevice(
  store: LineBridgeStore,
  deviceId: string,
  clientToken: string,
): Promise<void> {
  const auth = await store.getDeviceAuth(deviceId);
  if (!auth || auth.clientToken !== clientToken) {
    throw new ValidationError(
      "Unauthorized LINE bridge device.",
      "line_bridge",
    );
  }
}

function formatSse(event: LineBridgeMessageEvent): string {
  return `id: ${event.id}\nevent: line_message\ndata: ${
    JSON.stringify(event)
  }\n\n`;
}

export function createLineProvisioningBridgeService(
  deps: LineBridgeServiceDeps = {},
): LineProvisioningBridgeService {
  const storePromise = deps.store
    ? Promise.resolve(deps.store)
    : openDefaultLineBridgeStore();
  const now = deps.now ?? Date.now;
  const randomId = deps.randomId ?? (() => crypto.randomUUID());
  const fetchRaw = deps.fetchRaw ??
    ((url, options) => http.fetchRaw(url, options));
  const officialAccountId = trimString(deps.officialAccountId);
  const channelAccessToken = trimString(deps.channelAccessToken);

  async function getStore(): Promise<LineBridgeStore> {
    return await storePromise;
  }

  async function deliverToDevice(
    deviceId: string,
    eventId: string | undefined,
    userId: string,
    text: string,
    timestamp: number,
    raw: unknown,
  ): Promise<void> {
    const store = await getStore();
    const event: LineBridgeMessageEvent = {
      id: eventId || randomId(),
      type: "message",
      userId,
      text,
      timestamp,
      raw,
    };
    await store.setDeviceEvent(deviceId, event);
    lineLog("event-queued", {
      deviceId,
      eventId: event.id,
      userId,
      textLength: text.length,
    });
  }

  return {
    async registerSession(input) {
      const sessionId = trimString(input.sessionId);
      const deviceId = trimString(input.deviceId);
      const clientToken = trimString(input.clientToken);
      const pairCode = normalizePairCode(trimString(input.pairCode));
      const lineId = trimString(input.officialAccountId) || officialAccountId;
      if (!sessionId || !deviceId || !clientToken || !pairCode || !lineId) {
        throw new ValidationError(
          "LINE bridge registration requires sessionId, deviceId, clientToken, pairCode, and officialAccountId.",
          "line_bridge",
        );
      }

      const createdAtMs = parseDateMs(input.createdAt, now());
      const expiresAtMs = parseDateMs(
        input.expiresAt,
        createdAtMs + SESSION_TTL_FALLBACK_MS,
      );
      const session: LineBridgeSessionInternal = {
        sessionId,
        deviceId,
        clientToken,
        pairCode,
        officialAccountId: lineId,
        state: "pending",
        createdAtMs,
        expiresAtMs,
      };
      const store = await getStore();
      await store.setDeviceAuth({ deviceId, clientToken });
      await store.setSession(session);
      const snapshot = toSnapshot(session);
      lineLog("session-register", {
        sessionId,
        deviceId,
        officialAccountId: lineId,
      });
      return snapshot;
    },

    async createEventStream(input) {
      const deviceId = trimString(input.deviceId);
      const clientToken = trimString(input.clientToken);
      if (!deviceId || !clientToken) {
        lineLog("event-stream-rejected", { reason: "missing-auth" });
        return jsonError("deviceId and clientToken are required.", 400);
      }
      const store = await getStore();
      try {
        await requireAuthorizedDevice(store, deviceId, clientToken);
      } catch {
        lineLog("event-stream-rejected", { deviceId, reason: "unauthorized" });
        return jsonError("Unauthorized LINE bridge device.", 401);
      }
      lineLog("event-stream-open", { deviceId });

      const encoder = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          let closed = false;
          const close = () => {
            if (closed) return;
            closed = true;
            lineLog("event-stream-close", { deviceId });
            try {
              controller.close();
            } catch {
              // Stream already closed by the client.
            }
          };
          input.signal.addEventListener("abort", close, { once: true });
          void (async () => {
            let cursor: string | null = null;
            let version: string | null = null;
            try {
              while (!input.signal.aborted) {
                const entry = await store.getDeviceEvents(deviceId, cursor);
                if (entry.value && entry.value.length > 0) {
                  for (const queued of entry.value) {
                    controller.enqueue(encoder.encode(formatSse(queued.event)));
                    lineLog("event-stream-send", {
                      deviceId,
                      eventId: queued.event.id,
                      cursor: queued.cursor,
                      userId: queued.event.userId,
                    });
                    cursor = queued.cursor;
                  }
                  await store.deleteDeviceEventsThrough(deviceId, cursor!);
                }
                version = entry.version;
                await store.waitForDeviceEvent(deviceId, version, input.signal);
              }
            } catch (error) {
              const detail = error instanceof Error
                ? error.message
                : String(error);
              lineLog("event-stream-error", { deviceId, detail });
            } finally {
              input.signal.removeEventListener("abort", close);
              close();
            }
          })();
        },
      });

      return new Response(stream, {
        status: 200,
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
          "Retry-After": String(EVENT_STREAM_RETRY_MS),
        },
      });
    },

    async sendMessage(input) {
      const deviceId = trimString(input.deviceId);
      const clientToken = trimString(input.clientToken);
      const to = trimString(input.to);
      const text = trimString(input.text);
      if (!deviceId || !clientToken || !to || !text) {
        throw new ValidationError(
          "LINE bridge send requires deviceId, clientToken, to, and text.",
          "line_bridge",
        );
      }
      if (!channelAccessToken) {
        lineLog("send-message-rejected", {
          deviceId,
          to,
          reason: "missing-access-token",
        });
        throw new ValidationError(
          "HLVM_LINE_CHANNEL_ACCESS_TOKEN is required to send LINE messages.",
          "line_bridge",
        );
      }
      await requireAuthorizedDevice(await getStore(), deviceId, clientToken);
      lineLog("send-message-start", { deviceId, to, textLength: text.length });
      await sendLinePushMessage(channelAccessToken, to, text, fetchRaw);
      lineLog("send-message-done", { deviceId, to });
      return { ok: true };
    },

    async ingestWebhook(payload) {
      const events = extractWebhookTextEvents(payload);
      const store = await getStore();
      let delivered = 0;
      lineLog("webhook-ingest", { accepted: events.length });
      for (const event of events) {
        const pairCode = extractPairCode(event.text);
        if (pairCode) {
          const session = await store.getSessionByPairCode(pairCode);
          if (
            session && session.state === "pending" &&
            session.expiresAtMs > now()
          ) {
            const completed: LineBridgeSessionInternal = {
              ...session,
              state: "completed",
              completedAtMs: now(),
            };
            await store.setSession(completed);
            await store.setOwnerBinding({
              userId: event.userId,
              deviceId: session.deviceId,
            });
            await deliverToDevice(
              session.deviceId,
              event.eventId,
              event.userId,
              event.text,
              event.timestamp,
              event.raw,
            );
            lineLog("pair-message-delivered", {
              sessionId: session.sessionId,
              deviceId: session.deviceId,
              userId: event.userId,
            });
            delivered += 1;
            continue;
          }
          lineLog("pair-message-not-bound", {
            userId: event.userId,
            hasPairCode: true,
          });
        }

        const binding = await store.getOwnerBinding(event.userId);
        if (!binding) {
          lineLog("webhook-unbound-user", {
            userId: event.userId,
            hasPairCode: !!pairCode,
          });
          continue;
        }
        await deliverToDevice(
          binding.deviceId,
          event.eventId,
          event.userId,
          event.text,
          event.timestamp,
          event.raw,
        );
        delivered += 1;
      }
      lineLog("webhook-ingest-done", { accepted: events.length, delivered });
      return { accepted: events.length, delivered };
    },
  };
}

let defaultLineBridgeServicePromise:
  | Promise<LineProvisioningBridgeService>
  | null = null;

export async function getDefaultLineProvisioningBridgeService(
  deps: Omit<LineBridgeServiceDeps, "store"> = {},
): Promise<LineProvisioningBridgeService> {
  if (!defaultLineBridgeServicePromise) {
    defaultLineBridgeServicePromise = Promise.resolve(
      createLineProvisioningBridgeService(deps),
    );
  }
  return await defaultLineBridgeServicePromise;
}

interface LineBridgeServiceWrapper {
  service?: LineProvisioningBridgeService;
  officialAccountId?: string;
  channelAccessToken?: string;
}

async function getService(
  deps: LineBridgeServiceWrapper,
): Promise<LineProvisioningBridgeService> {
  return deps.service ??
    await getDefaultLineProvisioningBridgeService({
      officialAccountId: deps.officialAccountId,
      channelAccessToken: deps.channelAccessToken,
    });
}

async function parseJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return null;
  }
}

export async function handleLineProvisioningBridgeRegister(
  req: Request,
  deps: LineBridgeServiceWrapper = {},
): Promise<Response> {
  const service = await getService(deps);
  try {
    const result = await service.registerSession(
      await parseJson(req) as LineProvisioningBridgeRegistration,
    );
    return Response.json(result, { status: 201 });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return jsonError(detail, 400);
  }
}

export async function handleLineBridgeEvents(
  req: Request,
  deps: LineBridgeServiceWrapper = {},
): Promise<Response> {
  const url = new URL(req.url);
  return await (await getService(deps)).createEventStream({
    deviceId: url.searchParams.get("deviceId") ?? "",
    clientToken: url.searchParams.get("clientToken") ?? "",
    signal: req.signal,
  });
}

export async function handleLineBridgeSendMessage(
  req: Request,
  deps: LineBridgeServiceWrapper = {},
): Promise<Response> {
  const service = await getService(deps);
  try {
    const result = await service.sendMessage(
      await parseJson(req) as LineBridgeSendMessageRequest,
    );
    return Response.json(result, { status: 200 });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return jsonError(detail, 400);
  }
}

export async function handleLineBridgeWebhook(
  payload: unknown,
  deps: LineBridgeServiceWrapper = {},
): Promise<Response> {
  const service = await getService(deps);
  const result = await service.ingestWebhook(payload);
  return Response.json(result, { status: 200 });
}
