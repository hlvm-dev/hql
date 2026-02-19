# MCP Client Conformance Matrix — v2025-11-25

Maps every client-side MUST requirement from the MCP specification to an executable test.

**Scope**: Client-side only. Excludes OAuth/authorization, Tasks (experimental), server-side-only requirements.

**Test counts**: 41 conformance + 8 interop = 49 total

## Legend

- **PASS** — Verified by executable test
- Test paths are relative to `tests/`

---

## Lifecycle

| REQ-ID | Spec Section | MUST Requirement | Test File:Name | Status |
|--------|-------------|------------------|----------------|--------|
| LC-2 | Lifecycle | Client MUST send `initialize` with protocolVersion, clientInfo, capabilities | conformance/mcp/lifecycle.test.ts:init-sends-required-fields | PASS |
| LC-4 | Lifecycle | Client MUST send `notifications/initialized` after receiving init response | conformance/mcp/lifecycle.test.ts:init-sends-initialized | PASS |
| LC-9 | Lifecycle | Client MUST accept server's 2024-11-05 version fallback | conformance/mcp/lifecycle.test.ts:version-accept-2024-11-05 | PASS |
| LC-10 | Lifecycle | Client MUST accept server's 2025-03-26 version fallback | conformance/mcp/lifecycle.test.ts:version-accept-2025-03-26 | PASS |
| LC-12 | Lifecycle | Client SHOULD disconnect on unknown protocol version | conformance/mcp/lifecycle.test.ts:version-reject-unknown | PASS |
| LC-15 | Lifecycle | Client MUST track server capabilities from init response | conformance/mcp/lifecycle.test.ts:capabilities-tracked | PASS |
| LC-CLOSE-1 | Lifecycle | close() MUST NOT send non-spec "shutdown" notification | conformance/mcp/lifecycle.test.ts:close-no-shutdown-msg | PASS |
| LC-CLOSE-2 | Lifecycle | close() MUST reject all pending requests | conformance/mcp/lifecycle.test.ts:close-fails-pending | PASS |
| LC-CLOSE-3 | Lifecycle | close() MUST be idempotent | conformance/mcp/lifecycle.test.ts:close-idempotent | PASS |
| LC-CLOSE-4 | Lifecycle | Requests after close() MUST throw | conformance/mcp/lifecycle.test.ts:closed-rejects-requests | PASS |
| LC-TIMEOUT | Lifecycle | Transport start() MUST time out on hang | conformance/mcp/lifecycle.test.ts:start-timeout | PASS |
| CANCEL-2 | Cancellation | Initialize request ID MUST NOT appear in cancellations | conformance/mcp/lifecycle.test.ts:no-init-cancel | PASS |

## JSON-RPC Base Protocol

| REQ-ID | Spec Section | MUST Requirement | Test File:Name | Status |
|--------|-------------|------------------|----------------|--------|
| BASE-1 | JSON-RPC | All messages MUST have `jsonrpc: "2.0"` | conformance/mcp/jsonrpc.test.ts:messages-have-jsonrpc-2.0 | PASS |
| BASE-3 | JSON-RPC | Request IDs MUST be unique | conformance/mcp/jsonrpc.test.ts:requests-have-unique-id | PASS |
| BASE-5 | JSON-RPC | Request IDs MUST be integers | conformance/mcp/jsonrpc.test.ts:requests-have-unique-id | PASS |
| BASE-11 | JSON-RPC | Notifications MUST NOT have `id` field | conformance/mcp/jsonrpc.test.ts:notifications-have-no-id | PASS |
| BASE-6 | JSON-RPC | Matching response ID MUST resolve correct promise | conformance/mcp/jsonrpc.test.ts:response-resolves-pending | PASS |
| BASE-8 | JSON-RPC | Error response MUST reject with code + message | conformance/mcp/jsonrpc.test.ts:error-response-rejects | PASS |
| BASE-UNK | JSON-RPC | Response with unknown ID MUST NOT crash | conformance/mcp/jsonrpc.test.ts:unknown-id-ignored | PASS |
| BASE-DISPATCH | JSON-RPC | Server request MUST dispatch to registered handler | conformance/mcp/jsonrpc.test.ts:server-request-dispatched | PASS |
| BASE-32601 | JSON-RPC | Unregistered method MUST get -32601 error | conformance/mcp/jsonrpc.test.ts:unhandled-method-gets-32601 | PASS |

## Transport — HTTP (Streamable HTTP)

| REQ-ID | Spec Section | MUST Requirement | Test File:Name | Status |
|--------|-------------|------------------|----------------|--------|
| TR-14 | HTTP Transport | All sends MUST use POST | conformance/mcp/transport-http.test.ts:uses-post | PASS |
| TR-15 | HTTP Transport | Accept header MUST include json + event-stream | conformance/mcp/transport-http.test.ts:accept-header | PASS |
| TR-50a | HTTP Transport | Session ID from response MUST be stored | conformance/mcp/transport-http.test.ts:session-id-stored | PASS |
| TR-50b | HTTP Transport | Session ID MUST be sent in subsequent requests | conformance/mcp/transport-http.test.ts:session-id-sent | PASS |
| TR-57 | HTTP Transport | MCP-Protocol-Version header MUST be included after init | conformance/mcp/transport-http.test.ts:protocol-version-header | PASS |
| TR-20a | HTTP Transport | JSON content-type response MUST be parsed | conformance/mcp/transport-http.test.ts:json-response-parsed | PASS |
| TR-20b | HTTP Transport | SSE content-type response MUST be parsed | conformance/mcp/transport-http.test.ts:sse-response-parsed | PASS |
| TR-20c | HTTP Transport | Multiple SSE events MUST be assembled correctly | conformance/mcp/transport-http.test.ts:sse-multiline-data | PASS |
| TR-55 | HTTP Transport | DELETE with session ID MUST be sent on close | conformance/mcp/transport-http.test.ts:delete-on-close | PASS |
| TR-17 | HTTP Transport | 202 response for notifications MUST be handled | conformance/mcp/transport-http.test.ts:notification-202 | PASS |

## Cancellation

| REQ-ID | Spec Section | MUST Requirement | Test File:Name | Status |
|--------|-------------|------------------|----------------|--------|
| CANCEL-1a | Cancellation | sendCancellation MUST send `notifications/cancelled` | conformance/mcp/cancellation.test.ts:cancel-sends-notification | PASS |
| CANCEL-1b | Cancellation | cancelAllPending MUST cover all in-flight requests | conformance/mcp/cancellation.test.ts:cancel-all-pending | PASS |
| CANCEL-9 | Cancellation | Cancel after response MUST NOT crash | conformance/mcp/cancellation.test.ts:cancel-race | PASS |
| CANCEL-2 | Cancellation | Initialize request MUST NOT be cancelled | conformance/mcp/cancellation.test.ts:no-init-cancel | PASS |
| CANCEL-SIG | Cancellation | AbortSignal MUST trigger cancellation | conformance/mcp/cancellation.test.ts:abort-signal-wiring | PASS |

## Robustness

| REQ-ID | Spec Section | MUST Requirement | Test File:Name | Status |
|--------|-------------|------------------|----------------|--------|
| ROB-NOTIF | Robustness | Notification handler crash MUST NOT kill client | conformance/mcp/robustness.test.ts:notification-handler-crash | PASS |
| ROB-SEND | Robustness | Transport send failure MUST NOT cause unhandled rejection | conformance/mcp/robustness.test.ts:sendError-failure | PASS |
| ROB-PAGE | Pagination | Cursor-based pagination MUST collect all pages | conformance/mcp/robustness.test.ts:pagination-all-pages | PASS |
| ROB-TMPL | Resources | listResourceTemplates MUST use correct method | conformance/mcp/robustness.test.ts:list-resource-templates | PASS |
| ROB-PROG | Notifications | Progress notification MUST be dispatched to handler | conformance/mcp/robustness.test.ts:progress-notification | PASS |
| ROB-SUB | Resources | subscribe/unsubscribe round-trip MUST work | conformance/mcp/robustness.test.ts:subscribe-unsubscribe | PASS |

## Interop — Reference Server (@modelcontextprotocol/server-everything)

| REQ-ID | What It Proves | Test File:Name | Status |
|--------|---------------|----------------|--------|
| INTEROP-INIT | Real server accepts our initialize + initialized | interop/mcp/everything-stdio.test.ts:init-handshake | PASS |
| INTEROP-TOOLS | tools/list returns known tools | interop/mcp/everything-stdio.test.ts:list-tools | PASS |
| INTEROP-ECHO | tools/call echo → correct response | interop/mcp/everything-stdio.test.ts:call-echo | PASS |
| INTEROP-ADD | tools/call get-sum → correct numeric result | interop/mcp/everything-stdio.test.ts:call-add | PASS |
| INTEROP-RES | resources/list returns well-formed data | interop/mcp/everything-stdio.test.ts:list-resources | PASS |
| INTEROP-READ | resources/read returns content | interop/mcp/everything-stdio.test.ts:read-resource | PASS |
| INTEROP-PROMPT | prompts/list returns well-formed data | interop/mcp/everything-stdio.test.ts:list-prompts | PASS |
| INTEROP-PING | ping round-trip succeeds | interop/mcp/everything-stdio.test.ts:ping | PASS |

---

## Summary

| Category | Tests | Passing | Status |
|----------|-------|---------|--------|
| Lifecycle | 12 | 12 | PASS |
| JSON-RPC | 8 | 8 | PASS |
| HTTP Transport | 10 | 10 | PASS |
| Cancellation | 5 | 5 | PASS |
| Robustness | 6 | 6 | PASS |
| Interop | 8 | 8 | PASS |
| **Total** | **49** | **49** | **PASS** |

## Verification Commands

```bash
deno task test:conformance   # 41 conformance tests
deno task test:interop        # 8 interop tests (requires Node.js)
```
