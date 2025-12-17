/**
 * LSP Protocol Integration Test
 *
 * Tests the actual LSP server by simulating what an editor does:
 * sending JSON-RPC messages and verifying responses.
 */

import {
  assertEquals,
  assertExists,
} from "https://deno.land/std@0.208.0/assert/mod.ts";

/**
 * Create an LSP message with Content-Length header
 */
function createLSPMessage(obj: object): Uint8Array {
  const content = JSON.stringify(obj);
  const header = `Content-Length: ${content.length}\r\n\r\n`;
  return new TextEncoder().encode(header + content);
}

/**
 * LSP Client for testing
 */
class LSPTestClient {
  private child: Deno.ChildProcess;
  private writer: WritableStreamDefaultWriter<Uint8Array>;
  private reader: ReadableStreamDefaultReader<Uint8Array>;
  private decoder = new TextDecoder();
  private buffer = "";
  private ready: Promise<void>;

  constructor() {
    const command = new Deno.Command("deno", {
      args: ["run", "--allow-all", "lsp/server.ts"],
      stdin: "piped",
      stdout: "piped",
      stderr: "piped",
    });

    this.child = command.spawn();
    this.writer = this.child.stdin.getWriter();
    this.reader = this.child.stdout.getReader();

    // Wait for server to initialize
    this.ready = new Promise((resolve) => setTimeout(resolve, 500));
  }

  /**
   * Wait for the server to be ready
   */
  async waitReady(): Promise<void> {
    await this.ready;
  }

  /**
   * Send a message to the server
   */
  async send(message: object): Promise<void> {
    await this.writer.write(createLSPMessage(message));
  }

  /**
   * Read next message with timeout
   */
  async readMessage(timeoutMs = 2000): Promise<object | null> {
    const start = Date.now();

    while (Date.now() - start < timeoutMs) {
      // Try to parse from buffer
      const headerEnd = this.buffer.indexOf("\r\n\r\n");
      if (headerEnd !== -1) {
        const header = this.buffer.substring(0, headerEnd);
        const match = header.match(/Content-Length: (\d+)/);
        if (match) {
          const contentLength = parseInt(match[1], 10);
          const contentStart = headerEnd + 4;
          if (this.buffer.length >= contentStart + contentLength) {
            const content = this.buffer.substring(
              contentStart,
              contentStart + contentLength
            );
            this.buffer = this.buffer.substring(contentStart + contentLength);
            return JSON.parse(content);
          }
        }
      }

      // Read more data with short timeout
      const readPromise = this.reader.read();
      const timeoutPromise = new Promise<null>((resolve) =>
        setTimeout(() => resolve(null), 100)
      );

      const result = await Promise.race([readPromise, timeoutPromise]);
      if (result && result.value) {
        this.buffer += this.decoder.decode(result.value);
      }
    }
    return null;
  }

  /**
   * Wait for a response with specific id
   */
  async waitForResponse(id: number, timeoutMs = 5000): Promise<object | null> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const msg = await this.readMessage(500);
      if (!msg) continue;
      if ((msg as Record<string, unknown>).id === id) return msg;
      // Skip notifications
    }
    return null;
  }

  /**
   * Drain all pending messages
   */
  async drainMessages(timeoutMs = 500): Promise<object[]> {
    const messages: object[] = [];
    let msg;
    while ((msg = await this.readMessage(timeoutMs))) {
      messages.push(msg);
    }
    return messages;
  }

  /**
   * Kill the server
   */
  kill(): void {
    try {
      this.child.kill();
    } catch {
      // Ignore if already dead
    }
  }
}

Deno.test({
  name: "LSP Protocol - Server starts and responds to initialize",
  async fn() {
    const client = new LSPTestClient();
    await client.waitReady();

    try {
      // Send initialize request
      await client.send({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          processId: Deno.pid,
          capabilities: {},
          rootUri: null,
        },
      });

      const response = await client.waitForResponse(1);

      // Verify response
      assertExists(response, "Should receive initialize response");
      assertEquals((response as Record<string, unknown>).jsonrpc, "2.0");
      assertEquals((response as Record<string, unknown>).id, 1);
      assertExists(
        (response as Record<string, unknown>).result,
        "Should have result"
      );

      const result = (response as Record<string, { capabilities: unknown }>)
        .result;
      assertExists(result.capabilities, "Should have capabilities");

      const caps = result.capabilities as Record<string, unknown>;
      assertExists(caps.hoverProvider, "Should support hover");
      assertExists(caps.completionProvider, "Should support completion");
      assertExists(caps.definitionProvider, "Should support definition");

      console.log("✅ LSP Initialize test passed!");
    } finally {
      client.kill();
    }
  },
  sanitizeResources: false,
  sanitizeOps: false,
});

Deno.test({
  name: "LSP Protocol - Full conversation (init, open, completion, hover)",
  async fn() {
    const client = new LSPTestClient();
    await client.waitReady();

    try {
      // 1. Initialize
      await client.send({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { processId: Deno.pid, capabilities: {}, rootUri: null },
      });

      const initResponse = await client.waitForResponse(1);
      assertExists(initResponse, "Should get initialize response");
      assertEquals((initResponse as Record<string, unknown>).id, 1);
      console.log("✅ Initialize OK");

      // 2. Initialized notification
      await client.send({
        jsonrpc: "2.0",
        method: "initialized",
        params: {},
      });
      console.log("✅ Initialized notification sent");

      // 3. Open document
      await client.send({
        jsonrpc: "2.0",
        method: "textDocument/didOpen",
        params: {
          textDocument: {
            uri: "file:///test.hql",
            languageId: "hql",
            version: 1,
            text: "(let x 42)\n(fn add [a b] (+ a b))\n",
          },
        },
      });

      // Wait for analysis (debounce 200ms + processing time)
      await new Promise((r) => setTimeout(r, 1000));
      console.log("✅ Document opened");

      // 4. Request completion
      await client.send({
        jsonrpc: "2.0",
        id: 2,
        method: "textDocument/completion",
        params: {
          textDocument: { uri: "file:///test.hql" },
          position: { line: 2, character: 1 },
        },
      });

      const completionResponse = await client.waitForResponse(2);
      assertExists(completionResponse, "Should get completion response");
      assertEquals((completionResponse as Record<string, unknown>).id, 2);

      const items = (completionResponse as Record<string, unknown>)
        .result as Array<Record<string, string>>;
      assertExists(items, "Should have completion items");
      assertEquals(Array.isArray(items), true);
      assertEquals(items.length > 0, true, "Should have completions");

      // Check that user-defined symbols are included
      const labels = items.map((i) => i.label);
      assertEquals(
        labels.includes("x") || labels.includes("add"),
        true,
        "Should include user-defined symbols"
      );
      console.log(`✅ Completion OK (${items.length} items)`);

      // 5. Request hover
      await client.send({
        jsonrpc: "2.0",
        id: 3,
        method: "textDocument/hover",
        params: {
          textDocument: { uri: "file:///test.hql" },
          position: { line: 1, character: 6 }, // Over "add"
        },
      });

      const hoverResponse = await client.waitForResponse(3);
      assertExists(hoverResponse, "Should get hover response");
      assertEquals((hoverResponse as Record<string, unknown>).id, 3);
      console.log("✅ Hover OK");

      console.log("\n🎉 All LSP protocol tests passed!");
    } finally {
      client.kill();
    }
  },
  sanitizeResources: false,
  sanitizeOps: false,
});
