# Telegram Ops Inventory

Private operational note. No tokens or secret values are recorded here.

## Current bots

### Manager bot, original

- name: `HLVM Setup`
- username: `@hlvm_setup_helper_bot`
- role: Telegram managed-bot setup manager
- status:
  - used in earlier managed-bot creation tests
  - still appears in the latest observed local create-session URL

### Manager bot, fresh replacement

- name: `HLVM Setup 2`
- username: `@hlvm_setup_helper_2_bot`
- role: fresh Telegram managed-bot setup manager
- status:
  - Bot Management Mode enabled
  - webhook configured on the hosted bridge
  - bridge environment updated to this manager identity
  - fresh-account managed create completed successfully through this manager bot

### Direct test bot

- name: `HLVM Direct Test`
- username: `@hlvm_direct_test_01_bot`
- role: plain BotFather bot used to prove the direct path
- status:
  - direct Telegram chat works
  - iPhone Telegram message reaches local HLVM on Mac
  - local HLVM reply returns through Telegram
  - existing-bot scan now deep-links into this chat when configured locally

### Older plain test bot

- name: `HLVM`
- username: `@TestHLVMBot`
- role: earlier plain test bot from the first managed-bot experiments
- status:
  - not part of the current active path

## Current components

### Hosted bridge

- base URL: `https://hlvm-telegram-bridge.hlvm.deno.net`
- role:
  - register pending provisioning session
  - receive manager-bot webhook
  - call Telegram managed-bot token fetch
  - store completion in Deno KV
  - hand token back to the waiting Mac exactly once

### Telegram webhook route

- route:
  `https://hlvm-telegram-bridge.hlvm.deno.net/api/telegram/manager/webhook`
- allowed updates:
  - `managed_bot`

### Local app and runtime

- macOS shell:
  `HLVM.app`
- embedded runtime:
  `HLVM.app/Contents/Resources/hlvm`
- local runtime host:
  `127.0.0.1:11435`
- config file:
  `~/.hlvm/settings.json`
- local runtime debug log:
  `~/.hlvm/debug.log`
- GUI debug log:
  `/tmp/hlvm-gui-debug.log`

## Current proven paths

### Proven path A: direct existing bot

```text
iPhone Telegram
→ existing bot chat
→ Telegram Bot API
→ local embedded hlvm on Mac
→ central host chat pipeline
→ reply back to Telegram
```

This is proven with `@hlvm_direct_test_01_bot`.

### Proven path B: existing-bot scan reopen

```text
Mac scan window
→ QR = tg://resolve?domain=<existing_bot>
→ Telegram app opens existing bot chat directly
```

The old `https://t.me/<existing_bot>` web landing page is no longer needed for
this path.

## Current blocked path

### First-time managed-bot create

```text
Mac scan window
→ QR = https://t.me/newbot/<manager>/<child>?name=HLVM
→ Telegram managed create flow
→ Create does not always complete
→ no managed_bot webhook arrives
→ no token handoff happens
→ no new direct bot config is written locally
```

This is still the unresolved path.

Observed original-account symptom:

- Telegram create sheet opens
- `Create` button is disabled
- no Telegram-side error is surfaced to HLVM
- no `managed_bot` webhook arrives
- hard limit / gating cause is still unknown

## What Deno stores

Setup-time only. Not daily chat traffic.

Stored in Deno KV:

- pending provisioning session id
- claim token
- target child bot username
- target child bot display name
- completion state
- one-time child bot token until claimed by the Mac

Not stored there for the direct path:

- normal Telegram chat transcript
- normal direct message traffic
- long-term central relay state for direct bot conversations

## What is ready vs not ready

### Ready

- backend/runtime after a bot already exists
- local embedded hlvm direct Telegram transport
- centralized host chat pipeline
- existing-bot scan reopen flow
- persisted existing-bot scan reopen after onboarding dismissal
- hosted provisioning bridge architecture
- full managed-bot create flow on a fresh Telegram account

### Not ready

- first-time managed-bot creation on the original debugging Telegram account
- a Telegram-internal explanation for the disabled-Create state on that
  original account
