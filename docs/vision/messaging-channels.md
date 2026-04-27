# Messaging Channels Vision

**Last updated**: 2026-04-27

This document records the messaging-channel product decision and the lessons
from the removed LINE/iMessage/Gmail/Slack experiments.

## Decision

HLVM ships Telegram only.

The goal is not "many platform logos". The goal is:

```text
user opens HLVM
→ scans one QR
→ mobile chat opens
→ sends hello
→ HLVM GUI/Siri reacts through the same local chat pipeline
→ reply returns to the same mobile thread
```

Telegram is the only tested platform that currently gives this without an HLVM
message relay, user developer setup, business account, paid quota, or private
OS hacks.

## Target Experience

```text
Mac HLVM GUI
    │
    │ user clicks Scan with Telegram
    ▼
Telegram QR
    │
    │ user scans on phone
    ▼
Telegram bot chat
    │
    │ user sends message
    ▼
HLVM shared runtime
    │
    │ ChannelTransport → runtime queue → GUI turn bridge
    ▼
Swift chat / Siri bubble
    │
    │ same path as local Tab/Spotlight message
    ▼
HLVM brain
    │
    ▼
Telegram reply
```

This is the bar future platforms must meet.

## Why Telegram Stays

Telegram gives us the right primitives:

- official Bot API
- user-friendly mobile chat surface
- QR/open-link onboarding
- bot identity separate from the user
- no HLVM-hosted message relay
- no aggregate per-message bill owned by HLVM
- direct local runtime ownership through `ChannelTransport`
- clean GUI mirroring through the GUI turn bridge

## Removed Platform Lessons

### iMessage

iMessage looked attractive because every iPhone user already has it. It failed
because Apple does not provide a public bot API.

The attempted self-message path required:

- reading private `~/Library/Messages/chat.db`
- watching `chat.db-wal`
- sending via AppleScript / Apple Events
- detecting phone/email aliases
- suppressing loops and interpreting Apple-private row formats
- asking users to tolerate or suppress Messages notifications

Real-device testing exposed the product failures:

- bot replies could appear as the user's own blue bubbles
- phone/email aliases could create multiple confusing rooms
- delivery depended on iCloud sync and local Messages state
- notification banners competed with the HLVM/Siri UI
- fixes became private-DB heuristics rather than product engineering

Conclusion: iMessage is removed. It is not production until Apple provides a
real bot/business API suitable for this use case, or HLVM intentionally chooses
a central relay product with its own cost and policy tradeoffs.

### LINE

LINE requires Official Account / Messaging API setup and webhook ownership.
That is not the Telegram-style consumer path. It also introduces account,
region, quota, and provider constraints.

Conclusion: removed from GUI/source. Revisit only if LINE offers a Telegram-like
bot onboarding path without central relay cost.

### Gmail

Gmail can work as email, not as a Telegram-equivalent chat channel.

Options considered:

- User OAuth: local runtime can read/send mail after consent, but onboarding is
  Google authorization and sensitive scopes, not scan-and-chat.
- Central Gmail relay: user emails an HLVM mailbox, but HLVM then operates the
  mailbox/relay and owns quota, abuse handling, and deliverability.
- IMAP/SMTP app password: simpler for a single developer mailbox, not a clean
  consumer product and still an operator-managed relay if centralized.

Conclusion: do not add Gmail to the messaging picker. It may become a separate
email integration later.

### Slack

Slack is technically strong but product-different:

- OAuth app installation
- workspace/admin approval
- team/workspace context
- public app review and security requirements

Conclusion: Slack may become a team integration, not part of the Telegram-style
personal mobile messenger path.

### WhatsApp, Messenger, KakaoTalk, WeChat

These are constrained by business accounts, provider programs, webhook hosting,
regional policies, pricing, or unofficial bridges.

Conclusion: out of scope for the default HLVM messaging channel.

## Product Gate

Before a platform appears in source or GUI, prove all of:

```text
official supported API
no private OS datastore dependency
no reverse-engineered client
no HLVM-operated runtime message relay
no shared aggregate quota/cost ceiling
mobile onboarding lands in a dedicated HLVM chat
messages can enter the ChannelTransport/runtime/GUI-turn SSOT path
real-device E2E passes before GUI exposure
```

If any answer is "no", keep it in research docs only.

## Current UI

```text
[Telegram icon] Scan with Telegram
  [Telegram QR]
```

The icon is Telegram-specific because Telegram is the only production channel.
It must not become a generic picker or imply future-platform availability. No
placeholder tabs. No future-platform icons. No "coming soon" channel buttons.

## Architecture Rule

Every mobile message uses the same path:

```text
Vendor API
→ ChannelTransport
→ core/runtime.ts
→ core/queue.ts
→ core/gui-turn-bridge.ts
→ Swift GUI chat controller
→ HLVM brain
→ ChannelReply
→ ChannelTransport
→ Vendor API
```

No backend direct-chat shortcut. No synthetic remote-message bubble. No
vendor-specific side channel.

## Next Work

Improve Telegram quality instead of adding speculative platforms:

- preserve Telegram onboarding reliability
- keep bot profile setup working
- improve stale-runtime and reset diagnostics
- support multiple Telegram endpoints only through shared-runtime endpoint
  records, not multiple runtime processes
- keep docs and GUI aligned with production reality

## Revision History

| Date       | Change                                                                                      |
| ---------- | ------------------------------------------------------------------------------------------- |
| 2026-04-23 | Multi-platform messaging vision created                                                     |
| 2026-04-26 | LINE/iMessage/Gmail/Slack explored as candidate channels                                    |
| 2026-04-27 | Reset vision to Telegram-only production; recorded retired platform lessons and product gate |
| 2026-04-27 | Current UI clarified: Telegram icon stays with Telegram-only QR; no placeholder platform UI  |
