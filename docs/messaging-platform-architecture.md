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
through it. The next vendor is iMessage via the self-message pattern, then Slack
via Socket Mode, then Gmail. All three meet the channel scope rule defined
below.

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
- GUI turn bridge for mobile-originated chat:
  - `src/hlvm/channels/core/gui-turn-bridge.ts`
  - `src/hlvm/cli/repl/handlers/channels/gui-turns.ts`
  - `HLVM/REPL/Presentation/Chat/Controller/ReplChatController.swift`
- ordered channel E2E trace helper in `src/hlvm/channels/core/trace.ts`

So the status is:

```text
shared runtime core: done
shared transport contract: done
shared provisioning contract: done
Telegram as first vendor implementation: done
external channel ownership: default shared runtime only
mobile turn execution: GUI-owned chat path, not backend direct chat
iMessage self-message: backend + GUI picker integration landed; real-device E2E pending
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

## macOS channel-turn execution rule

The GUI owns the visible chat execution path. A vendor turn (Telegram today,
iMessage / Slack / Gmail later) must enter the same Swift flow as a Tab /
Spotlight chat send. The backend channel runtime owns vendor transport,
allowlist, queueing, and reply delivery, but it must not run a separate backend
chat path for mobile messages.

Current rule:

```text
vendor transport receives mobile message
→ channelRuntime.handleInboundMessage()
→ queue.run(sessionId, ...)
→ gui-turn-bridge publishes channel_turn_requested
→ Swift observes /api/channels/turns/stream
→ ReplChatController runs performStartChat(...)
→ Swift posts /api/channels/turns/complete with the final GUI response
→ channelRuntime sends ChannelReply through the originating transport
```

Do not add a vendor-specific `runChatViaHost`, direct agent invocation, or
synthetic "remote message" bubble. The old symptom-level approach of rendering
remote SSE messages into the Siri bubble is explicitly forbidden because it
bypasses the normal `ReplChatController` lifecycle and can diverge from
Tab/Spotlight behavior.

`/api/chat/stream` remains a live transcript/message-store stream. It is not the
execution trigger for mobile channel turns.

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
                      Swift ReplChatController
                      startChat / performStartChat
                                  ▲
                                  │ /api/channels/turns/stream
                                  │ /api/channels/turns/complete
                  ┌───────────────┴────────────────┐
                  │ GUI turn bridge                 │
                  │ core/gui-turn-bridge.ts         │
                  └───────────────▲────────────────┘
                                  │ runQuery dependency
                  ┌───────────────┴────────────────┐
                  │ Channel Runtime (shared)        │
                  │ - per-chat queue                │
                  │ - allowlist                     │
                  │ - pair-code handling            │
                  │ - reachability status           │
                  │ - config writeback + rebind     │
                  └───────▲────────────────▲────────┘
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

Each vendor extends the base session with whatever fields it needs. The iMessage
self-message session extends it with:

- `qrKind = "open_bot"` in v1, reusing the existing GUI "open chat" copy path
- `recipientId` (the user's own iMessage address / Apple ID)

For iMessage self-message:

```text
setupUrl = sms:<url-encoded-recipient-id>
```

Provisioning resolves `recipientId` from the request body, existing channel
config, `HLVM_IMESSAGE_SELF_ID`, then the macOS
`~/Library/Preferences/MobileMeAccounts.plist` Messages service. Normal GUI
onboarding should not require an environment variable.

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
   user messages. After onboarding, the user's Mac talks to the vendor directly.

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

These may return as optional/enterprise channels later, but only after this rule
is amended with explicit cost/ownership justification. Do not add them just
because a gateway product can technically support them. OpenClaw proves broad
multi-channel gateways can work, but that model accepts per-channel setup burden
— plugins, QR logins, developer tokens, external daemons, webhook URLs, paid
bridges. HLVM ships fewer channels with productized onboarding.

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
  free, no HLVM relay. After a one-time pair, the user's self-thread in Messages
  becomes their HLVM conversation — every message in it is a bot turn (no
  prefix, Telegram parity). The Mac watches the local Messages store via
  FSEvents on `chat.db-wal`. See "iMessage self-message contract" below.
- **Slack Socket Mode is planned next after iMessage.** Per-workspace OAuth
  install. Mac connects to Slack via WebSocket directly. HLVM hosts only the
  OAuth callback. Accept workspace admin consent friction; treat Slack as the
  work surface, not a personal-mobile clone.
- **Gmail is planned after Slack.** Per-user OAuth. Mac uses IMAP IDLE + SMTP or
  Gmail API directly. HLVM hosts only the OAuth callback. Email surface,
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
iMessage  → sms:<own-apple-id>
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
  Apple Developer documentation for Shortcuts and AppleScript scripting bridges
  that are sanctioned for local automation of the user's own account.

## iMessage self-message contract

iMessage does not offer a public bot platform. HLVM does not run a central Apple
ID, does not operate a Mac fleet, and does not contract with iMessage
aggregators. Instead, HLVM uses the user's _own_ Mac and _own_ Apple ID. After
provisioning, the user's self-thread becomes their HLVM conversation — every
message in that thread is a bot turn, the same way every message in a Telegram
bot chat is a bot turn.

Product shape:

```text
macOS HLVM
→ POST /api/channels/imessage/provisioning/session
  body: { recipientId } or previously configured channels.imessage.transport.recipientId
→ shared runtime enables channels.imessage locally and stores current chat.db ROWID cursor
→ QR opens Messages.app on the phone addressed to the user's own Apple ID
  with no setup body and no pair code
→ user sends any normal message in that self-thread
→ message syncs through iCloud to the user's Mac
→ local iMessage transport observes chat.db-wal, queries new ROWIDs,
  filters to the bound self-thread, and emits ChannelMessage
→ replies are sent from the same Mac via AppleScript / Apple Events
  back to the user's own Apple ID, appearing on their phone Messages app
```

Trigger model:

```text
After provisioning, every message in the bound self-thread is a bot turn. No
prefix, setup message, pair code, or mode toggle is required — Telegram parity.
The self-thread "Note to Self" semantics are sacrificed: users who relied on it
for genuine notes must move those to Notes.app or Reminders. This is disclosed
during onboarding.

A `triggerPrefix` field exists in `channels.imessage.transport` for advanced
users who want to share the self-thread between bot turns and genuine notes,
but it is empty by default.
```

Loop prevention rule:

```text
The transport binds one self-thread and maintains a short LRU of the body
hashes / visible markers of recent outbound replies. Rows matching those
outbound sends are dropped so HLVM does not answer itself.

Apple IDs can expose multiple iMessage receive aliases (phone number plus
email). Provisioning may use those aliases to discover or re-pair the correct
thread and should prefer a phone-number alias over an email alias when both
exist, because Mac-to-phone self-alias sends render with clearer user/HLVM
separation on iOS; email-to-email self-sends commonly render both sides as blue
"me" bubbles. Once a concrete Messages `chatId` is selected, that `chatId` is
the exclusive inbound scope. Do not let every alias thread act as a live HLVM
room.

Do not rely solely on `is_from_me`. In a self-message thread, iPhone-originated
messages may still appear as "from me" on the Mac because they come from the
same Apple ID. The v1 reader therefore accepts both `is_from_me` states and
drops HLVM-originated replies by outbound LRU plus the visible reply marker.
Do not rely solely on `message.text` for outbound loop detection either; the
feasibility spike showed AppleScript outbound rows with empty `text` and message
content stored outside that column.
```

Reply attribution:

```text
Replies sent via AppleScript / Apple Events appear in the self-thread under
the user's own name (since they are sent from the user's Apple ID to
themselves). Telegram shows replies as "HLVM Bot:"; iMessage cannot. The
transport prepends a small visible marker (default "🤖 ") to outbound replies
so the visual flow stays readable in the self-thread. The marker is
configurable.
```

Inbound delivery model — event-driven, no recurring polling:

```text
The transport watches `~/Library/Messages/chat.db-wal` through a tiny
macOS-native helper using `DispatchSource.makeFileSystemObjectSource` on the
WAL file descriptor. On each WAL change, the runtime runs a cursor-based SQL
query against chat.db (read-only) for new ROWIDs since the last seen position.

Do not assume Deno's `Deno.watchFs` is sufficient. The 2026-04-26 feasibility
spike on macOS 26.0.1 showed Deno 2.7.12 missing Messages WAL changes. Node's
native `fs.watch` and a Swift `DispatchSource` helper both caught WAL writes;
Swift `DispatchSource` is the preferred v1 primitive because it is Apple's
official GCD file-system event API and does not require bundling Node.

There is no periodic safety poll. If FSEvents drops or coalesces events, the
next observed event still queries all ROWIDs since the stored cursor. The
transport may also run one-shot catch-up scans on startup, wake/reconnect,
watcher overflow/drop notifications, watcher restart, WAL rename/delete/reopen,
and after bounded `SQLITE_BUSY` retry. That keeps the design reactive and
compatible with the repo-wide "no recurring polling" rule.
```

chat.db row filters (in addition to bound self-thread + outbound LRU):

```text
- skip rows where `chat_handle_join` count > 1  (group chats, not self-thread)
- skip rows where `associated_message_type != 0`  (tapbacks/reactions)
- skip rows that the current schema marks retracted or edited
  (macOS 26 has `date_retracted` / `date_edited`, not `is_unsent`)
- do not skip rows solely because `message_summary_info` is non-NULL;
  normal macOS 26 self-message text rows can set it
- order by `ROWID`, never by `date` (clock skew between phone and Mac)
- handle SQLITE_BUSY with bounded retry (Messages.app may be writing)
```

Notification noise mitigation:

```text
Every inbound prompt from the phone fires a macOS Notification Center banner
on the Mac, which can cover the HLVM Siri bubble. Apple gives no API to
suppress per-message or per-thread programmatically.

Onboarding completion includes a one-tap step: "Mute the self-thread in
Messages (Hide Alerts) so prompts don't cover the HLVM bubble." This is per-
thread, not global — other Messages threads keep notifying. Trade-off:
genuine note-to-self banner reminders are also suppressed for that thread,
acceptable for ~99% of users.

The HLVM bubble is also repositioned away from the top-right corner where
banners live, as defense in depth.
```

Local prerequisites the transport must verify at start:

- iCloud Messages enabled on the Mac
- Messages.app signed in with the same Apple ID configured as `recipientId`
- Full Disk Access granted to the HLVM process (required to read
  `~/Library/Messages/chat.db`)
- A proven send path. The 2026-04-26 feasibility spike proved AppleScript /
  Apple Events sending through Messages on this machine and found
  `shortcuts list` failing with "Couldn’t communicate with a helper
  application"; do not make Shortcuts the only send path until that helper issue
  is resolved.
- A proven QR open surface. The 2026-04-26 iPhone test proved
  `sms:<url-encoded-apple-id>&body=<url-encoded-text>` opens Messages to the
  target Apple ID with body prefill. V1 intentionally uses the simpler
  recipient-only `sms:<url-encoded-apple-id>` URL because no pair-code body is
  required.
- macOS version is recognized (the transport pins to documented chat.db columns
  and fails closed with a clear error if a column is missing)

Privacy rule:

```text
The iMessage transport has read access to the entire Messages store, but is
only allowed to act on or surface messages from the bound self-thread. It
must not log, index, store, or forward any other conversation. The macOS
onboarding flow must explicitly disclose this access to the user before
requesting Full Disk Access, and the disclosure must precede the FDA prompt.
```

Multi-device note:

```text
Pair-code binds one Mac. If the user has HLVM installed on a second Mac
signed into the same Apple ID, that second Mac sees the inbound messages but
ignores them because its device id is not in the allowlist. Only the paired
Mac replies. The user re-pairs (or pairs the second Mac) to switch.
```

There is no HLVM-hosted bridge, no operator setup checklist, and no per-message
cost. The only deployment burden is shipping the vendor folder under
`src/hlvm/channels/imessage/` and wiring the registry/dispatch entries.

iMessage is shippable on macOS only; the transport is platform-gated and other
HLVM processes (Linux, future Windows) must report it as unavailable rather than
failing to start.

## Non-goals

This architecture does not attempt to invent one fake universal vendor model.

It does not force Telegram, iMessage, Slack, and Gmail into identical setup
payloads. Each has a different transport, different pairing flow, and different
consent surface; flattening that loses useful vendor detail.

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
Telegram account while keeping transcripts isolated. It is a future feature, not
part of the iMessage prep.

## Remaining cleanup only

These are the meaningful architecture-adjacent leftovers now:

1. keep future vendor-specific setup fields inside that vendor folder instead of
   drifting back into shared runtime protocol files

These are cleanup items. They do not change the current Telegram behavior.

## Revision history

| Date       | Change                                                                                                                                                                                                                                                                 |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-04-26 | Rev 18 — LINE removed; channel scope rule (free forever / per-user ceiling / no relay) added; iMessage self-message named as next target; Slack/Gmail roadmap.                                                                                                         |
| 2026-04-26 | Rev 19 — iMessage contract refined: every self-thread message is a bot turn (no prefix, Telegram parity); FSEvents on chat.db-wal replaces polling; Hide Alerts mitigation for notification noise; reply marker for visual attribution; chat.db row filters specified. |
| 2026-04-26 | Rev 20 — iMessage backend v1 landed with recipient-only QR, no setup body/pair code, AppleScript send, Swift WAL watcher source, and local-only config wiring.                                                                                                         |
| 2026-04-26 | Rev 21 — iMessage GUI picker enabled; backend auto-discovers the user's Messages account from macOS account data; compiled HLVM now includes and materializes the Swift WAL watcher helper for GUI builds.                                                             |
| 2026-04-26 | Rev 22 — Mobile channel turns now execute through the GUI turn bridge and Swift `ReplChatController` chat path; direct backend channel chat and synthetic remote-bubble rendering are forbidden.                                                                       |
