/**
 * HLVM Chrome Extension — Native Messaging Host (Deno)
 *
 * Architecture copied from Claude Code's chromeNativeHost.ts.
 * Bridges Chrome extension (via native messaging stdin/stdout) to CLI (via Unix socket).
 *
 * This file runs as a standalone Deno binary spawned by Chrome.
 * Raw Deno.* APIs are acceptable here — this is outside HLVM's platform abstraction.
 *
 * ── Protocol ──
 * Chrome NM: 4-byte UInt32LE length prefix + UTF-8 JSON (stdin/stdout)
 * Socket:    4-byte UInt32LE length prefix + UTF-8 JSON (Unix domain socket)
 */

const VERSION = "1.0.0";
const MAX_MESSAGE_SIZE = 1024 * 1024; // 1MB

// ── Logging (stderr only — stdout is protocol) ──────────────────────

function log(message: string, ...args: unknown[]): void {
  const ts = new Date().toISOString();
  const extra = args.length > 0 ? " " + JSON.stringify(args) : "";
  const line = `[${ts}] [HLVM Chrome Native Host] ${message}${extra}\n`;
  const encoder = new TextEncoder();
  Deno.stderr.writeSync(encoder.encode(line));
}

// ── Chrome Native Messaging Protocol (stdin/stdout) ─────────────────

/**
 * Send a message to Chrome via stdout (4-byte LE length prefix + JSON).
 */
function sendChromeMessage(message: string): void {
  const encoder = new TextEncoder();
  const jsonBytes = encoder.encode(message);
  const lengthBuffer = new Uint8Array(4);
  new DataView(lengthBuffer.buffer).setUint32(0, jsonBytes.length, true);
  Deno.stdout.writeSync(lengthBuffer);
  Deno.stdout.writeSync(jsonBytes);
}

/**
 * Read messages from Chrome via stdin (async, buffered).
 * Handles fragmented reads just like CC's ChromeMessageReader.
 */
class ChromeMessageReader {
  private buffer = new Uint8Array(0);
  private decoder = new TextDecoder();

  private appendToBuffer(chunk: Uint8Array): void {
    const next = new Uint8Array(this.buffer.length + chunk.length);
    next.set(this.buffer);
    next.set(chunk, this.buffer.length);
    this.buffer = next;
  }

  async read(): Promise<string | null> {
    // Read until we have a complete message
    while (true) {
      // Check if we have a complete message in buffer
      if (this.buffer.length >= 4) {
        const length = new DataView(
          this.buffer.buffer,
          this.buffer.byteOffset,
        ).getUint32(0, true);

        if (length === 0 || length > MAX_MESSAGE_SIZE) {
          log(`Invalid message length: ${length}`);
          return null;
        }

        if (this.buffer.length >= 4 + length) {
          const messageBytes = this.buffer.slice(4, 4 + length);
          this.buffer = this.buffer.slice(4 + length);
          return this.decoder.decode(messageBytes);
        }
      }

      // Need more data
      const chunk = new Uint8Array(65536);
      const bytesRead = await Deno.stdin.read(chunk);
      if (bytesRead === null) return null; // stdin closed
      this.appendToBuffer(chunk.subarray(0, bytesRead));
    }
  }
}

// ── Helpers ─────────────────────────────────────────────────────────

/** Build a length-prefixed frame for socket transmission. */
function frameMessage(json: string): Uint8Array {
  const encoder = new TextEncoder();
  const payload = encoder.encode(json);
  const frame = new Uint8Array(4 + payload.length);
  new DataView(frame.buffer).setUint32(0, payload.length, true);
  frame.set(payload, 4);
  return frame;
}

// ── Socket Client Management ────────────────────────────────────────

interface SocketClient {
  id: number;
  conn: Deno.Conn;
  buffer: Uint8Array;
}

class NativeHost {
  private clients = new Map<number, SocketClient>();
  /** Maps request ID → client ID for response routing. */
  private pendingRequests = new Map<string, number>();
  private nextClientId = 1;
  private listener: Deno.Listener | null = null;
  private socketPath: string;

  constructor(socketPath: string) {
    this.socketPath = socketPath;
  }

  async start(): Promise<void> {
    // Ensure socket directory exists
    const dir = this.socketPath.substring(
      0,
      this.socketPath.lastIndexOf("/"),
    );
    try {
      await Deno.mkdir(dir, { recursive: true, mode: 0o700 });
    } catch {
      // May already exist
    }

    // Clean up stale socket
    try {
      await Deno.remove(this.socketPath);
    } catch {
      // May not exist
    }

    // Clean up stale PID sockets in directory
    try {
      for await (const entry of Deno.readDir(dir)) {
        if (!entry.name.endsWith(".sock")) continue;
        const pid = parseInt(entry.name.replace(".sock", ""), 10);
        if (isNaN(pid)) continue;
        try {
          Deno.kill(pid, 0); // Signal 0 = check if alive
          // Process alive, leave it
        } catch {
          // Process dead, remove stale socket
          try {
            await Deno.remove(`${dir}/${entry.name}`);
            log(`Removed stale socket for PID ${pid}`);
          } catch {
            // Ignore
          }
        }
      }
    } catch {
      // Ignore dir scan errors
    }

    log(`Creating socket listener: ${this.socketPath}`);

    this.listener = Deno.listen({
      transport: "unix",
      path: this.socketPath,
    });

    // Set socket permissions
    try {
      await Deno.chmod(this.socketPath, 0o600);
      log("Socket permissions set to 0600");
    } catch (e) {
      log("Failed to set socket permissions:", e);
    }

    log("Socket server listening for connections");
    this.acceptClients();
  }

  private async acceptClients(): Promise<void> {
    if (!this.listener) return;
    try {
      for await (const conn of this.listener) {
        this.handleClient(conn);
      }
    } catch {
      // Listener closed
    }
  }

  private handleClient(conn: Deno.Conn): void {
    const clientId = this.nextClientId++;
    const client: SocketClient = {
      id: clientId,
      conn,
      buffer: new Uint8Array(0),
    };

    this.clients.set(clientId, client);
    log(
      `Socket client ${clientId} connected. Total clients: ${this.clients.size}`,
    );

    // Notify Chrome of connection
    sendChromeMessage(JSON.stringify({ type: "mcp_connected" }));

    // Read loop for this client
    this.readClientMessages(client);
  }

  private async readClientMessages(client: SocketClient): Promise<void> {
    const chunk = new Uint8Array(65536);
    try {
      while (true) {
        const bytesRead = await client.conn.read(chunk);
        if (bytesRead === null) break; // Client disconnected

        // Append to buffer
        const next = new Uint8Array(client.buffer.length + bytesRead);
        next.set(client.buffer);
        next.set(chunk.subarray(0, bytesRead), client.buffer.length);
        client.buffer = next;

        // Process complete messages
        while (client.buffer.length >= 4) {
          const length = new DataView(
            client.buffer.buffer,
            client.buffer.byteOffset,
          ).getUint32(0, true);

          if (length === 0 || length > MAX_MESSAGE_SIZE) {
            log(
              `Invalid message length from client ${client.id}: ${length}`,
            );
            client.conn.close();
            return;
          }

          if (client.buffer.length < 4 + length) break; // Wait for more data

          const messageBytes = client.buffer.slice(4, 4 + length);
          client.buffer = client.buffer.slice(4 + length);

          try {
            const request = JSON.parse(
              new TextDecoder().decode(messageBytes),
            );
            log(
              `Forwarding tool request from client ${client.id}: ${request.method}`,
            );

            // Track request→client mapping for response routing
            if (request.id) {
              this.pendingRequests.set(request.id, client.id);
            }

            // Forward to Chrome
            sendChromeMessage(
              JSON.stringify({
                type: "tool_request",
                id: request.id,
                method: request.method,
                params: request.params,
              }),
            );
          } catch (e) {
            log(
              `Failed to parse tool request from client ${client.id}:`,
              e,
            );
          }
        }
      }
    } catch {
      // Connection error
    }

    // Client disconnected
    log(
      `Socket client ${client.id} disconnected. Remaining: ${this.clients.size - 1}`,
    );
    this.clients.delete(client.id);
    sendChromeMessage(JSON.stringify({ type: "mcp_disconnected" }));
  }

  /**
   * Handle a message received from Chrome (via stdin).
   */
  async handleChromeMessage(messageJson: string): Promise<void> {
    let message: { type: string; [key: string]: unknown };
    try {
      message = JSON.parse(messageJson);
    } catch (e) {
      log("Invalid JSON from Chrome:", (e as Error).message);
      sendChromeMessage(
        JSON.stringify({ type: "error", error: "Invalid message format" }),
      );
      return;
    }

    log(`Handling Chrome message type: ${message.type}`);

    switch (message.type) {
      case "ping":
        sendChromeMessage(
          JSON.stringify({ type: "pong", timestamp: Date.now() }),
        );
        break;

      case "get_status":
        sendChromeMessage(
          JSON.stringify({
            type: "status_response",
            native_host_version: VERSION,
          }),
        );
        break;

      case "tool_response": {
        const { type: _, ...data } = message;
        const requestId = data.id as string | undefined;
        const targetClientId = requestId
          ? this.pendingRequests.get(requestId)
          : undefined;

        if (requestId) this.pendingRequests.delete(requestId);

        const responseJson = JSON.stringify(data);
        const frame = frameMessage(responseJson);

        if (targetClientId != null) {
          // Route to the specific client that sent this request
          const client = this.clients.get(targetClientId);
          if (client) {
            try {
              await client.conn.write(frame);
            } catch (e) {
              log(`Failed to send to client ${targetClientId}:`, e);
            }
          }
        } else {
          // No routing info — broadcast (fallback)
          for (const [id, client] of this.clients) {
            try {
              await client.conn.write(frame);
            } catch (e) {
              log(`Failed to send to client ${id}:`, e);
            }
          }
        }
        break;
      }

      case "notification": {
        const { type: _, ...data } = message;
        const notifFrame = frameMessage(JSON.stringify(data));
        for (const [id, client] of this.clients) {
          try {
            await client.conn.write(notifFrame);
          } catch (e) {
            log(`Failed to send notification to client ${id}:`, e);
          }
        }
        break;
      }

      default:
        log(`Unknown message type: ${message.type}`);
        sendChromeMessage(
          JSON.stringify({
            type: "error",
            error: `Unknown message type: ${message.type}`,
          }),
        );
    }
  }

  async stop(): Promise<void> {
    // Close all clients
    for (const [, client] of this.clients) {
      try {
        client.conn.close();
      } catch {
        // Ignore
      }
    }
    this.clients.clear();

    // Close listener
    if (this.listener) {
      this.listener.close();
      this.listener = null;
    }

    // Cleanup socket file
    try {
      await Deno.remove(this.socketPath);
      log("Cleaned up socket file");
    } catch {
      // ENOENT is fine
    }
  }
}

// ── Main ─────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  log("Initializing...");

  const home = Deno.env.get("HOME") || "/tmp";
  const socketDir = `${home}/.hlvm/chrome-bridge`;
  const socketPath = `${socketDir}/${Deno.pid}.sock`;

  const host = new NativeHost(socketPath);
  const reader = new ChromeMessageReader();

  await host.start();

  // Process messages from Chrome until stdin closes
  while (true) {
    const message = await reader.read();
    if (message === null) {
      // stdin closed — Chrome disconnected
      break;
    }
    await host.handleChromeMessage(message);
  }

  await host.stop();
}

main().catch((e) => {
  log("Fatal error:", e);
  Deno.exit(1);
});
