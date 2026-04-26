# Messaging Platform Architecture

This is the binary-side architecture SSOT for messaging platforms in HLVM.

It answers one question:

```text
How do we support Telegram now, add iMessage / Slack / Gmail next, and stay
free forever without rewriting the messaging runtime each time?
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

The missing seam was provisioning/setup, not transport execution. That seam is
now implemented in the codebase, with Telegram as the first vendor running
through it. The next vendor is iMessage via the self-message pattern, then
Slack via Socket Mode, then Gmail. All three meet the channel scope rule
defined below.

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
- ordered channel E2E trace helper in `src/hlvm/channels/core/trace.ts`

So the status is:

```text
shared runtime core: done
shared transport contract: done
shared provisioning contract: done
Telegram as first vendor implementation: done
external channel ownership: default shared runtime only
iMessage self-message: next target, not started
Slack Socket Mode: planned after iMessage
Gmail: planned after Slack
```

## Runtime ownership rule

External messaging transports are owned by the default shared HLVM runtime only:

```text
127.0.0.1:11435
→ may start Telegram and any future external channel transport
```

Explicit isolated runtimes must not own external messaging transports:

```text
hlvm serve --port <non-default>
→ local HTTP/testing surface only
→ must not poll vendor APIs
→ must not attach vendor event streams
→ must not steal mobile updates from the shared GUI runtime
```

This prevents split-brain behavior where a dev/test process consumes vendor
updates while the macOS GUI is connected to the normal runtime. Multiple GUI
windows should behave as clients of the same shared runtime, not as independent
owners of the same mobile channel.

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

The GUI is a thin client of the runtime transcript. A vendor turn (Telegram
today, iMessage / Slack / Gmail later) can arrive when the user is not actively
typing in the macOS chat surface, so remote SSE events must still update the
visible message store.

Current rule:

```text
runtime receives vendor message
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
imessage/transport.ts                            imessage/provisioning.ts
slack/transport.ts                               slack/provisioning.ts
gmail/transport.ts                               gmail/provisioning.ts
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

A future vendor extends the base session with whatever pairing fields it needs.
For example, the planned iMessage self-message session is expected to extend
the base session with:

- `pairCode`
- `qrKind = "self_message"`
- `selfMessagePrompt` (the prefilled body the user sends to themselves)

For iMessage self-message:

```text
setupUrl = imessage:?body=<url-encoded-prefilled-pair-text>
```

Slack and Gmail use OAuth install URLs instead. Each vendor is free to define
its own setup-session extension; the shared base contract stays small.

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

## Channel scope rule

A vendor is only added when it meets all three:

1. **Free forever at any user count.** No per-message platform billing. No
   monthly quota that grows with users. The vendor's free tier must scale with
   the user base, not against it.
2. **Per-user ceiling, not aggregate.** Rate limits, tokens, or quotas live at
   the per-user surface (bot token, OAuth token, workspace install, local
   device). HLVM does not own one shared ceiling that all users compete for.
3. **HLVM is never on the data path at runtime.** HLVM may host a one-time
   provisioning callback (OAuth redirect, pair-code echo) but must not relay
   user messages. After onboarding, the user's Mac talks to the vendor
   directly.

Vendors that meet all three: Telegram, iMessage self-message pattern, Slack
Socket Mode, Gmail.

Vendors that fail one or more, and are explicitly out of scope for the default
roadmap:

```text
WhatsApp           — Meta charges per conversation; central app required.
Facebook Messenger — Same Meta per-conversation pricing model.
LINE (with push)   — Push messages count toward a paid quota at scale.
KakaoTalk          — Channel/business pricing, central account required.
WeChat             — Central account + China entity/ICP registration.
iMessage cloud-Mac — Cloud Mac fleet + Apple ID sharding; central + ToS risk.
Discord            — One HLVM-owned bot routes all DMs; aggregate ceiling.
```

These may return as optional/enterprise channels later, but only after this
rule is amended with explicit cost/ownership justification. Do not add them
just because a gateway product can technically support them. OpenClaw proves
broad multi-channel gateways can work, but that model accepts per-channel
setup burden — plugins, QR logins, developer tokens, external daemons, webhook
URLs, paid bridges. HLVM ships fewer channels with productized onboarding.

## Roadmap

After this architecture, adding a new platform should mostly mean:

```text
src/hlvm/channels/<vendor>/transport.ts
src/hlvm/channels/<vendor>/provisioning.ts
src/hlvm/channels/<vendor>/protocol.ts
```

Then wire:

```text
registry transport entry
provisioning dispatch entry
```

Current priority guidance:

- **Telegram is shipping.** User-owned bot tokens, Mac long-polls directly. No
  HLVM relay. Free forever.
- **iMessage self-message is the next target.** Apple ecosystem, decentralized,
  free, no HLVM relay. The user sends a prefixed message to themselves; the
  Mac watches the local Messages store and treats those messages as bot turns.
  See "iMessage self-message contract" below.
- **Slack Socket Mode is planned next after iMessage.** Per-workspace OAuth
  install. Mac connects to Slack via WebSocket directly. HLVM hosts only the
  OAuth callback. Accept workspace admin consent friction; treat Slack as the
  work surface, not a personal-mobile clone.
- **Gmail is planned after Slack.** Per-user OAuth. Mac uses IMAP IDLE + SMTP
  or Gmail API directly. HLVM hosts only the OAuth callback. Email surface,
  different rhythm than chat, complementary not duplicate.

The product bar for any new messaging channel is mobile QR-first:

```text
scan with phone
→ approve / add / open in the native mobile app
→ then chat
```

The UI stays consistent across vendors:

```text
Connect <Platform>
→ show QR
→ wait for <Platform>
→ connected
```

The macOS QR window is channel-generic:

```text
┌────────────────────────────────────────────┐
│ Scan with <Platform>                       │
│                                            │
│                   QR                       │
│                                            │
│ scan to open your HLVM <platform surface>  │
│                                            │
│ Telegram | iMessage | Slack | Gmail | ...  │
└────────────────────────────────────────────┘
```

Platform selection updates the same window in place. The goal is fewer screens
and fewer steps to the first mobile "hello world" message reaching HLVM, not a
separate onboarding wizard for each vendor.

The QR payload is platform-specific and belongs behind `ChannelProvisioner`:

```text
Telegram  → Telegram create/open bot URL (BotFather or pre-prepared bot)
iMessage  → imessage:?body=<prefilled pair text> to the user's own Apple ID
Slack     → Slack OAuth install URL with state=<pair-code>
Gmail     → Google OAuth URL with state=<pair-code>
```

The following should not need redesign:

- queue
- allowlist
- reachability runtime
- session-key format
- host chat execution path
- provisioning route shape

Primary official references:

- Telegram Bot API: `https://core.telegram.org/bots/api`
- Slack OAuth install:
  `https://docs.slack.dev/authentication/installing-with-oauth`
- Slack Socket Mode: `https://docs.slack.dev/apis/events-api/using-socket-mode`
- Slack `chat.postMessage`:
  `https://docs.slack.dev/reference/methods/chat.postMessage`
- Gmail API overview: `https://developers.google.com/gmail/api`
- Google OAuth 2.0: `https://developers.google.com/identity/protocols/oauth2`
- Apple Messages on Mac (chat database, AppleScript) — no public bot API; see
  Apple Developer documentation for Shortcuts and AppleScript scripting
  bridges that are sanctioned for local automation of the user's own account.

## iMessage self-message contract

iMessage does not offer a public bot platform. HLVM does not run a central
Apple ID, does not operate a Mac fleet, and does not contract with iMessage
aggregators. Instead, HLVM uses the user's *own* Mac and *own* Apple ID to
treat self-addressed messages as bot turns.

Product shape:

```text
macOS HLVM
→ POST /api/channels/imessage/provisioning/session
→ shared runtime arms a pair-code listener on the local Messages store
→ QR opens Messages.app on the phone with prefilled "@hlvm HLVM-#### hello"
  text addressed to the user's own Apple ID
→ user taps send on phone
→ message syncs through iCloud to the user's Mac
→ local iMessage transport observes chat.db, matches the pair code,
  binds the local device to that Apple ID
→ subsequent self-addressed messages prefixed with @hlvm flow through the
  shared channel runtime
→ replies are sent from the same Mac via Shortcuts / AppleScript back to the
  user's own Apple ID, appearing on their phone Messages app
```

Trigger disambiguation rule:

```text
The transport must NOT treat every self-message as a bot turn. Users do use
note-to-self for genuine notes. A configurable prefix (default "@hlvm")
distinguishes bot turns from personal notes. Self-messages without the prefix
are ignored.
```

Loop prevention rule:

```text
Mac-originated self-messages (is_from_me = 1, originating from this device)
must be filtered out of the inbound stream. Only inbound self-messages
originating from another of the user's devices (e.g. the iPhone) are eligible
to become bot turns.
```

Local prerequisites the transport must verify at start:

- iCloud Messages enabled on the Mac
- Messages.app signed in with the same Apple ID expected by the pair code
- Full Disk Access granted to the HLVM process (required to read
  `~/Library/Messages/chat.db`)
- A reasonable macOS version (transport must version-check chat.db schema and
  Shortcuts/AppleScript send paths; failures should surface a clear error,
  not a silent drop)

Privacy rule:

```text
The iMessage transport has read access to the entire Messages store, but is
only allowed to act on or surface self-addressed messages matching the
configured prefix. It must not log, index, store, or forward any other
conversation. The macOS onboarding flow must explicitly disclose this access
to the user before requesting Full Disk Access.
```

There is no HLVM-hosted bridge, no operator setup checklist, and no per-message
cost. The only deployment burden is shipping the vendor folder under
`src/hlvm/channels/imessage/` and wiring the registry/dispatch entries.

iMessage is shippable on macOS only; the transport is platform-gated and other
HLVM processes (Linux, future Windows) must report it as unavailable rather
than failing to start.

## Non-goals

This architecture does not attempt to invent one fake universal vendor model.

It does not force Telegram, iMessage, Slack, and Gmail into identical setup
payloads. Each has a different transport, different pairing flow, and
different consent surface; flattening that loses useful vendor detail.

Instead:

- shared base contract stays small
- vendor-specific fields stay local

That keeps the design extensible without forcing fake uniformity.

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
Telegram account while keeping transcripts isolated. It is a future feature,
not part of the iMessage prep.

## Remaining cleanup only

These are the meaningful architecture-adjacent leftovers now:

1. keep future vendor-specific setup fields inside that vendor folder instead
   of drifting back into shared runtime protocol files

These are cleanup items. They do not change the current Telegram behavior.

## Revision history

| Date       | Change                                                                                                                                                          |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-04-26 | Rev 18 — LINE removed; channel scope rule (free forever / per-user ceiling / no relay) added; iMessage self-message named as next target; Slack/Gmail roadmap. |
