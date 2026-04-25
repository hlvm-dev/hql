# Messaging Platform Architecture

This is the binary-side architecture SSOT for messaging platforms in HLVM.

It answers one question:

```text
How do we support Telegram and LINE now, then add Slack / Discord / KakaoTalk / WhatsApp later
without rewriting the messaging runtime each time?
```

**Last updated**: 2026-04-26

## Current conclusion

Do not rewrite the messaging core.

The existing shared runtime is already the right foundation:

- `src/hlvm/channels/core/runtime.ts`
- `src/hlvm/channels/core/queue.ts`
- `src/hlvm/channels/core/session-key.ts`
- `src/hlvm/channels/core/types.ts`
- `src/hlvm/channels/registry.ts`

The missing seam was provisioning/setup, not transport execution.

That seam is now implemented in the codebase. LINE is the first non-Telegram
implementation using that seam. The remaining work is deployment/configuration
and product hardening, not another runtime redesign.

## Core rule

Keep exactly two extension points per messaging vendor:

1. `ChannelTransport`
2. `ChannelProvisioner`

Everything else stays shared.

## Current implementation status

The architecture below is not just a target anymore. The current repo already
has the core seam in place:

- shared transport contract in `src/hlvm/channels/core/types.ts`
- shared provisioner contract in `src/hlvm/channels/core/types.ts`
- shared runtime in `src/hlvm/channels/core/runtime.ts`
- Telegram setup session types in `src/hlvm/channels/telegram/protocol.ts`
- generic channel provisioning route handlers in
  `src/hlvm/cli/repl/handlers/channels/provisioning.ts`
- generic `:channel` provisioning routes in `src/hlvm/cli/repl/http-server.ts`
- Telegram transport stale-reset dependency injection through:
  - `src/hlvm/channels/telegram/provisioning-reset.ts`
  - `src/hlvm/channels/registry.ts`
- LINE setup session types in `src/hlvm/channels/line/protocol.ts`
- LINE provisioner in `src/hlvm/channels/line/provisioning.ts`
- LINE relay transport in `src/hlvm/channels/line/transport.ts`
- LINE bridge server/client/service in `src/hlvm/channels/line/`
- ordered channel E2E trace helper in `src/hlvm/channels/core/trace.ts`

So the status is:

```text
shared runtime core: done
shared transport contract: done
shared provisioning contract: done
Telegram as first vendor implementation: done
LINE source implementation: done
LINE live E2E: requires configured LINE Official Account + deployed bridge
external channel ownership: default shared runtime only
Slack implementation: not started yet
```

## Runtime ownership rule

External messaging transports are owned by the default shared HLVM runtime only:

```text
127.0.0.1:11435
→ may start Telegram / LINE / future external channel transports
```

Explicit isolated runtimes must not own external messaging transports:

```text
hlvm serve --port <non-default>
→ local HTTP/testing surface only
→ must not poll Telegram
→ must not attach LINE event streams
→ must not steal mobile updates from the shared GUI runtime
```

This prevents split-brain behavior where a dev/test process consumes Telegram or
LINE updates while the macOS GUI is connected to the normal runtime. Multiple
GUI windows should behave as clients of the same shared runtime, not as
independent owners of the same mobile channel.

Do not use `--port` as an agent identity, chat identity, or bot identity. Future
multi-agent chat support needs endpoint records inside the shared runtime, not
one runtime process per bot.

## macOS app integration

The binary-side provisioning architecture is only half of the real onboarding
flow. The macOS app must also treat onboarding windows as session-scoped UI, not
as reusable shells around stale state.

Current rule:

```text
new onboarding window
→ start a fresh provisioning flow

window close / dismiss
→ cancel the active provisioning flow
```

Do not reuse an old in-memory "waiting for Telegram" state across later window
presentations. That can show a stale QR while no live local provisioning session
exists.

This app-side rule now lives in:

- `HLVM/Messages/Onboarding/OnboardingWindow.swift`

## macOS realtime sync rule

The GUI is a thin client of the runtime transcript. A Telegram or LINE turn can
arrive when the user is not actively typing in the macOS chat surface, so remote
SSE events must still update the visible message store.

Current rule:

```text
runtime receives Telegram / LINE message
→ runtime appends user + assistant messages to the active conversation
→ runtime mirrors live user + assistant events to the GUI live transcript stream
→ macOS hydrates only the current live presentation from that stream
```

Do not guard remote `snapshot`, `messageAdded`, or `messageUpdated` handling on
a local "chat active" flag. That flag is only safe for local UI run-state, not
for deciding whether runtime-owned messages exist.

The GUI live transcript is not durable chat history. A fresh GUI connection gets
an empty `snapshot`; durable messages remain available through
`/api/chat/messages` for memory/context/history features but must not be
auto-rendered into the Siri-style bubble.

## Telegram completion behavior

Telegram bot branding is applied only after setup completes locally.

Current rule:

```text
createSession
→ returns setup session quickly

completeSession
→ writes config
→ reconfigures runtime
→ applies Telegram branding asynchronously, best-effort
```

That means:

- no local completion
  - no reply path
  - no branding update
- branding failure must not break an otherwise successful bot setup

The macOS onboarding window must also treat each presentation as a fresh local
session:

```text
open onboarding window
→ create or resume a live local provisioning session

close onboarding window
→ cancel that active local flow
```

Do not reuse stale in-memory "waiting for Telegram" state across later manual
reopens.

## System map

```text
                       ┌──────────────────────┐
                       │      HLVM Brain      │
                       │ memory · tools · AI  │
                       └──────────▲───────────┘
                                  │
                            runQuery(...)
                                  │
                  ┌───────────────┴────────────────┐
                  │ Channel Runtime (shared)       │
                  │                                │
                  │ - per-chat queue               │
                  │ - allowlist                    │
                  │ - pair-code handling           │
                  │ - reachability status          │
                  │ - config writeback + rebind    │
                  └───────▲────────────────▲───────┘
                          │                │
                          │                │
               ChannelTransport     ChannelProvisioner
                  (shared)             (shared)
                          │                │
          ┌───────────────┘                └───────────────┐
          │                                                │
          ▼                                                ▼
telegram/transport.ts                            telegram/provisioning.ts
line/transport.ts                                line/provisioning.ts
slack/transport.ts                               slack/provisioning.ts
discord/transport.ts                             discord/provisioning.ts
...                                              ...
```

## Shared contracts

### `ChannelTransport`

Transport owns vendor messaging I/O only:

- receive vendor events / polls / webhooks
- normalize inbound messages
- send replies
- stop cleanly
- optionally match a pair-code message

It does not own provisioning-bridge policy or remote setup lifecycle.

### `ChannelProvisioner`

Provisioner owns setup lifecycle only:

- create setup session
- get current setup session
- complete setup session
- cancel setup session

It does not own message execution.

### `ChannelSetupSession`

The shared base setup session is intentionally small:

```text
channel
sessionId
state
setupUrl
createdAt
expiresAt
completedAt?
```

Platform-specific session fields stay in the platform folder.

Example:

- Telegram extends the base session with:
  - `pairCode`
  - `botName`
  - `botUsername`
  - `managerBotUsername`
  - `qrKind`
  - `createUrl`
  - `provisionUrl`

The public Telegram setup session no longer exposes a duplicate `qrUrl`. Use:

```text
setupUrl   = generic URL field from the shared base type
createUrl  = Telegram-specific create/open link
```

LINE extends the base session with:

- `pairCode`
- `qrKind = "connect_account"`
- `officialAccountId`

For LINE:

```text
setupUrl = https://line.me/R/oaMessage/<official-account-id>/?HLVM-<pair-code>
```

## HTTP boundary

Canonical provisioning routes are channel-generic:

```text
POST /api/channels/:channel/provisioning/session
GET  /api/channels/:channel/provisioning/session
POST /api/channels/:channel/provisioning/session/complete
POST /api/channels/:channel/provisioning/session/cancel
```

Dispatch is intentionally tiny:

```text
channel string
→ matching per-channel provisioning handler
```

This is a small lookup, not a second runtime subsystem.

Current repo nuance:

- the generic `:channel` routes are implemented
- the old Telegram-specific compatibility aliases have been removed

## Platform protocol rule

Shared runtime protocol files must stay platform-neutral.

That means:

- generic reachability types stay in `src/hlvm/runtime/reachability-protocol.ts`
- platform setup payloads and setup session types live under the platform folder

Example:

- Telegram provisioning protocol types live in:
  - `src/hlvm/channels/telegram/protocol.ts`
- shared reachability types remain in:
  - `src/hlvm/runtime/reachability-protocol.ts`

## Telegram-specific rule

Telegram-specific details stay inside `src/hlvm/channels/telegram/`:

- Bot API polling
- managed-bot create flow
- Deno Deploy bridge
- manager webhook
- edited-username recovery
- bot identity fields

Those details must not leak upward into the shared runtime contracts.

## Boundary violations to avoid

Do not repeat these mistakes:

### 1. Transport reaching into provisioning bridge internals

Wrong:

```text
telegram/transport.ts
→ reads provisioning bridge env vars
→ constructs bridge client directly
→ resets remote provisioning state itself
```

Correct:

```text
transport gets a narrow injected reset callback
```

### 2. Shared runtime protocol carrying Telegram setup fields

Wrong:

```text
runtime/reachability-protocol.ts
→ RuntimeTelegramProvisioning*
```

Correct:

```text
shared protocol = shared only
telegram setup types = telegram/protocol.ts
```

### 3. Hardcoded Telegram provisioning routes

Wrong:

```text
/api/channels/telegram/provisioning/...
```

Correct:

```text
/api/channels/:channel/provisioning/...
```

Current code status:

```text
generic route shape exists and is the canonical design
Telegram-specific compatibility aliases are gone
```

## Adding the next platform

After this architecture, adding a new platform should mostly mean:

```text
src/hlvm/channels/slack/transport.ts
src/hlvm/channels/slack/provisioning.ts
src/hlvm/channels/slack/protocol.ts
```

Then wire:

```text
registry transport entry
provisioning dispatch entry
```

Current priority guidance:

- **LINE is implemented in source** because it best matches the mobile-first QR
  product shape.
- **Slack follows LINE validation** because its official API is strong, but
  onboarding is workspace OAuth / admin oriented rather than personal-chat
  oriented.
- **WhatsApp** remains the biggest reach target, but not the next easiest
  implementation.
- **Email** is possible later, but it is an async channel, not the next chat
  adapter.
- **KakaoTalk** remains possible but difficult; its official surface is more
  channel / business oriented and less Telegram-like.

Official API reality as of 2026-04-25:

```text
LINE:
  feasible: yes
  implemented shape: QR opens HLVM LINE Official Account with prefilled pair text
  transport: webhook events from LINE Platform to an HTTPS bot server
  blocker: no Telegram-style "create user-owned bot from QR" flow
  implication: use an HLVM-managed LINE Official Account + bridge

Slack:
  feasible: yes
  best UX: QR opens Slack OAuth install / authorization
  transport: Events API over HTTPS for broad distribution
  alternate: Socket Mode for dev/private installs only
  blocker: workspace install/admin consent and OAuth token storage
  implication: Slack is a workplace channel, not a personal-mobile clone
```

Primary official references:

- LINE Messaging API overview:
  `https://developers.line.biz/en/docs/messaging-api/overview/`
- LINE bot setup and webhook URL requirements:
  `https://developers.line.biz/en/docs/messaging-api/building-bot/`
- LINE add-friend QR/link surfaces:
  `https://developers.line.biz/en/docs/messaging-api/sharing-bot/`
- Slack OAuth install:
  `https://docs.slack.dev/authentication/installing-with-oauth`
- Slack Events API: `https://docs.slack.dev/apis/events-api/`
- Slack Socket Mode: `https://docs.slack.dev/apis/events-api/using-socket-mode`
- Slack `chat.postMessage`:
  `https://docs.slack.dev/reference/methods/chat.postMessage`

The product bar for any new messaging channel is mobile QR-first:

```text
scan with phone
→ approve / add / open in the native mobile app
→ then chat
```

The UI should stay consistent:

```text
Connect <Platform>
→ show QR
→ wait for <Platform>
→ connected
```

The macOS QR window should become channel-generic:

```text
┌────────────────────────────────────────────┐
│ Scan with <Platform>                       │
│                                            │
│                   QR                       │
│                                            │
│ scan to open your HLVM <platform surface>  │
│                                            │
│ Telegram | LINE | Slack | ...              │
└────────────────────────────────────────────┘
```

Platform selection should update the same window in place. The goal is fewer
screens and fewer steps to the first mobile "hello world" message reaching HLVM,
not a separate onboarding wizard for each vendor.

The QR payload is platform-specific and belongs behind `ChannelProvisioner`:

```text
Telegram → Telegram create/open bot URL
LINE     → LINE add-friend / Official Account URL
Slack    → Slack OAuth install URL
Discord  → Discord OAuth/install URL
Gmail    → Google OAuth URL
WhatsApp → WhatsApp link/session flow, only if that route is accepted
```

Do not add a channel only because a gateway product can technically support it.
OpenClaw proves that a broad multi-channel gateway can work, but that model
accepts per-channel setup burden such as plugins, QR login, developer tokens,
external daemons, webhook URLs, and bridge services. HLVM should ship fewer
channels with productized onboarding.

The following should not need redesign:

- queue
- allowlist
- reachability runtime
- session-key format
- host chat execution path
- provisioning route shape

## LINE implementation contract

LINE is not Telegram Option B. LINE does not create a user-owned bot from the
QR. The implemented product shape is:

```text
macOS HLVM
→ POST /api/channels/line/provisioning/session
→ LINE bridge registers a pending session
→ QR opens LINE Official Account chat with prefilled HLVM-#### text
→ user sends that text in LINE
→ LINE webhook reaches bridge
→ bridge binds LINE user id to local device id
→ local LINE relay transport receives the event over SSE
→ shared channel runtime pairs allowlist and runs HLVM
→ replies go through bridge push-message API
```

Local runtime requirements:

```text
HLVM_LINE_PROVISIONING_BRIDGE_URL
HLVM_LINE_OFFICIAL_ACCOUNT_ID      optional local override
```

LINE live E2E is blocked until the service-side bridge/account setup exists.
This is a one-time developer/operator setup, not a user-facing onboarding step.
Production user flow must still stay:

```text
select LINE
→ scan QR
→ LINE opens on phone
→ send the prefilled pair text
→ HLVM is connected
```

Operator setup checklist:

```text
1. Create a LINE Official Account / Messaging API channel for HLVM testing.
   Use the free/unverified path when possible; do not require a business
   verification flow for local development.
2. Deploy the HLVM LINE bridge on HTTPS.
3. Configure the LINE Developer Console webhook URL:
   https://<bridge-host>/api/line/webhook
4. Set bridge secrets:
   HLVM_LINE_OFFICIAL_ACCOUNT_ID
   HLVM_LINE_CHANNEL_ACCESS_TOKEN
   HLVM_LINE_CHANNEL_SECRET
5. Set or bake the local runtime bridge target:
   HLVM_LINE_PROVISIONING_BRIDGE_URL=https://<bridge-host>
   HLVM_LINE_OFFICIAL_ACCOUNT_ID=<official-account-id>
6. Rebuild/relaunch the GUI and test through the generic QR window.
```

Bridge requirements:

```text
HLVM_LINE_OFFICIAL_ACCOUNT_ID
HLVM_LINE_CHANNEL_ACCESS_TOKEN
HLVM_LINE_CHANNEL_SECRET
```

Bridge endpoints:

```text
GET  /health
POST /api/line/provisioning/session
GET  /api/line/events?deviceId=...&clientToken=...
POST /api/line/message/push
POST /api/line/webhook
```

The LINE Developer Console webhook URL must point at:

```text
https://<bridge-host>/api/line/webhook
```

The bridge verifies `x-line-signature` using the raw request body and the LINE
channel secret. The local transport does not poll LINE; it listens to the bridge
event stream for events produced by LINE webhooks.

The bridge queues events per local device before delivering them over SSE. It
uses LINE `webhookEventId` as the event id when available, so webhook redelivery
does not create duplicate HLVM turns. The local transport also keeps a bounded
recent-event id cache to avoid duplicate processing after bridge redelivery or
stream replay.

LINE diagnostics are intentionally file-backed for real-device E2E debugging:

```text
/tmp/hlvm-line-e2e.jsonl
```

This file is written through the shared JSONL/platform FS helper, not ad-hoc
`Deno.*` calls. Records include `seq`, timestamp, process id, scope, event, and
safe metadata. They must not include access tokens, channel secrets,
authorization headers, signatures, or message text. Message payloads are logged
as lengths only.

The macOS app already mirrors DEBUG logs through its existing `HlvmLogger` file
sink:

```text
/tmp/hlvm-gui-debug.log
```

During LINE E2E, inspect both files plus the bridge platform logs. The useful
sequence should look like:

```text
http-provisioning create
provisioning create-session-start
bridge-client register-session-start
bridge session-register
provisioning reconfigure-done
bridge event-stream-open
bridge webhook-ingest
bridge pair-message-delivered
bridge event-stream-send
transport event-received
transport pair-code-match
transport send-start
bridge send-message-done
transport send-done
```

LINE backend coverage lives in:

```text
tests/unit/channels/line-provisioning.test.ts
tests/unit/channels/line-provisioning-bridge-service.test.ts
tests/unit/channels/line.test.ts
tests/unit/repl/channels-provisioning-handler.test.ts
```

These tests intentionally exercise the shared seams: `ChannelProvisioner`,
generic `/api/channels/:channel/provisioning/...` dispatch, bridge registration,
LINE webhook ingestion, queued SSE delivery, `ChannelTransport` normalization,
pair-code matching, duplicate event dropping, and reply send. Do not add a
parallel LINE-only route or direct runtime bypass to make a test easier.

## Non-goals

This architecture does not attempt to invent one fake universal vendor model.

It does not force Slack, Discord, Telegram, and KakaoTalk into identical setup
payloads.

Instead:

- shared base contract stays small
- vendor-specific fields stay local

That keeps the design extensible without flattening away useful vendor detail.

## Final shape

```text
shared:
- ChannelTransport
- ChannelProvisioner
- ChannelSetupSession
- channel runtime
- generic provisioning routes

per-vendor:
- transport implementation
- provisioner implementation
- setup session extension types
- vendor bridge / oauth / webhook logic
```

If a future vendor needs a genuinely new primitive, add that primitive once to
the shared contract. Do not fork the runtime.

## Future multi-endpoint direction

Current Telegram support is intentionally a single endpoint: one configured bot
token, one owner, one allowlist, one cursor, and one status. That is enough for
the current product.

The future "scan QR multiple times to create multiple independent Telegram
agents" feature must introduce first-class endpoint records. Do not bolt extra
fields onto the current singleton and do not start one runtime process per bot.

Target model:

```text
platform = telegram
endpointId = tg_ep_abc123
agentId = agent_build_buddy
remoteId = Telegram chat/user id

session key = channel:telegram:<endpointId>:<remoteId>
```

Each endpoint owns its own:

- token
- username
- cursor
- status
- allowlist
- provisioning/reconnect state
- agent/persona binding

Runtime shape:

```text
shared runtime on 11435
→ endpoint tg_ep_1 polls Telegram token A
→ endpoint tg_ep_2 polls Telegram token B
→ inbound message includes platform + endpointId + remoteId
→ queue/session key includes endpointId
→ reply is sent through the same endpoint transport
```

This is the correct way to support many Telegram bots / agents from one iOS
Telegram account while keeping transcripts isolated. It is a future feature, not
part of the current LINE prep.

## Remaining cleanup only

These are the meaningful architecture-adjacent leftovers now:

1. keep future vendor-specific setup fields inside that vendor folder instead of
   drifting back into shared runtime protocol files

These are cleanup items. They do not change the current Telegram behavior.
