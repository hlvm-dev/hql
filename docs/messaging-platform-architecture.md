# Messaging Platform Architecture

This is the binary-side SSOT for HLVM messaging platforms.

**Last updated**: 2026-04-27

## Current Decision

Telegram is the only production messaging platform.

The shared channel foundation remains valid:

- `src/hlvm/channels/core/types.ts`
- `src/hlvm/channels/core/runtime.ts`
- `src/hlvm/channels/core/queue.ts`
- `src/hlvm/channels/core/session-key.ts`
- `src/hlvm/channels/core/gui-turn-bridge.ts`
- `src/hlvm/channels/registry.ts`

What changed: failed non-Telegram experiments are removed from live code and
GUI. iMessage, LINE, Gmail, and Slack are research notes only until a future
platform passes the production gate below.

## Production Map

```text
Mobile Telegram
    │
    ▼
Telegram Bot API
    │
    ▼
telegram/transport.ts
    │ ChannelMessage
    ▼
core/runtime.ts
    │ allowlist + session key + queue
    ▼
core/gui-turn-bridge.ts
    │ /api/channels/turns/stream
    ▼
Swift GUI chat path
    │ same path as Tab / Spotlight send
    ▼
HLVM brain
    │ ChannelReply
    ▼
telegram/transport.ts
    │
    ▼
Telegram Bot API
```

No vendor transport may call the agent directly. Mobile turns must enter the
same GUI-owned chat execution path as local UI turns.

## Runtime Ownership

Only the shared GUI runtime owns external messaging:

```text
127.0.0.1:11435
→ may start Telegram
```

Isolated runtimes are local test/HTTP surfaces only:

```text
hlvm serve --port <non-default>
→ must not poll vendor APIs
→ must not attach vendor event streams
→ must not consume mobile updates
```

This prevents split-brain behavior where a dev process steals Telegram updates
from the GUI runtime.

## Extension Contracts

The two contracts stay in place because they are correct and low ceremony:

```text
ChannelTransport
  start(context)
  send(reply)
  stop()
  matchesPairCode?()

ChannelProvisioner
  createSession(input?)
  getSession()
  completeSession(input)
  cancelSession()
```

Telegram implements both. Future vendors must implement both only after passing
the production gate.

## Production Gate

A platform is not implemented or shown in the GUI unless all checks pass:

```text
official API
  AND no private local database / reverse-engineered client / AppleScript bot
  AND no HLVM-operated message relay at runtime
  AND no shared aggregate quota/cost owned by HLVM
  AND mobile scan/open can land in a dedicated HLVM chat surface
  AND inbound turns can use ChannelTransport → runtime → GUI turn bridge
```

Telegram passes today.

Everything else is out of production scope until proven otherwise.

## Retired Experiments

### iMessage

iMessage does not have a public bot API. The attempted self-message design
depended on:

- private `~/Library/Messages/chat.db` reads
- WAL file watching
- AppleScript / Apple Events sending
- phone/email alias heuristics
- local Messages notification behavior
- fragile loop suppression and attribution markers

Real-device testing showed the hard failures:

- replies could render as blue "me" bubbles instead of a bot-like peer
- multiple aliases created confusing duplicate rooms
- some messages were delayed or skipped depending on sync/thread state
- macOS notification banners fired for the same turn Siri was handling
- reliability depended on private Apple storage details, not an official API

Conclusion: do not ship iMessage as a production channel. Keep the lesson, not
the implementation.

### Gmail

Gmail can support email workflows, but it is not Telegram-equivalent chat.

Per-user OAuth:

- requires Google consent UX
- uses sensitive Gmail scopes
- may require app verification for broad distribution
- is not "scan QR and chat"

Central relay:

- requires HLVM to operate an inbox/relay
- creates abuse, quota, deliverability, and cost ownership
- violates the zero-server channel goal

IMAP/SMTP app-password prototypes:

- are simpler for a developer-owned mailbox
- still require account/security setup
- are not a clean consumer onboarding path

Conclusion: Gmail can be revisited as an email feature, not as the next default
chat platform.

### Slack

Slack has official APIs, OAuth, events, and Web API support. The problem is
product fit:

- onboarding is workspace app installation, not personal chat QR
- many workspaces require admin approval
- public apps require Slack review and production OAuth/security handling
- it is team/workspace oriented, not general mobile messenger oriented

Conclusion: Slack may be valid later as a team integration, but it should not
be mixed into the Telegram-style onboarding UI until scoped as that product.

### LINE, WhatsApp, KakaoTalk, Messenger, WeChat

These platforms require some combination of official accounts, business
registration, provider setup, webhook hosting, paid quota, regional constraints,
or unsupported bridges.

Conclusion: do not implement them for the default HLVM channel path unless the
platform rules change and the production gate is re-evaluated.

## GUI Rule

The macOS onboarding UI must show only production channels.

Current UI:

```text
[Telegram icon] Scan with Telegram
  [Telegram QR]
```

The Telegram icon is the live affordance for the only production channel. It is
not a platform picker. Do not add placeholder tabs/icons for unimplemented
platforms. Placeholders made failed experiments look product-ready and
increased debugging noise.

## Future Vendor Procedure

If a future platform passes the production gate:

1. Add `src/hlvm/channels/<vendor>/transport.ts`.
2. Add `src/hlvm/channels/<vendor>/provisioning.ts`.
3. Add `src/hlvm/channels/<vendor>/protocol.ts`.
4. Register the transport in `src/hlvm/channels/registry.ts`.
5. Register provisioning in
   `src/hlvm/cli/repl/handlers/channels/provisioning.ts`.
6. Add the GUI platform only after backend E2E passes on a real device.

Do not add the GUI first. Do not add speculative icons. Do not let vendor code
bypass the GUI turn bridge.

## Revision History

| Date       | Change                                                                                             |
| ---------- | -------------------------------------------------------------------------------------------------- |
| 2026-04-23 | Initial multi-platform seam documented: transport + provisioning contracts                         |
| 2026-04-24 | Telegram provisioning moved through generic channel route/contract                                 |
| 2026-04-26 | iMessage/Gmail/Slack/LINE research and spikes explored                                             |
| 2026-04-27 | Reset to Telegram-only production scope; retired failed non-Telegram implementations and UI        |
| 2026-04-27 | Clarified current QR UI: Telegram icon remains in the Telegram-only title row; no placeholder icons |
