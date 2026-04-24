# Messaging Platform Architecture

This is the binary-side architecture SSOT for messaging platforms in HLVM.

It answers one question:

```text
How do we support Telegram now and add Slack / Discord / KakaoTalk / WhatsApp later
without rewriting the messaging runtime each time?
```

**Last updated**: 2026-04-24

## Current conclusion

Do not rewrite the messaging core.

The existing shared runtime is already the right foundation:

- `src/hlvm/channels/core/runtime.ts`
- `src/hlvm/channels/core/queue.ts`
- `src/hlvm/channels/core/session-key.ts`
- `src/hlvm/channels/core/types.ts`
- `src/hlvm/channels/registry.ts`

The missing seam was provisioning/setup, not transport execution.

That seam is now implemented in the codebase. The remaining work is small
cleanup, not another runtime redesign.

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

So the status is:

```text
shared runtime core: done
shared transport contract: done
shared provisioning contract: done
Telegram as first vendor implementation: done
second platform implementation: not started yet
```

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

- **Slack** is the best next engineering target
- **WhatsApp** is the biggest reach target, but not as developer-friendly as
  Telegram
- **Email** is possible later, but it is an async channel, not the next chat
  adapter
- **LINE** is the strongest Asia chat candidate after Slack because it has an
  official Messaging API webhook model
- **KakaoTalk** is possible but difficult; its official surface is more channel
  / business oriented and less Telegram-like

The product bar for any new channel is:

```text
scan / click / approve
→ then chat
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

## Remaining cleanup only

These are the meaningful architecture-adjacent leftovers now:

1. keep future vendor-specific setup fields inside that vendor folder instead of
   drifting back into shared runtime protocol files

These are cleanup items. They do not change the current Telegram behavior.
