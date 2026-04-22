# Messaging Reachability — One Brain, Many Doors

> The product is not "channels." The product is **reachability** — making HLVM
> reachable from the messaging apps people already live in, with setup that
> feels like no setup.
>
> This doc is the SSOT for messaging work. If it disagrees with an older
> sketch, roadmap note, or implementation comment, this wins.
>
> **Last updated**: 2026-04-22 (rev 12)

## Rev 10 decision

- Ship **Telegram Option B** first and only.
- **Option B** means: create a **user-owned Telegram bot** through Telegram's
  official managed-bot flow, then run that bot from the user's Mac in
  `direct` mode.
- **Option A** means: use a **shared HLVM bot** plus an HLVM-run relay. It
  remains a **future candidate only**. Do not build it in this rev.
- The earlier **iMessage-first** plan failed to reach a reliable, shippable
  path. iMessage is removed from active scope in this doc.
- This rev supersedes rev 8/9. Their iMessage-first phases, dropdown-first
  onboarding, and shared "pick your channel" first-launch UX are no longer
  normative.

## Rev 12 status snapshot

Rev 10's product decision still stands. Rev 12 is an execution-status update.

- Telegram Option B is still the only active ship path.
- The direct Telegram path **after a bot already exists** is now proven on a
  real iPhone:
  `Telegram → existing bot → local HLVM on Mac → reply`.
- Existing-bot scan now uses a Telegram app deep link instead of the old
  `https://t.me/...` web landing page.
- The runtime config merge now preserves `channels.telegram.transport` when
  the shell only patches `channels.telegram.onboardingDismissed`, so dismissing
  onboarding no longer erases the saved bot identity on disk.
- The bridge now stores provisioning state in persistent Deno KV and is no
  longer process-memory only.
- The old long claim wait that produced `[HQL5002]` on Deno Deploy is no
  longer the primary blocker.
- First-time managed-bot creation is now split more precisely:
  - on the original Telegram account used during debugging, Telegram's mobile
    create step can still block creation before HLVM receives any
    `managed_bot` webhook; the observed symptom is a disabled `Create` button
    with no Telegram-side error surfaced to HLVM
  - on a fresh Telegram account, the same managed-bot path completed and
    reached connected direct transport on the Mac
- The runtime, bridge service, and manager webhook now emit one unified trace
  to `/tmp/hlvm-telegram-e2e.log` so any future failure can be classified by
  exact transition.

So the practical split is now:

```text
backend/runtime after a bot exists: proven
first-time user bot creation on a fresh account: proven
first-time user bot creation on the original debugging account: blocked at Telegram create
```

## Why this exists

HLVM today is reachable from terminal and the macOS app. The missing product
surface is **mobile**. The goal is simple:

```text
pick up phone
→ open Telegram
→ message HLVM
→ get a reply in a few seconds
```

The runtime foundation for messaging already exists. What was missing was a
single clear first edge. Rev 10 makes that choice explicit instead of carrying
multiple half-plans at once.

## The core frame

**One brain, many doors.**

```text
   Telegram      KakaoTalk      Line      Slack      Discord      future
      │             │             │           │           │           │
      └─────────────┴─────────────┴───────────┴───────────┴───────────┘
                                    │
                          ┌─────────▼──────────┐
                          │   message door     │
                          │   (in hlvm binary) │
                          └─────────┬──────────┘
                                    │
                      sessionKey = "channel:<platform>:<stable_id>"
                                    │
                         ┌──────────▼──────────┐
                         │   HLVM brain        │
                         │   (unchanged)       │
                         │   memory · tools    │
                         │   @auto · subagents │
                         └──────────┬──────────┘
                                    │
                                  reply
                                    │
                         back out the same door
```

Messaging edges are ingress and egress around the existing runtime. They are
not a separate product and not a separate agent.

This stays aligned with [docs/ARCHITECTURE.md](../ARCHITECTURE.md): shells own
onboarding and presentation, the runtime host owns local protocol and
lifecycle, and the core engine owns message execution and state.

## Foundation rule

Rev 10 is Telegram-first, but the foundation is intentionally **platform
generic**.

That does **not** mean "design every platform now." It means the architecture
must let us add Slack, Discord, KakaoTalk, Line, and later platforms without
rewriting the core each time.

The rule is:

- one vendor-neutral messaging pipeline in HLVM
- one thin adapter per platform
- no per-vendor forks in agent execution, sessioning, allowlist enforcement,
  status, or config writeback

The generic core owns:

- normalized inbound message shape
- normalized outbound reply shape
- session ids in `channel:<platform>:<stable_id>` form
- per-chat serialization
- allowlist and pairing state
- reachability status and events
- config persistence and rebind
- one call into the HLVM brain

The platform adapter owns:

- vendor auth and provisioning
- vendor transport details
- vendor event ingestion
- vendor reply delivery
- mapping vendor-specific ids into stable HLVM ids
- any vendor-native QR, deep link, button, or setup surface

The design test for a new platform is simple:

```text
vendor event
→ adapter normalizes to one channel message
→ core runtime handles pairing / allowlist / queue / agent call
→ adapter sends one normalized reply back out
```

If a future platform needs a genuinely new primitive, we add that primitive to
the core **once**. We do not copy a second bespoke runtime for that vendor.

This is not speculative over-engineering. It is the minimum architecture needed
to avoid re-implementing the same messaging loop for every platform.

## Current status

### Implemented now

- The runtime foundation exists in `src/hlvm/channels/core/`.
- Unified config supports `channels` inside `~/.hlvm/settings.json`.
- Reserved session ids exist: `channel:<platform>:<stable_id>`.
- Per-chat serialization exists in the runtime foundation.
- The host exposes `GET /api/reachability/status` for GUI and CLI onboarding
  state.
- Channel sessions are prevented from hijacking the GUI or public active chat
  surface.
- Allowlist enforcement exists in the core before `runAgentQuery` runs.
- `channelRuntime.reconfigure()` is live behind
  `POST /api/reachability/rebind`.
- Config writes are serialized through the single-writer config path.
- Live reachability events exist through `channelRuntime.subscribe(listener)`
  and `GET /api/reachability/events`.
- A live Telegram `direct` transport exists in the runtime host.
- Telegram first-contact pairing now plugs into the shared pairing core instead
  of requiring a text-only matcher.
- The runtime host exposes Telegram provisioning-session endpoints and local
  runtime-side bridge registration / one-shot claim handling for the manager
  bot handoff.
- Provisioning sessions can now expose an optional bridge-owned QR URL so the
  scanned link can carry the local session identity into a shared manager-bot
  service without requiring the cloud to reach the user's Mac.
- A runnable bridge service now exists for session registration, manager-bot
  webhook intake, managed-bot completion, and one-time claim of the child bot
  token.
- The default hosted bridge is now live at
  `https://hlvm-telegram-bridge.hlvm.deno.net`.
- The bridge now has persistent KV-backed provisioning state instead of
  process-local memory, so register / webhook / claim no longer depend on
  landing in the same isolate.
- The local runtime now claims completion through bounded short bridge polls
  instead of one long HTTP wait, so Deno Deploy's request timeout is no longer
  the first failure mode.
- The shared runtime client now exposes reachability and Telegram provisioning
  helpers so future shells do not hand-roll onboarding HTTP calls.
- The macOS app now reuses the existing onboarding shell and renders a single
  Telegram QR path on first launch.
- The macOS app now renders the direct Telegram managed-bot creation URL in the
  QR for first-time creation instead of an extra bridge-owned landing page,
  because the bridge hop did not improve the user-visible flow.
- When a direct Telegram bot is already configured locally, the runtime now
  returns `qrKind = "open_bot"` with a Telegram app deep link
  `tg://resolve?domain=<bot>` so scan reopens the existing chat directly.
- The active runtime path for Telegram inbound messages now funnels through the
  same host chat pipeline used by the app shell instead of a second bespoke
  message-execution path.
- The runtime, bridge service, and manager webhook now emit a unified live
  trace to `/tmp/hlvm-telegram-e2e.log` for post-failure diagnosis.
- The old iMessage / Messages transport edge is removed from active code and
  tests. It remains only as retired history in this doc.
- Real iPhone validation confirmed the managed-bot link opens Telegram's native
  create sheet with pre-filled bot identity and then lands in the new bot chat.
- Real iPhone validation also confirmed the direct existing-bot path works
  end-to-end with a plain BotFather bot:
  Telegram message → local HLVM on Mac → reply back through Telegram.
- Real account-split validation now confirmed:
  - original Telegram account can still stall at the managed create step with
    no webhook reaching HLVM
  - fresh Telegram account can complete the same managed create flow end-to-end

### Current repo and hosted status

Inside the local codebase and current default hosted bridge, rev 10 is mostly
implemented and cleaned up:

- Telegram Option B is wired through the shared messaging core.
- The default hosted bridge, manager-bot webhook, and local runtime handoff are
  live.
- SSOT and code are aligned on the architecture and implementation boundary.
- The remaining work is not another messaging architecture pass.
- The remaining uncertainty sits at the real Telegram mobile-client boundary.

### Current observed result

The latest live validation produced the cleanest split so far:

```text
same hosted bridge
same local runtime
same product QR flow

original Telegram account
→ create sheet shows disabled Create button with no surfaced error
→ never completes
→ no managed_bot webhook reaches HLVM

fresh Telegram account
→ create completes
→ managed_bot webhook arrives
→ token is claimed locally
→ direct bot config is written
→ transport reaches connected
```

This removes several earlier debugging hypotheses:

- not a stale embedded binary
- not a broken GUI ↔ runtime link
- not a broken hosted bridge
- not a broken post-create token handoff
- not proof that managed bots are fake or unusable

The current evidence points at the original Telegram account's managed-create
state, not the core HLVM path.

### Not implemented yet

- No Android validation yet.
- No confirmed Telegram-internal explanation yet for why the original
  Telegram account's iPhone create sheet can block `Create` before creation
  completes.
- No confirmed hard-limit number yet for that original-account failure state;
  the current observed symptom is only: button disabled, no webhook, no
  explicit Telegram error.
- No pending-session reuse yet. Reopening onboarding can mint a fresh suggested
  bot instead of reusing one live pending session.
- No "reuse the existing child bot/chat" UX yet after first successful
  onboarding.
- No re-pair flow in Settings.
- No shared-bot relay service.

### Practical meaning

We are **past architecture debate** and **past backend de-risking**. The
remaining work is account-specific managed-create reliability and
onboarding-state cleanup, not another round of messaging architecture.

## Current architecture and communication

### Components

```text
iPhone Telegram app
Telegram Bot API / Telegram managed-bot create surfaces
manager bot
Deno Deploy provisioning bridge
Deno KV provisioning state
HLVM.app on macOS
embedded hlvm binary inside HLVM.app
central host chat pipeline inside hlvm
local model / tools / memory
```

### Architecture map

```text
                                  SETUP-TIME ONLY

   ┌─────────────────────┐       ┌──────────────────────────────┐
   │ iPhone Telegram app │──────▶│ Telegram managed create flow │
   └──────────┬──────────┘       └──────────────┬───────────────┘
              │                                  managed_bot webhook
              │                                               │
              │                                               ▼
              │                      ┌──────────────────────────────────────────┐
              │                      │ Deno Deploy bridge                       │
              │                      │ - register pending session               │
              │                      │ - Deno KV                               │
              │                      │ - getManagedBotToken                    │
              │                      │ - complete + one-time claim             │
              │                      └───────────────────┬──────────────────────┘
              │                                          │
              │                                          │ claim completed token
              │                                          ▼
              │                      ┌──────────────────────────────────────────┐
              │                      │ HLVM.app on macOS                       │
              │                      │                                          │
              │                      │  embedded hlvm binary                    │
              │                      │  - provisioning session                  │
              │                      │  - local config write                    │
              │                      │  - start direct transport                │
              │                      └───────────────────┬──────────────────────┘
              │                                          │
              │                                          │ after setup
              ▼                                          ▼

                                  STEADY-STATE CHAT PATH

   ┌─────────────────────┐       ┌──────────────────────────────┐
   │ iPhone Telegram app │──────▶│ Telegram Bot API / cloud     │
   └─────────────────────┘       └──────────────┬───────────────┘
                                                │ getUpdates / sendMessage
                                                ▼
                             ┌──────────────────────────────────────────────┐
                             │ HLVM.app on macOS                            │
                             │                                              │
                             │  embedded hlvm binary                        │
                             │  └─ direct Telegram transport                │
                             │     └─ central host chat pipeline            │
                             │        └─ local model / tools / memory       │
                             └──────────────────────────────────────────────┘
```

### What Deno Deploy stores and what it does not

The hosted bridge is setup-time only. It is not the normal message path.

It stores short-lived provisioning state in Deno KV:

- pending provisioning session id
- claim token
- intended child bot username
- intended child bot name
- session completion state
- one-time completed child bot token until the waiting Mac claims it

It does not store or relay everyday Telegram chat history for the direct path.

### Proven direct path after a bot already exists

```text
user types in Telegram
        │
        ▼
existing bot chat
        │
        ▼
Telegram Bot API / cloud
        │
        ▼
local direct transport in embedded hlvm
        │
        ▼
central host chat pipeline
        │
        ▼
local model / tools / memory
        │
        ▼
reply goes back through the same bot
```

This path is proven.

### First-time managed creation path

```text
Mac first launch
    │
    ▼
single scan window
    │
    ▼
QR = https://t.me/newbot/<manager>/<child>?name=HLVM
    │
    ▼
iPhone Telegram opens managed-bot create flow
    │
    ├─ success branch
    │
    │   user taps Create
    │       │
    │       ▼
    │   Telegram creates child bot
    │       │
    │       ▼
    │   Telegram sends managed_bot webhook
    │       │
    │       ▼
    │   Deno Deploy bridge
    │   - looks up pending session in KV
    │   - fetches child token
    │   - marks session completed
    │       │
    │       ▼
    │   local hlvm claims completion
    │   - writes local direct Telegram config
    │   - starts direct transport
    │   - future scan path becomes open_bot
    │
    └─ current failure branch
        Telegram create step does not complete
        before any webhook reaches HLVM
```

### Existing-bot scan path now

```text
bot already configured locally
    │
    ▼
Mac scan window
    │
    ▼
QR = tg://resolve?domain=<existing_bot>
    │
    ▼
iPhone hands deep link to Telegram app directly
    │
    ▼
existing bot chat opens
    │
    ▼
user continues the same conversation
```

This replaced the old pointless `https://t.me/<existing_bot>` web landing page
for our scan-to-chat UX.

The saved bot identity now survives onboarding dismissal, so rescan no longer
falls back to a fresh `newbot/...` QR just because the shell marked onboarding
as dismissed.

## Product rules

1. First launch shows **one thing to do**, not two equal choices.
2. In rev 10 that one thing is **Telegram Option B**.
3. The steady-state message path for rev 10 is **phone Telegram → user's bot →
   user's Mac**. No shared HLVM relay sits in the middle once pairing is done.
4. The user promise is honest: **scan, confirm creation, start, chat**. Do not
   promise "scan and zero more taps."
5. Option B requires the Telegram app to be installed on the user's phone. The
   no-app Safari path is not a supported onboarding path.
6. Once a bot already exists, scan should reopen that chat directly instead of
   sending the user back through another create flow.
7. Scan visibility is user-controlled. Reopening the scan surface for an
   already-configured bot should not silently consume or dismiss the QR on its
   own.
8. No BotFather chat, no token copy/paste, no hidden Telegram Web automation,
   no manual tunnel setup, and no operator-first wizard.
9. All inbound channel traffic stays behind core allowlist enforcement.
10. No periodic liveness loops. Telegram `direct` mode uses Telegram's update
   stream and reactive retry only.
11. Option A stays documented so we do not forget it, but it is not active
   scope.
12. iMessage is historical context only. It is not part of the active roadmap.
13. New platforms must plug into the same core messaging pipeline unless they
    expose a real shared primitive missing from that pipeline.

## Active ship path — Option B

### What the user sees

First launch is a single Mac window with one QR.

```text
┌──────────────────────────────────────────────────────────┐
│ Create your own HLVM bot                                 │
│                                                          │
│                    [ QR CODE ]                           │
│                                                          │
│               Scan with Telegram                         │
│         Requires Telegram on your phone                  │
└──────────────────────────────────────────────────────────┘
```

Scanning that QR hands the user into Telegram's managed-bot flow. The
committed user-visible path is:

```text
scan
→ Create
→ Start
→ chat
```

HLVM owns one Mac surface. Telegram owns the native mobile surfaces after the
scan. HLVM does not add its own extra wizard, tabs, or setup modes on top.

### What rev 10 commits to

- One onboarding path only: Telegram Option B.
- One QR only on first launch.
- One pre-filled bot identity per pairing attempt.
- One local direct transport after provisioning.
- One re-pair surface later in Settings for already-installed users.

### What rev 10 explicitly does not do

- No first-launch channel picker.
- No "Easy vs Private" tabs.
- No shared HLVM bot in the happy path.
- No relay-based default onboarding.
- No BotFather automation.
- No Telegram Web login inside HLVM.

## Option B implementation model

### Official Telegram shape we depend on

This rev intentionally depends only on official Telegram behavior:

- Managed bots are officially supported in Bot API 9.6.
- Telegram supports a managed-bot creation link:
  `t.me/newbot/{manager_bot_username}/{new_username}?name={new_name}`
- The creation flow pre-fills bot name and username and asks the user to
  confirm.
- Telegram bots cannot start conversations with users.
- A newly created child bot still requires the user to start the chat before
  normal messaging begins.

This means rev 10 is grounded in Telegram's documented path, not Web DOM
automation or hidden desktop-login tricks.

### Provisioning path

Rev 10 uses a small HLVM-run **provisioning session handoff** plus an HLVM-run
**manager bot / provisioning bridge service** for setup only.

Its job is narrow:

- mint a short-lived provisioning session
- generate the managed-bot creation link and QR
- receive Telegram's managed-bot creation event
- fetch the child bot token
- make that token available to the waiting Mac-side handoff path

In this repo, the runtime-host side of that handoff now exists end-to-end when
`HLVM_TELEGRAM_PROVISIONING_BRIDGE_URL` is configured:

- local runtime creates a provisioning session
- local runtime registers that session with the shared bridge service
- onboarding renders either:
  - the direct Telegram managed-bot creation URL for first-time create, or
  - a Telegram app deep link to reopen the existing bot chat
- local runtime reacts to bridge completion through bounded short polls for
  that exact session
- bridge service marks the session completed when Telegram returns the child bot
- local runtime claims the completed token once and commits it locally

The bridge service itself is also runnable from this repo now:

- entrypoint: `src/hlvm/channels/telegram/provisioning-bridge-server.ts`
- register route: `POST /api/telegram/provisioning/session`
- manager webhook route: `POST /api/telegram/manager/webhook`
- complete route: `POST /api/telegram/provisioning/session/complete`
- claim route: `POST /api/telegram/provisioning/session/claim`

Its completion route is bearer-protected with
`HLVM_TELEGRAM_PROVISIONING_BRIDGE_AUTH_TOKEN`.

Its manager-bot webhook consumes Telegram's `managed_bot` update, calls
`getManagedBotToken`, and completes the matching pending provisioning session
by the created bot's username. This route requires:

- `HLVM_TELEGRAM_MANAGER_BOT_TOKEN`
- `HLVM_TELEGRAM_MANAGER_BOT_WEBHOOK_SECRET`

The local runtime defaults the manager bot username from
`HLVM_TELEGRAM_MANAGER_BOT_USERNAME` so onboarding does not rely on the
placeholder `hlvm_manager_bot` name in real deployments.

It is **not** the long-lived message path. After provisioning, the user's Mac
talks to Telegram directly using the child bot token.

### Current blocker in the live pipeline

The live pipeline now has two clearly separated states:

```text
A. direct existing-bot path
   works

B. first-time managed create path
   still blocks before webhook/token handoff
```

The unresolved failure is now the first-time create boundary:

```text
local session created
→ bridge register succeeds
→ Telegram create flow opens
→ Telegram iPhone create step sometimes does not complete
→ no managed_bot webhook arrives
→ no token can be handed back
→ local direct transport is never configured for that new bot
```

This is important:

- the old bridge-isolate bug is no longer the lead explanation
- the old long Deno claim timeout is no longer the lead explanation
- when the manager webhook receives a `managed_bot` update, our side can now
  observe and handle the token path
- when the iPhone create step never completes, Telegram emits nothing and our
  backend cannot see the internal reason

So the remaining blocker is **not** another proven local runtime or bridge bug
first. It is the reliability of Telegram's real mobile create step for the
current managed-bot session.

### Mobile constraint found in validation

Real-device validation on 2026-04-21 and 2026-04-22 found two important facts:

- if Telegram is not installed on the phone, scanning the managed-bot QR can
  land in Safari instead of a working native create flow
- the no-app Safari path is therefore not part of the supported rev 10 UX
- if Telegram is installed and Bot Management Mode is enabled, the managed-bot
  QR opens Telegram's native create sheet with the bot name and username
  pre-filled, then lands in the new child bot chat after creation
- if the iPhone create sheet does not complete creation, HLVM receives no
  webhook or token signal at all; this is the current unresolved E2E boundary
- for an already-configured bot, scan should now use a Telegram app deep link
  and reopen the existing chat directly instead of using a `t.me` web landing
  page

Rev 10 should treat this as a product constraint, not as a reason to add more
local architecture. The practical implication is simple:

- onboarding copy must tell the truth: Telegram must already be installed on
  the phone
- future bridge pages may improve the missing-app fallback, but that is not a
  prerequisite for the local runtime design

### Direct transport path

After provisioning:

- HLVM stores the child bot token locally in `config.channels.telegram`.
- Transport mode is `direct`.
- The Mac listens for inbound Telegram updates for that bot.
- During pairing, the fresh child bot is bound to the first inbound Telegram
  user id and that id is written to `allowedIds`.
- All later inbound messages for other ids are rejected by the existing
  allowlist gate in the core.

This keeps the ongoing path simple:

```text
phone Telegram
→ user's bot
→ user's Mac
→ reply back through the same bot
```

This path is now also proven with a plain BotFather-created direct test bot.

### Config shape

```json
{
  "channels": {
    "telegram": {
      "enabled": true,
      "allowedIds": ["123456789"],
      "transport": {
        "mode": "direct",
        "token": "123456789:AA...",
        "username": "hlvm_x7f3_bot",
        "cursor": 0
      }
    }
  }
}
```

`mode`, `token`, `cursor`, and `allowedIds` already fit the existing config
model. Extra transport fields such as `username` remain legal because transport
config is open-ended.

## Future candidate — Option A

Option A remains worth remembering:

```text
phone Telegram
→ shared @hlvm_bot
→ HLVM-run relay
→ user's Mac
```

Why it still matters:

- it can reduce first-run friction further
- it can support a true HLVM-owned shared-bot onboarding story
- it remains the clearest future answer if rev 10 proves that Telegram's
  create-and-start steps are still too much friction

But rev 10 does **not** build it. Concretely:

- do not add relay service work to the active plan
- do not build shared-bot onboarding now
- do not show A and B as equal first-run choices
- do not treat A as a parallel ship track

If we choose to pursue A later, it gets a new SSOT revision and a separate
execution plan.

## Retired path — iMessage

Earlier revisions treated iMessage as the likely first edge because it looked
like the lowest-friction Apple path. That path failed.

Rev 10 makes that explicit:

- HLVM tried the iMessage direction and it did not reach a reliable, shippable
  product path.
- iMessage is removed from active ship scope.
- iMessage is no longer the default channel, no longer a first-launch
  assumption, and no longer a phase gate for messaging.
- iMessage-specific onboarding, default-selection logic, and roadmap language
  from rev 8/9 are retired.

If iMessage is ever revisited, it must start from a new proposal. None of the
old iMessage-first assumptions remain binding.

## Roadmap after rev 10

1. Complete one real iOS run of:
   `scan → Create → Start → first reply`.
2. Complete one real Android run of the same flow.
3. Stabilize or explain the iPhone create-sheet failure mode when `Create`
   becomes disabled before submission.
4. Reuse one pending provisioning session instead of minting a fresh suggested
   bot on every reopened onboarding window.
5. After first successful onboarding, default to reusing the existing child
   bot/chat instead of creating another bot.
6. Add a clear re-pair surface only when the provisioning service can drive it
   honestly.
7. Keep scan as a top-level reopen affordance for existing-bot chat, not just a
   one-shot first-launch artifact.
8. Only then decide whether Option A is worth building.

Until step 1 is done:

- no shared-bot relay work
- no iMessage work
- no multi-channel onboarding chooser
- no new messaging architecture churn unless real-device validation exposes a
  concrete missing primitive

## External references

This rev is based on official Telegram docs only:

- `https://core.telegram.org/bots/features`
- `https://core.telegram.org/bots/api`
- `https://core.telegram.org/bots/api-changelog`
- `https://core.telegram.org/bots`
- `https://core.telegram.org/api/links`
- `https://core.telegram.org/method/messages.startBot`

Those references are here to lock the constraints that matter:

- managed-bot creation is real
- pre-filled creation is real
- user confirmation is required
- the child bot still requires user start before normal chat
