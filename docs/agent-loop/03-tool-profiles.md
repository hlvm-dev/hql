# Tool Profile System — Filtering, Caching, Browser Promotion

`tool-profiles.ts` (497 LOC) — controls which tools the LLM can see each turn.

## The 5-Layer Stack

```
  ┌──────────────────────────────────────────────────────────────────────┐
  │                     ToolProfileState                                 │
  │                                                                      │
  │  Each layer has: { allowlist?: string[], denylist?: string[],        │
  │                     profileId?: string, reason?: string }            │
  │                                                                      │
  │  ┌──────────┐  Tier tools + capabilities                             │
  │  │ baseline │  Set once at session start. Widened on hybrid          │
  │  │          │  promotion. Never narrowed within a request.           │
  │  ├──────────┤                                                        │
  │  │  domain  │  "browser_safe" or "browser_hybrid" or EMPTY          │
  │  │          │  Set once per request by evaluateDelegationSignal.     │
  │  ├──────────┤                                                        │
  │  │   plan   │  Narrowed during plan-mode execution.                  │
  │  │          │  Set when plan approved, cleared when done.            │
  │  ├──────────┤                                                        │
  │  │discovery │  tool_search results dynamically expand visibility.    │
  │  │          │  Additive — only adds, never removes.                  │
  │  ├──────────┤                                                        │
  │  │ runtime  │  Per-turn phase narrowing + temp-blocked tools.        │
  │  │          │  Rewritten EVERY iteration by applyAdaptiveToolPhase. │
  │  └──────────┘                                                        │
  │                                                                      │
  │  _generation: number  ← bumped on EVERY layer mutation              │
  │                                                                      │
  └──────────────────────────────────────────────────────────────────────┘
```


## Resolution Algorithm

```
  resolveEffectiveToolFilter(state)
    │
    │  Walk layers in order: baseline → domain → plan → discovery → runtime
    │
    │  For allowlists:   INTERSECT (∩)
    │    Only tools present in ALL layers survive.
    │    A layer with no allowlist is treated as "allow everything."
    │
    │  For denylists:    UNION (∪)
    │    A tool denied in ANY layer is denied.
    │
    │  Final: effective = { allowlist: ∩ all, denylist: ∪ all }
    │
    ▼

  EXAMPLE — Browser Safe Mode:

    baseline.allowlist:  [read_file, edit_file, shell_exec, ..., pw_goto, pw_click, ...]
                          ──────────── standard ────────────  ──── pw tools ────
                          (~20 tools)                         (11 tools)

    domain.allowlist:    [pw_goto, pw_click, pw_fill, pw_type, pw_content,
                          pw_links, pw_snapshot, pw_scroll, pw_evaluate,
                          pw_download, pw_screenshot]
                          (11 pw tools — NO pw_promote, NO cu_*)

    runtime.allowlist:   (copy of persistent, with phase denylist)
    runtime.denylist:    [pw_click]  (temp-blocked after failure)

    ∩ = [pw_goto, pw_fill, pw_type, pw_content, pw_links,
         pw_snapshot, pw_scroll, pw_evaluate, pw_download,
         pw_screenshot]                                        (10 tools)

    pw_promote:   ABSENT (not in domain allowlist)
    cu_*:         ABSENT (not in domain allowlist)
    read_file:    ABSENT (not in domain allowlist — browser sandbox)
    pw_click:     ABSENT (runtime denylist)
```


## Declared Profiles

```
  tool-profiles.ts:81-96

  ┌──────────────────────────────────────────────────────────────────────┐
  │                                                                      │
  │  browser_safe                                                        │
  │    allowlist: all pw_* EXCEPT pw_promote                             │
  │    = [pw_goto, pw_click, pw_fill, pw_type, pw_content,              │
  │       pw_links, pw_snapshot, pw_scroll, pw_evaluate,                │
  │       pw_download, pw_screenshot]                                    │
  │                                                                      │
  │  browser_hybrid  (extends browser_safe)                              │
  │    allowlist: browser_safe + [pw_promote, cu_screenshot,            │
  │       cu_left_click, cu_type, cu_key, cu_scroll]                    │
  │    = all pw_* + pw_promote + all cu_*                                │
  │                                                                      │
  └──────────────────────────────────────────────────────────────────────┘
```


## The Cache

```
  _filterCache: WeakMap<ToolProfileState, {
    generation: number,
    registry: DeclaredToolProfileRegistry,
    effective: ToolFilterState,
    persistent: ToolFilterState
  }>

  resolveFiltersWithCache(state, registry)
    │
    ├─ cache hit?
    │    generation matches? ✓
    │    registry matches?   ✓  (reference equality)
    │    → return cached {effective, persistent}
    │
    └─ cache miss:
         computeToolFilter(state, ALL_SLOTS)        → effective
         computeToolFilter(state, PERSISTENT_SLOTS)  → persistent
         _filterCache.set(state, {gen, registry, effective, persistent})

  Cache invalidated by:
    setToolProfileLayer()    → _generation++
    clearToolProfileLayer()  → _generation++

  In practice:
    Turn with no mutations: 1 computation, rest are cache hits
    Turn with 1 mutation:   2 computations (before + after mutation)
```


## Browser Promotion Pipeline

```
  ══════════════════════════════════════════════════════════════════════
                  BROWSER_SAFE → BROWSER_HYBRID PROMOTION
  ══════════════════════════════════════════════════════════════════════

  PW tool fails (click_intercepted, not_visible, etc.)
       │
       ▼
  decideBrowserRecovery()                     recovery-policy.ts:47
       │
       ├─ has candidateHref?        → "fallback_navigate" (pw_goto)
       ├─ download navigated?       → "follow_download_dest"
       ├─ repeatCount < 2?          → "retry" (let LLM retry)
       │
       ├─ visual blocker + browser_safe?
       │    │
       │    ▼
       │   promoteToHybrid: TRUE  ★
       │
       └─ visual blocker + already hybrid? → "cu_fallback"


  PROMOTION EXECUTION:                   orch-response.ts:1765

  Step 1: WIDEN BASELINE                 tool-profiles.ts:413
    │
    │  widenBaselineForDomainProfile(config, BROWSER_HYBRID_PROFILE_ID)
    │
    │  Resolve browser_hybrid declared profile allowlist:
    │    [pw_goto...pw_screenshot, pw_promote, cu_screenshot,
    │     cu_left_click, cu_type, cu_key, cu_scroll]
    │
    │  BEFORE baseline: [standard 20, pw 11]           = 31 tools
    │  AFTER  baseline: [standard 20, pw 11, pw_promote, cu 5] = 37 tools
    │
    │  WHY: domain intersection kills tools not in baseline.
    │  Without widening, cu_* and pw_promote would be DROPPED.
    │
    │  _generation: N → N+1
    │
  Step 2: SET DOMAIN TO HYBRID           orch-response.ts:1767
    │
    │  updateToolProfileLayer(config, "domain", {
    │    profileId: BROWSER_HYBRID_PROFILE_ID
    │  })
    │
    │  domain.allowlist: [all pw + pw_promote + all cu]
    │  _generation: N+1 → N+2
    │
  Step 3: CLEAR RUNTIME LAYER            orch-response.ts:1775
    │
    │  clearToolProfileLayerFromTarget(config, "runtime")
    │
    │  WHY: stale runtime had browser_safe allowlist.
    │  Would mask new hybrid tools on next intersection.
    │  Clearing forces fresh recomputation.
    │
    │  _generation: N+2 → N+3
    │
  Step 4: BLOCK FAILING TOOL
    │
    │  temporaryToolDenylist.set("pw_click", 2)
    │  → pw_click blocked for next 2 turns
    │
  Step 5: INJECT DIRECTIVE
    │
    │  addContextMessage: "Hybrid mode available. Browser going
    │    headed. Call pw_promote first, then use cu_screenshot
    │    + cu_left_click."


  NEXT TURN RESOLUTION:

    baseline ∩ domain ∩ runtime (fresh)
    = [standard+pw+cu 37] ∩ [pw+cu 17] ∩ [pw+cu 17]
    = [pw+cu 17] minus denylist [pw_click]
    = 16 tools

    pw_promote:     PRESENT ✓   (LLM can call it)
    cu_screenshot:  PRESENT ✓   (LLM can see the screen)
    cu_left_click:  PRESENT ✓   (LLM can click visually)
    pw_click:       BLOCKED     (temp 2 turns)
    read_file:      ABSENT      (browser sandbox by design)
```


## Layer State Evolution (Typical Browser Session)

```
  Gen│ Event                    │ baseline        │ domain        │ runtime
  ───┼──────────────────────────┼─────────────────┼───────────────┼──────────
   0 │ session start            │ [standard 20]   │ (empty)       │ (empty)
   1 │ browser task detected    │ [standard+pw 31]│ (empty)       │ (empty)
   2 │ domain = browser_safe    │ [standard+pw 31]│ [pw 11]       │ (empty)
   3 │ phase: researching       │ [standard+pw 31]│ [pw 11]       │ [pw 11]
     │                          │                 │               │
     │ LLM: pw_goto ✓           │                 │               │
     │ LLM: pw_click ✗          │                 │               │
     │ LLM: pw_click ✗✗         │     visual blocker, repeat ≥ 2 │
     │                          │                 │               │
   4 │ widen baseline           │ [std+pw+cu 37]  │ [pw 11]       │ [pw 11]
   5 │ domain → hybrid          │ [std+pw+cu 37]  │ [pw+cu 17]    │ [pw 11]
   6 │ clear runtime            │ [std+pw+cu 37]  │ [pw+cu 17]    │ (empty)
   7 │ phase: researching       │ [std+pw+cu 37]  │ [pw+cu 17]    │ [pw+cu 17]
     │ (fresh)                  │                 │               │deny:[pw_click]
     │                          │                 │               │
     │ EFFECTIVE = 37 ∩ 17 ∩ 17 minus [pw_click] = 16 tools      │
     │                          │                 │               │
     │ LLM: pw_promote ✓   → headed browser                      │
     │ LLM: cu_screenshot ✓ → sees real pixels                    │
     │ LLM: cu_left_click ✓ → clicks visual target                │
  ───┴──────────────────────────┴─────────────────┴───────────────┴──────────
```


## Who Calls What

```
  SESSION START:
    session.ts:432         createToolProfileState()
    session.ts:433         setToolProfileLayer("baseline", ...)

  REQUEST CLASSIFICATION (once per user message):
    orchestrator.ts:803    updateToolProfileLayer("baseline", widened)
    orchestrator.ts:810    updateToolProfileLayer("domain", browser_safe)
      or
    orchestrator.ts:817    clearToolProfileLayer("domain")

  EVERY TURN:
    orchestrator.ts:843    applyAdaptiveToolPhase()
      → orchestrator.ts:966  updateToolProfileLayer("runtime", {allow, deny})

  TOOL SCHEMA BUILD (every LLM call):
    engine-sdk.ts:809      resolveEffectiveToolFilterCached()
    engine-sdk.ts:846      buildToolDefinitions({allow, deny})

  BROWSER RECOVERY (on playwright failure):
    orch-response.ts:1766  widenBaselineForDomainProfile(BROWSER_HYBRID)
    orch-response.ts:1767  updateToolProfileLayer("domain", browser_hybrid)
    orch-response.ts:1775  clearToolProfileLayer("runtime")

  PLAN MODE:
    orch-response.ts:837   updateToolProfileLayer("plan", planAllowlist)

  TOOL SEARCH:
    (registry.ts)          updateToolProfileLayer("discovery", found tools)
```
