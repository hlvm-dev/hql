# Telegram Ops Inventory

Private operational note. No tokens or secret values are recorded here.

## Current bots

### Manager bot, original

- name: `HLVM Setup`
- username: `@hlvm_setup_helper_bot`
- role: Telegram managed-bot setup manager
- status:
  - used in earlier managed-bot creation tests
  - no longer the current production-default manager identity

### Manager bot, fresh replacement

- name: `HLVM Setup 2`
- username: `@hlvm_setup_helper_2_bot`
- role: fresh Telegram managed-bot setup manager
- status:
  - Bot Management Mode enabled
  - webhook configured on the hosted bridge
  - bridge environment updated to this manager identity
  - current production-default manager identity
  - latest create and reconnect/recreate tests completed successfully through
    this manager bot

### Current live child bot

- name: user-edited during latest recreate flow
- username: `@my_bot_brobot`
- role: current direct Telegram bot connected to this local HLVM install
- status:
  - created through the reactive reconnect flow after the previous child bot
    was deleted in Telegram
  - latest recreate test changed both the prefilled display name and the
    prefilled child `@username`
  - bridge returned the final created username and local HLVM adopted it
    correctly

### Deleted child bot from reconnect test

- name: `HLVM`
- username: `@hlvm_6d5e93_bot`
- role: previous direct child bot used before Telegram-side deletion testing
- status:
  - deleted in BotFather during the reactive recovery test
  - used to prove the `401 → stale-state cleanup → reconnect QR` path

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
  - keep one active pending session per local install via stable `deviceId`
  - supersede stale pending sessions for the same install
  - when the Telegram owner is already known, keep one active pending session
    per owner for that manager bot
  - receive manager-bot webhook
  - call Telegram managed-bot token fetch
  - store completion in Deno KV
  - remember one owner→bot record for known Telegram owners
  - store unmatched created bots temporarily for recovery
  - hand token back to the waiting Mac exactly once
  - expose an authenticated reset route for clean-test / start-over cleanup

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

## Current proven path additions

### Proven path C: first-time managed-bot create

```text
Mac scan window
→ QR = https://t.me/newbot/<manager>/<child>?name=HLVM
→ Telegram managed create flow opens with prefilled child bot identity
→ user creates the child bot
→ manager webhook receives managed_bot
→ bridge gets child token
→ local runtime claims completion
→ local direct Telegram transport reaches connected
→ chat works
```

### Proven path D: deleted-bot reactive recovery

```text
user deletes child bot in BotFather
→ first real Telegram API call returns 401
→ HLVM clears stale local bot state
→ same scan QR window reopens immediately with reconnect copy
→ user scans again
→ Telegram managed create flow opens with prefilled child bot identity
→ user can edit final display name and child @username
→ bridge returns the final created bot identity
→ local runtime adopts that final bot identity
→ chat works again
```

## What Deno stores

Setup-time only. Not daily chat traffic.

Stored in Deno KV:

- pending provisioning session id
- pending provisioning session indexed by local `deviceId`
- pending provisioning session indexed by known Telegram owner
- claim token
- target child bot username
- target child bot display name
- completion state
- one-time child bot token until claimed by the Mac
- one long-lived owner→bot record when Telegram owner is known
- short-lived unmatched created managed bots for edited-username recovery

The intended setup model is now:

```text
one Telegram owner -> one long-lived HLVM bot
one local install  -> one active pending provisioning session
```

The session is temporary. The saved bot identity is the long-lived reopen
target after pairing succeeds.

When HLVM already knows the Telegram owner, the bridge also keeps:

```text
one Telegram owner + one manager bot
-> one active pending provisioning session
-> one remembered bot record
```

Not stored there for the direct path:

- normal Telegram chat transcript
- normal direct message traffic
- long-term central relay state for direct bot conversations

## What is ready vs not ready

### Ready

- backend/runtime after a bot already exists
- local embedded hlvm direct Telegram transport
- centralized host chat pipeline
- first-time managed-bot create on the active tested path
- existing-bot scan reopen flow
- deleted-bot reactive recovery
- immediate reconnect QR after stale/deleted bot detection
- persisted existing-bot scan reopen after onboarding dismissal
- pending-session reuse inside the local runtime
- bridge-side superseding of stale pending sessions for the same local install
- bridge-side superseding of stale pending sessions for the same known Telegram
  owner
- hosted provisioning bridge architecture
- auto-adoption of a sole unmatched created managed bot when the user edited the
  prefilled child username during create
- owner-aware completion when Telegram returns a changed child username for a
  session already bound to a known owner
- centralized Telegram provisioning defaults for manager bot + bridge URL
- stale-bot cleanup on Telegram `401`

### Not ready

- Android validation
- Telegram settings lifecycle UI such as `Open Chat`, `Reconnect`, and
  `Disconnect This Mac`
- automatic post-create bot branding such as photo / about / description
- stronger message-level observability for inbound Telegram updates and replies
- a perfect product-wide answer to concurrent edited-username first creates
  before HLVM already knows the Telegram owner identity
