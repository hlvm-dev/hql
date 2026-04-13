import { assertEquals } from "jsr:@std/assert";
import { __testOnlyNavigateAndWaitForChromePageSettle } from "../../../src/hlvm/agent/tools/web/headless-chrome.ts";

class FakeChromeCdp {
  private readonly events = new Map<string, Set<(params: unknown) => void>>();

  on(event: string, handler: (params: unknown) => void): void {
    let handlers = this.events.get(event);
    if (!handlers) {
      handlers = new Set();
      this.events.set(event, handlers);
    }
    handlers.add(handler);
  }

  off(event: string, handler: (params: unknown) => void): void {
    this.events.get(event)?.delete(handler);
  }

  emit(event: string, params?: unknown): void {
    for (const handler of this.events.get(event) ?? []) {
      handler(params);
    }
  }

  listenerCount(event: string): number {
    return this.events.get(event)?.size ?? 0;
  }

  async send<T = unknown>(
    method: string,
    _params?: Record<string, unknown>,
    _sessionId?: string,
  ): Promise<T> {
    if (method === "Page.navigate") {
      this.emit("Page.loadEventFired");
    }
    return {} as T;
  }
}

Deno.test("headless chrome: settle wait attaches listeners before navigate", async () => {
  const cdp = new FakeChromeCdp();

  await __testOnlyNavigateAndWaitForChromePageSettle(
    cdp,
    "session-1",
    "https://example.com",
    100,
    1,
  );

  assertEquals(cdp.listenerCount("Page.loadEventFired"), 0);
  assertEquals(cdp.listenerCount("Page.lifecycleEvent"), 0);
});
